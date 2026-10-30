import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRun, createRunDescriptor } from '@doofy-duck/game-sim';
import { CheckpointError, submitCheckpoint } from '../src/checkpoint-store.js';
import { dispatchCompletion } from '../src/outbox.js';
import { createCoreServer } from '../src/server.js';
import { migrate } from '../src/migrations.js';

const url = process.env.CORE_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('checkpoint PostgreSQL transactions', () => {
  const schema = `ts_core_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: url });
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
  const account = randomUUID();
  const runId = randomUUID();
  const token = 'writer-token';
  const request = { checkpointSequence: 0, writerGeneration: 1, writerToken: token, idempotencyKey: 'checkpoint-000', ticks: [[{ sequence: 0, action: 'FLAP' as const }]] };
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await Promise.all([migrate(pool), migrate(pool)]);
    expect((await pool.query('SELECT count(*)::int AS n FROM core_schema_migrations')).rows[0].n).toBe(4);
    const descriptor = createRunDescriptor({ runId, seed: 7 });
    const state = createRun(descriptor);
    await pool.query(`INSERT INTO core_runs(id,account_id,seed,simulation_version,generator_version,config_id,state,status,writer_token_hash,last_contact)
      VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,now())`, [runId, account, descriptor.seed, descriptor.simulationVersion, descriptor.generatorVersion,
      descriptor.configId, JSON.stringify(state), createHash('sha256').update(token).digest()]);
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); });
  it('serializes duplicate submissions and returns the stored response', async () => {
    const [first, second] = await Promise.all([submitCheckpoint(pool, account, runId, request), submitCheckpoint(pool, account, runId, request)]);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ checkpointSequence: 0, activeTicks: 1, status: 'active' });
    const rows = await pool.query('SELECT count(*)::int AS n FROM core_checkpoints');
    expect(rows.rows[0].n).toBe(1);
  });
  it('rejects conflicts, gaps, stale writers, and foreign accounts', async () => {
    for (const [changes, code] of [[{ ticks: [[{ sequence: 0, action: 'FLAP' }], []] }, 'idempotency_conflict'], [{ checkpointSequence: 2, idempotencyKey: 'checkpoint-002' }, 'checkpoint_gap'], [{ writerGeneration: 2 }, 'writer_fenced']] as const) {
      await expect(submitCheckpoint(pool, account, runId, { ...request, ...changes })).rejects.toMatchObject({ code });
    }
    await expect(submitCheckpoint(pool, randomUUID(), runId, request)).rejects.toBeInstanceOf(CheckpointError);
  });
  it('commits terminal state, progress, and one outbox event atomically', async () => {
    const row = await pool.query('SELECT state FROM core_runs WHERE id=$1', [runId]);
    const state = row.rows[0].state;
    state.duck.y = state.config.pipes.floorY - 1;
    state.duck.vy = 0;
    await pool.query('UPDATE core_runs SET state=$2 WHERE id=$1', [runId, JSON.stringify(state)]);
    const next = { ...request, checkpointSequence: 1, idempotencyKey: 'checkpoint-001', ticks: [[]] };
    const result = await submitCheckpoint(pool, account, runId, next);
    expect(result).toMatchObject({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'pending', completionReason: 'death' });
    expect((await pool.query('SELECT count(*)::int AS n FROM core_outbox')).rows[0].n).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM core_account_progress')).rows[0].n).toBe(1);
    expect(await submitCheckpoint(pool, account, runId, next)).toEqual(result);
  });
  it('retries failed delivery and atomically marks a successful receipt', async () => {
    const unavailable: typeof fetch = async () => new Response('', { status: 503 });
    const accepted: typeof fetch = async () => new Response('', { status: 202 });
    expect(await dispatchCompletion(pool, 'https://example.test', 'secret', unavailable)).toBe(true);
    expect((await pool.query('SELECT status FROM core_outbox')).rows[0].status).toBe('pending');
    expect((await pool.query('SELECT delivery_status FROM core_runs WHERE id=$1', [runId])).rows[0].delivery_status).toBe('pending');
    await pool.query("UPDATE core_outbox SET next_attempt_at=now()-interval '1 second'");
    expect(await dispatchCompletion(pool, 'https://example.test', 'secret', accepted)).toBe(true);
    expect((await pool.query('SELECT status FROM core_outbox')).rows[0].status).toBe('delivered');
    expect((await pool.query('SELECT delivery_status FROM core_runs WHERE id=$1', [runId])).rows[0].delivery_status).toBe('delivered');
    expect(await dispatchCompletion(pool, 'https://example.test', 'secret', accepted)).toBe(false);
  });

  it('serves authenticated run creation, checkpoint, takeover and recovery', async () => {
    const pair = generateKeyPairSync('ed25519');
    const key = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
    const user = randomUUID(); const now = Math.floor(Date.now()/1000);
    const raw = [{ alg: 'EdDSA', kid: 'key' }, { iss: 'doofy-platform', aud: 'doofy-core', sub: user, jti: randomUUID(), iat: now, exp: now+600, scope: ['run:write'] }].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    const jwt = `${raw}.${sign(null, Buffer.from(raw), pair.privateKey).toString('base64url')}`;
    const server = createCoreServer(pool, { key }, 'operator-secret');
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw Error('invalid address');
    const base = `http://127.0.0.1:${address.port}`;
    const call = (path: string, method = 'GET', value?: unknown) => fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    try {
      expect((await fetch(`${base}/readyz`)).status).toBe(200);
      await pool.query('DELETE FROM core_schema_migrations WHERE version=4');
      expect((await fetch(`${base}/readyz`)).status).toBe(503);
      await pool.query("INSERT INTO core_schema_migrations(version,name) VALUES(4,'004_verified_completion_delivery_lifecycle.sql')");
      expect((await fetch(`${base}/api/v1/runs/current`)).status).toBe(401);
      const created = await call('/api/v1/runs', 'POST'); expect(created.status).toBe(201);
      const run = await created.json() as { runId: string; writerToken: string };
      expect((await call('/api/v1/runs/current')).status).toBe(200);
      const req = { checkpointSequence: 0, writerGeneration: 1, writerToken: run.writerToken, idempotencyKey: 'integration-key', ticks: [[{ sequence: 0, action: 'FLAP' }]] };
      expect((await call(`/api/v1/runs/${run.runId}/checkpoints`, 'POST', req)).status).toBe(200);
      expect((await call(`/api/v1/runs/${run.runId}/checkpoints`, 'POST', req)).status).toBe(200);
      const takeover = await call(`/api/v1/runs/${run.runId}/takeover`, 'POST'); expect(takeover.status).toBe(200);
      expect((await call(`/api/v1/runs/${run.runId}/checkpoints`, 'POST', req)).status).toBe(409);
      const newWriter = await takeover.json() as { writerToken: string; writerGeneration: number };
      expect((await call(`/api/v1/runs/${run.runId}/abandon`, 'POST', { padding: 'x'.repeat(1_050_000) })).status).toBe(413);
      expect((await call(`/api/v1/runs/${run.runId}/abandon`, 'POST', newWriter)).status).toBe(400);
      expect((await call(`/api/v1/runs/${run.runId}/abandon`, 'POST', { writerToken: newWriter.writerToken, writerGeneration: newWriter.writerGeneration })).status).toBe(200);
      expect((await call('/api/v1/runs/latest')).status).toBe(200);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  it('processes concurrent isolated accounts without losing acknowledgements', async () => {
    const pair = generateKeyPairSync('ed25519');
    const key = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
    const server = createCoreServer(pool, { key }, 'operator-secret');
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw Error('invalid address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const durations = await Promise.all(Array.from({ length: 20 }, async () => {
        const user = randomUUID(), now = Math.floor(Date.now()/1000);
        const raw = [{ alg: 'EdDSA', kid: 'key' }, { iss: 'doofy-platform', aud: 'doofy-core', sub: user, jti: randomUUID(), iat: now, exp: now+600, scope: ['run:write'] }].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
        const jwt = `${raw}.${sign(null, Buffer.from(raw), pair.privateKey).toString('base64url')}`;
        const headers = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
        const created = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers });
        if (created.status !== 201) throw Error(`create status ${created.status}`);
        const run = await created.json() as { runId: string; writerToken: string };
        const start = performance.now();
        const response = await fetch(`${base}/api/v1/runs/${run.runId}/checkpoints`, { method: 'POST', headers, body: JSON.stringify({ checkpointSequence: 0, writerGeneration: 1, writerToken: run.writerToken, idempotencyKey: randomUUID(), ticks: [[{ sequence: 0, action: 'FLAP' }]] }) });
        if (response.status !== 200) throw Error(`checkpoint status ${response.status}`);
        return performance.now() - start;
      }));
      durations.sort((a, b) => a-b);
      expect(durations[18]).toBeLessThan(1000);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  it('persists an expired submission without creating a checkpoint', async () => {
    const id = randomUUID(), owner = randomUUID();
    const descriptor = createRunDescriptor({ runId: id, seed: 8 });
    await pool.query(`INSERT INTO core_runs(id,account_id,seed,simulation_version,generator_version,config_id,state,status,writer_token_hash,last_contact)
      VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,now()-interval '2 hours')`, [id, owner, descriptor.seed, descriptor.simulationVersion, descriptor.generatorVersion, descriptor.configId, JSON.stringify(createRun(descriptor)), createHash('sha256').update(token).digest()]);
    await expect(submitCheckpoint(pool, owner, id, request)).rejects.toMatchObject({ code: 'submission_expired' });
    expect((await pool.query('SELECT status,verification_status FROM core_runs WHERE id=$1', [id])).rows[0]).toEqual({ status: 'rejected', verification_status: 'rejected' });
    expect((await pool.query('SELECT count(*)::int AS n FROM core_checkpoints WHERE run_id=$1', [id])).rows[0].n).toBe(0);
  });

  it('extends a submission deadline across a recorded outage', async () => {
    const id = randomUUID(), owner = randomUUID();
    const descriptor = createRunDescriptor({ runId: id, seed: 9 });
    await pool.query(`INSERT INTO core_runs(id,account_id,seed,simulation_version,generator_version,config_id,state,status,writer_token_hash,last_contact)
      VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,now()-interval '90 minutes')`, [id, owner, descriptor.seed, descriptor.simulationVersion, descriptor.generatorVersion, descriptor.configId, JSON.stringify(createRun(descriptor)), createHash('sha256').update(token).digest()]);
    await pool.query("INSERT INTO core_outages(started_at,recovered_at) VALUES(now()-interval '50 minutes',now()-interval '10 minutes')");
    expect(await submitCheckpoint(pool, owner, id, request)).toMatchObject({ status: 'active', activeTicks: 1 });
  });
  it('rejects a failed checkpoint without persisting partial state', async () => {
    const id = randomUUID(), owner = randomUUID();
    const descriptor = createRunDescriptor({ runId: id, seed: 10 });
    await pool.query(`INSERT INTO core_runs(id,account_id,seed,simulation_version,generator_version,config_id,state,status,writer_token_hash,last_contact)
      VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,now())`, [id, owner, descriptor.seed, descriptor.simulationVersion, descriptor.generatorVersion, descriptor.configId, JSON.stringify(createRun(descriptor)), createHash('sha256').update(token).digest()]);
    await expect(submitCheckpoint(pool, owner, id, { ...request, ticks: [[{ sequence: 4, action: 'FLAP' }]] })).rejects.toMatchObject({ code: 'invalid_replay' });
    const row = (await pool.query('SELECT active_ticks, checkpoint_sequence FROM core_runs WHERE id=$1', [id])).rows[0];
    expect(row).toEqual({ active_ticks: '0', checkpoint_sequence: '-1' });
    expect((await pool.query('SELECT count(*)::int AS n FROM core_checkpoints WHERE run_id=$1', [id])).rows[0].n).toBe(0);
  });

  it('cancels a checkpoint waiting on a database lock without writing', async () => {
    const id = randomUUID(), owner = randomUUID();
    const descriptor = createRunDescriptor({ runId: id, seed: 11 });
    await pool.query(`INSERT INTO core_runs(id,account_id,seed,simulation_version,generator_version,config_id,state,status,writer_token_hash,last_contact)
      VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,now())`, [id, owner, descriptor.seed, descriptor.simulationVersion, descriptor.generatorVersion, descriptor.configId, JSON.stringify(createRun(descriptor)), createHash('sha256').update(token).digest()]);
    const locker = await pool.connect(); await locker.query('BEGIN'); await locker.query('SELECT id FROM core_runs WHERE id=$1 FOR UPDATE', [id]);
    try {
      const controller = new AbortController();
      const pending = submitCheckpoint(pool, owner, id, request, undefined, controller.signal);
      await new Promise(resolve => setTimeout(resolve, 50)); controller.abort();
      await expect(pending).rejects.toThrow();
    } finally { await locker.query('ROLLBACK'); locker.release(); }
    expect((await pool.query('SELECT count(*)::int AS n FROM core_checkpoints WHERE run_id=$1', [id])).rows[0].n).toBe(0);
  });

  it('checks expiry after waiting for the run lock', async () => {
    await pool.query('DELETE FROM core_outages');
    const id = randomUUID(), owner = randomUUID();
    const descriptor = createRunDescriptor({ runId: id, seed: 12 });
    await pool.query(`INSERT INTO core_runs(id,account_id,seed,simulation_version,generator_version,config_id,state,status,writer_token_hash,last_contact)
      VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,now()-interval '1 hour'+interval '200 milliseconds')`, [id, owner, descriptor.seed, descriptor.simulationVersion, descriptor.generatorVersion, descriptor.configId, JSON.stringify(createRun(descriptor)), createHash('sha256').update(token).digest()]);
    const locker = await pool.connect(); await locker.query('BEGIN'); await locker.query('SELECT id FROM core_runs WHERE id=$1 FOR UPDATE', [id]);
    const pending = submitCheckpoint(pool, owner, id, request);
    try { await new Promise(resolve => setTimeout(resolve, 350)); } finally { await locker.query('ROLLBACK'); locker.release(); }
    await expect(pending).rejects.toMatchObject({ code: 'submission_expired' });
  });

  it('bounds readiness when the database connection pool is saturated', async () => {
    const limited = new pg.Pool({ connectionString: url, max: 1, options: `-c search_path=${schema}` });
    const held = await limited.connect();
    const server = createCoreServer(limited, {}, 'operator-secret');
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw Error('invalid address');
    try {
      const start = performance.now();
      const response = await fetch(`http://127.0.0.1:${address.port}/readyz`);
      expect(response.status).toBe(503);
      expect(performance.now() - start).toBeLessThan(3000);
    } finally { held.release(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await limited.end(); }
  });

});
