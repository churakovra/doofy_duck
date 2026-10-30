import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

/** Deliver one leased completion, allowing recovery after a worker crash. */
export async function dispatchCompletion(pool: Pool, endpoint: string, token: string, send = fetch): Promise<boolean> {
  const client = await pool.connect();
  let event: { event_id: string; run_id: string; body: unknown; attempts: number; created_at: Date } | undefined;
  const lease = randomUUID();
  try {
    await client.query('BEGIN');
    const found = await client.query<typeof event extends undefined ? never : NonNullable<typeof event>>(`SELECT event_id,run_id,body,attempts,created_at FROM core_outbox WHERE
      (status='pending' AND next_attempt_at <= now()) OR (status='leased' AND lease_until <= now())
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
    event = found.rows[0];
    if (!event) { await client.query('COMMIT'); return false; }
    await client.query("UPDATE core_outbox SET status='leased',lease_until=now()+interval '30 seconds',lease_token=$2,attempts=attempts+1 WHERE event_id=$1", [event.event_id, lease]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  let status = 0;
  try {
    const response = await send(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(event.body), signal: AbortSignal.timeout(6000) });
    status = response.status;
    await response.body?.cancel();
  } catch { /* Retry transient transport failures. */ }
  if ((status >= 200 && status < 300) || [400, 409, 422].includes(status)) {
    const done = await pool.connect();
    try {
      await done.query('BEGIN');
      const delivered = status >= 200 && status < 300;
      const updated = await done.query(`UPDATE core_outbox SET status=$3,lease_until=NULL,lease_token=NULL,
        delivered_at=CASE WHEN $3='delivered' THEN now() ELSE NULL END,last_error=NULL
        WHERE event_id=$1 AND lease_token=$2 AND status='leased' RETURNING run_id`, [event.event_id, lease, delivered ? 'delivered' : 'rejected']);
      if (updated.rowCount) {
        const run = await done.query("UPDATE core_runs SET delivery_status=$2 WHERE id=$1 AND verification_status='verified' AND delivery_status='pending'", [event.run_id, delivered ? 'delivered' : 'rejected']);
        if (run.rowCount !== 1) throw new Error('verified run delivery state is not pending');
      }
      await done.query('COMMIT');
      console.log(JSON.stringify({ level: 'INFO', msg: 'completion_delivery', event_id: event.event_id, run_id: event.run_id, status: delivered ? 'delivered' : 'rejected', reason: delivered ? 'accepted' : 'permanent_rejection', http_status: status, attempt: event.attempts + 1 }));
      if (delivered && updated.rowCount) console.log(JSON.stringify({ level: 'INFO', msg: 'completion_delivery_age', outcome: 'delivered', age_ms: Math.max(0, Date.now() - event.created_at.getTime()) }));
    } catch (error) { await done.query('ROLLBACK'); throw error; }
    finally { done.release(); }
  } else {
    const baseSeconds = Math.min(300, 2 ** Math.min(event.attempts + 1, 8));
    const seconds = baseSeconds + Math.random() * Math.max(1, baseSeconds / 4);
    console.log(JSON.stringify({ level: 'WARN', msg: 'completion_delivery', event_id: event.event_id, run_id: event.run_id, status: 'pending_retry', reason: status ? 'remote_retryable_status' : 'transport_failed', http_status: status, attempt: event.attempts + 1 }));
    await pool.query("UPDATE core_outbox SET status='pending',lease_until=NULL,lease_token=NULL,next_attempt_at=now()+$3::double precision*interval '1 second',last_error=$4 WHERE event_id=$1 AND status='leased' AND lease_token=$2", [event.event_id, lease, seconds, `completion delivery failed (${status})`]);
  }
  return true;
}
