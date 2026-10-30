import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { RunState } from '@doofy-duck/game-sim';
import { checkpointHash, type CheckpointRequest } from './checkpoint-hash.js';
import { ACTIVE_TICK_LIMIT, replayCheckpoint } from './replay.js';
import { acquireClient } from './db.js';

export class CheckpointError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export type RunRow = {
  id: string; account_id: string; life_index: number; seed: string; simulation_version: string;
  generator_version: string; config_id: string; state: RunState; status: string;
  verification_status: string; delivery_status: string; writer_token_hash: Buffer;
  checkpoint_sequence: string; writer_generation: string; active_ticks: string;
  last_contact: Date; completion_reason: string | null;
};

export async function deadline(client: PoolClient, lastContact: Date, now: Date): Promise<Date> {
  const result = await client.query<{ deadline: Date }>(`WITH RECURSIVE extension(deadline, depth) AS (
    SELECT $1::timestamptz + interval '1 hour', 0 UNION ALL
    SELECT outage.recovered + interval '1 hour', extension.depth + 1 FROM extension
    CROSS JOIN LATERAL (SELECT max(COALESCE(recovered_at, $2::timestamptz)) AS recovered FROM core_outages
      WHERE started_at <= extension.deadline AND COALESCE(recovered_at, $2::timestamptz) >= $1::timestamptz) AS outage
    WHERE outage.recovered + interval '1 hour' > extension.deadline)
    SELECT max(deadline) AS deadline FROM extension`, [lastContact, now]);
  return result.rows[0]!.deadline;
}

export function snapshot(run: RunRow, submissionDeadline: Date) {
  return {
    runId: run.id, accountId: run.account_id, lifeIndex: run.life_index, seed: Number(run.seed),
    simulationVersion: run.simulation_version, generatorVersion: run.generator_version, configId: run.config_id,
    state: run.state, status: run.status, verificationStatus: run.verification_status, deliveryStatus: run.delivery_status,
    checkpointSequence: Number(run.checkpoint_sequence), writerGeneration: Number(run.writer_generation),
    activeTicks: Number(run.active_ticks), activeTickLimit: ACTIVE_TICK_LIMIT, submissionDeadline: submissionDeadline.toISOString(),
    ...(run.completion_reason ? { completionReason: run.completion_reason } : {}),
  };
}

/** Apply a checkpoint under a row lock and commit its effects atomically. */
export async function submitCheckpoint(pool: Pool, accountId: string, runId: string, req: CheckpointRequest, fixedNow?: Date, signal?: AbortSignal): Promise<unknown> {
  if (!Number.isSafeInteger(req.checkpointSequence) || req.checkpointSequence < 0 || !Number.isSafeInteger(req.writerGeneration) || req.writerGeneration < 1 ||
      typeof req.writerToken !== 'string' || typeof req.idempotencyKey !== 'string' || Buffer.byteLength(req.idempotencyKey, 'utf8') < 8 || Buffer.byteLength(req.idempotencyKey, 'utf8') > 128 ||
      !Array.isArray(req.ticks) || req.ticks.length < 1 || req.ticks.length > 120) throw new CheckpointError(400, 'invalid_checkpoint');
  const client = await acquireClient(pool, signal);
  let aborted = false;
  const cancel = () => { if (!aborted) { aborted = true; client.release(true); } };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    if (aborted) throw new Error('request cancelled');
    await client.query('BEGIN');
    const found = await client.query<RunRow>('SELECT * FROM core_runs WHERE id=$1 AND account_id=$2 FOR UPDATE', [runId, accountId]);
    const run = found.rows[0];
    let now = fixedNow ?? new Date();
    if (!run) throw new CheckpointError(404, 'not_found');
    const hash = createHash('sha256').update(req.writerToken).digest();
    if (!req.writerToken || req.writerGeneration !== Number(run.writer_generation) || run.writer_token_hash.length !== hash.length || !timingSafeEqual(hash, run.writer_token_hash)) throw new CheckpointError(409, 'writer_fenced');
    const expires = await deadline(client, run.last_contact, now);
    if (run.status === 'active' && now > expires) {
      await client.query("UPDATE core_runs SET status='rejected',verification_status='rejected' WHERE id=$1", [runId]);
      await client.query('COMMIT');
      throw new CheckpointError(410, 'submission_expired');
    }
    if (run.status === 'rejected') throw new CheckpointError(410, 'submission_expired');
    const digest = checkpointHash(req);
    const existing = await client.query<{ request_hash: Buffer; response: unknown }>('SELECT request_hash,response FROM core_checkpoints WHERE run_id=$1 AND (checkpoint_sequence=$2 OR idempotency_key=$3)', [runId, req.checkpointSequence, req.idempotencyKey]);
    if (existing.rows.length) {
      const old = existing.rows[0]!;
      if (old.request_hash.length !== digest.length || !timingSafeEqual(old.request_hash, digest)) throw new CheckpointError(409, 'idempotency_conflict');
      await client.query('COMMIT');
      return old.response;
    }
    if (run.status !== 'active') throw new CheckpointError(409, 'run_not_active');
    if (req.checkpointSequence !== Number(run.checkpoint_sequence) + 1) throw new CheckpointError(409, 'checkpoint_gap');
    let result;
    try { result = replayCheckpoint(run.state, Number(run.active_ticks), req.ticks); }
    catch { throw new CheckpointError(400, 'invalid_replay'); }
    now = fixedNow ?? new Date();
    run.state = result.state;
    run.checkpoint_sequence = String(req.checkpointSequence);
    run.active_ticks = String(result.activeTicks);
    run.last_contact = now;
    run.completion_reason = result.reason || null;
    if (result.reason) { run.status = 'completed'; run.verification_status = 'verified'; run.delivery_status = 'pending'; }
    await client.query(`UPDATE core_runs SET state=$2,status=$3,verification_status=$4,delivery_status=$5,checkpoint_sequence=$6,active_ticks=$7,last_contact=$8,completed_at=$9,completion_reason=$10 WHERE id=$1`,
      [runId, JSON.stringify(run.state), run.status, run.verification_status, run.delivery_status, req.checkpointSequence, result.activeTicks, now, result.reason ? now : null, run.completion_reason]);
    if (result.reason) {
      const eventId = randomUUID();
      await client.query('INSERT INTO core_account_progress(account_id,best_score) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET best_score=GREATEST(core_account_progress.best_score,EXCLUDED.best_score),updated_at=now()', [accountId, result.state.score]);
      const body = { event_id: eventId, type: 'RunLifeCompleted.v1', account_id: accountId, run_id: runId, life_index: run.life_index,
        simulation_version: run.simulation_version, generator_version: run.generator_version, config_id: run.config_id,
        checkpoint_sequence: req.checkpointSequence, score: result.state.score, collections: { FEATHER: result.state.totals.FEATHER ?? 0, GAME_STAR: result.state.totals.GAME_STAR ?? 0 }, reason: result.reason, completed_at: now.toISOString() };
      await client.query('INSERT INTO core_outbox(event_id,run_id,body,next_attempt_at) VALUES($1,$2,$3,$4)', [eventId, runId, JSON.stringify(body), now]);
      await client.query('UPDATE core_runs SET completion_event_id=$2 WHERE id=$1', [runId, eventId]);
    }
    const response = snapshot(run, await deadline(client, now, now));
    const evidence = { version: 1, checkpointSequence: req.checkpointSequence, writerGeneration: req.writerGeneration, idempotencyKey: req.idempotencyKey, ticks: req.ticks };
    await client.query('INSERT INTO core_checkpoints(run_id,checkpoint_sequence,idempotency_key,request_hash,input_batch,response) VALUES($1,$2,$3,$4,$5,$6)', [runId, req.checkpointSequence, req.idempotencyKey, digest, JSON.stringify(evidence), JSON.stringify(response)]);
    await client.query('COMMIT');
    return response;
  } catch (error) {
    if (!aborted) await client.query('ROLLBACK');
    throw error;
  } finally { signal?.removeEventListener('abort', cancel); if (!aborted) client.release(); }
}
