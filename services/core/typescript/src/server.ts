import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import pg, { type Pool, type PoolClient } from 'pg';
import { createRun, createRunDescriptor } from '@doofy-duck/game-sim';
import { verifyAccessToken } from './auth.js';
import { CheckpointError, deadline, snapshot, submitCheckpoint, type RunRow } from './checkpoint-store.js';
import type { CheckpointRequest } from './checkpoint-hash.js';
import { dispatchCompletion } from './outbox.js';
import { migrate, migrationsReady } from './migrations.js';
import { acquireClient } from './db.js';

class HttpError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
const tokenHash = (token: string) => createHash('sha256').update(token).digest();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function respond(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage, signal: AbortSignal): Promise<Record<string, unknown>> {
  let size = 0; const chunks: Buffer[] = [];
  const cancel = () => req.destroy(new Error('request cancelled'));
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 1_048_576) { req.resume(); throw new HttpError(413, 'payload_too_large'); } chunks.push(bytes); }
  } finally { signal.removeEventListener('abort', cancel); }
  try { const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value as Record<string, unknown>; }
  catch { throw new HttpError(400, 'invalid_json'); }
}
function fields(obj: Record<string, unknown>, allowed: string[]): void { if (Object.keys(obj).some(k => !allowed.includes(k))) throw new HttpError(400, 'invalid_json'); }
async function transaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const client = await acquireClient(pool, signal);
  let aborted = false;
  const cancel = () => { if (!aborted) { aborted = true; client.release(true); } };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try { if (aborted) throw new Error('request cancelled'); await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { if (!aborted) await client.query('ROLLBACK'); throw error; } finally { signal?.removeEventListener('abort', cancel); if (!aborted) client.release(); }
}
async function load(client: PoolClient, account: string, id: string): Promise<RunRow> {
  if (!uuid.test(id)) throw new HttpError(404, 'not_found');
  const result = await client.query<RunRow>('SELECT * FROM core_runs WHERE id=$1 AND account_id=$2 FOR UPDATE', [id, account]);
  if (!result.rows[0]) throw new HttpError(404, 'not_found'); return result.rows[0];
}
async function expire(client: PoolClient, run: RunRow, now: Date): Promise<void> {
  if (run.status === 'active' && now > await deadline(client, run.last_contact, now)) {
    await client.query("UPDATE core_runs SET status='rejected',verification_status='rejected' WHERE id=$1", [run.id]); run.status = 'rejected'; run.verification_status = 'rejected';
  }
}
function writer(run: RunRow, generation: unknown, token: unknown): boolean {
  if (generation !== Number(run.writer_generation) || typeof token !== 'string' || !token) return false;
  const hash = tokenHash(token); return run.writer_token_hash.length === hash.length && timingSafeEqual(run.writer_token_hash, hash);
}
export function createCoreServer(pool: Pool, keys: Readonly<Record<string, string>>, operatorToken: string, maxInflight = 256) {
  let active = 0;
  const waiters: Array<() => void> = [];
  async function acquire(res: ServerResponse): Promise<boolean> {
    if (active < maxInflight) { active++; return true; }
    if (waiters.length >= 1024) return false;
    return new Promise(resolve => {
      const cleanup = () => { clearTimeout(timer); res.off('close', cancel); };
      const grant = () => { cleanup(); resolve(true); };
      const cancel = () => { const index = waiters.indexOf(grant); if (index >= 0) waiters.splice(index, 1); cleanup(); resolve(false); };
      waiters.push(grant);
      res.once('close', cancel);
      const timer = setTimeout(cancel, 5000);
    });
  }
  function release(): void { const next = waiters.shift(); if (next) next(); else active--; }
  return createServer(async (req, res) => {
    const started = Date.now();
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const requestId = typeof req.headers['x-request-id'] === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(req.headers['x-request-id']) ? req.headers['x-request-id'] : randomUUID();
    res.setHeader('X-Request-ID', requestId);
    const route = path.replace(/\/api\/v1\/runs\/[0-9a-f-]{36}/i, '/api/v1/runs/{run_id}').replace(/\/internal\/v1\/outages\/[0-9a-f-]{36}/i, '/internal/v1/outages/{id}');
    const knownRoute = /^\/(?:healthz|readyz|api\/v1\/runs(?:\/(?:current|latest|progress|\{run_id\}(?:\/(?:checkpoints|takeover|abandon))?))?|internal\/v1\/outages\/(?:start|\{id\}\/recover))$/.test(route) ? route : 'unmatched';
    res.once('finish', () => console.log(JSON.stringify({ level: 'INFO', msg: 'http_request', request_id: requestId, method: ['GET', 'POST'].includes(req.method ?? '') ? req.method : 'OTHER', route: knownRoute, status: res.statusCode, duration_ms: Date.now() - started })));
    try {
      if (req.method === 'GET' && path === '/healthz') return respond(res, 200, { status: 'ok' });
      if (req.method === 'GET' && path === '/readyz') {
        try { if (await transaction(pool, client => migrationsReady(client), AbortSignal.timeout(2000))) return respond(res, 200, { status: 'ready' }); } catch { /* Not ready until schema is reachable and complete. */ }
        return respond(res, 503, { status: 'not_ready' });
      }
      const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? '';
      const operatorRoute = path.startsWith('/internal/v1/outages');
      let account = '';
      if (operatorRoute) {
        const given = Buffer.from(bearer), expected = Buffer.from(operatorToken);
        if (!operatorToken || given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, 'unauthorized');
      } else {
        try { account = verifyAccessToken(bearer, keys); } catch { throw new HttpError(401, 'unauthorized'); }
      }
      const admissionStart = Date.now();
      const admitted = await acquire(res);
      console.log(JSON.stringify({ level: 'INFO', msg: 'admission_state', outcome: admitted ? 'admitted' : 'rejected', active, waiting: waiters.length, wait_ms: Date.now() - admissionStart }));
      if (!admitted) { if (res.destroyed) return; res.setHeader('Retry-After', '1'); return respond(res, 429, { error: { code: 'overloaded', message: 'overloaded' } }); }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const onClose = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', onClose);
      try {
        if (operatorRoute) {
          const request = await body(req, controller.signal);
          if (req.method === 'POST' && path === '/internal/v1/outages/start') {
            fields(request, ['startedAt']); const start = new Date(String(request.startedAt));
            if (!Number.isFinite(start.valueOf()) || start > new Date()) throw new HttpError(400, 'invalid_outage');
            const id = randomUUID(); await transaction(pool, client => client.query('INSERT INTO core_outages(id,started_at) VALUES($1,$2)', [id, start]), controller.signal); return respond(res, 201, { id, startedAt: start.toISOString() });
          }
          const outage = path.match(/^\/internal\/v1\/outages\/([^/]+)\/recover$/);
          if (req.method === 'POST' && outage && uuid.test(outage[1]!)) {
            fields(request, ['recoveredAt']); const end = new Date(String(request.recoveredAt));
            if (!Number.isFinite(end.valueOf()) || end > new Date()) throw new HttpError(400, 'invalid_outage');
            const result = await transaction(pool, client => client.query('UPDATE core_outages SET recovered_at=$2 WHERE id=$1 AND recovered_at IS NULL AND started_at <= $2', [outage[1], end]), controller.signal);
            if (!result.rowCount) throw new HttpError(404, 'not_found'); return respond(res, 200, { id: outage[1], recoveredAt: end.toISOString() });
          }
          throw new HttpError(404, 'not_found');
        }
        if (req.method === 'GET' && path === '/api/v1/runs/progress') {
          const result = await transaction(pool, client => client.query<{ best_score: string }>('SELECT COALESCE((SELECT best_score FROM core_account_progress WHERE account_id=$1),0) AS best_score', [account]), controller.signal);
          return respond(res, 200, { bestScore: Number(result.rows[0]!.best_score) });
        }
        if (req.method === 'POST' && path === '/api/v1/runs') {
          const created = await transaction(pool, async client => {
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [account]);
            const current = await client.query<RunRow>("SELECT * FROM core_runs WHERE account_id=$1 AND status IN ('active','completion_pending') ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [account]);
            const existing = current.rows[0];
            let now = new Date();
            if (existing) {
              if (existing.status === 'completion_pending') throw new HttpError(409, 'completion_pending');
              await expire(client, existing, now);
              if (existing.status === 'active') return { status: 200, value: snapshot(existing, await deadline(client, existing.last_contact, now)) };
            }
            now = new Date();
            const id = randomUUID(), seed = randomBytes(4).readUInt32BE(), descriptor = createRunDescriptor({ runId: id, seed }), state = createRun(descriptor), token = randomBytes(32).toString('base64url');
            const inserted = await client.query<RunRow>(`INSERT INTO core_runs(id,account_id,seed,simulation_version,generator_version,config_id,state,status,writer_token_hash,last_contact)
              VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$9) RETURNING *`, [id, account, seed, descriptor.simulationVersion, descriptor.generatorVersion, descriptor.configId, JSON.stringify(state), tokenHash(token), now]);
            return { status: 201, value: { ...snapshot(inserted.rows[0]!, await deadline(client, now, now)), writerToken: token } };
          }, controller.signal);
          if (created.status === 201) res.setHeader('Location', `/api/v1/runs/${created.value.runId}`);
          return respond(res, created.status, created.value);
        }
        if (req.method === 'GET' && (path === '/api/v1/runs/current' || path === '/api/v1/runs/latest')) {
          const current = path.endsWith('/current');
          const result = await transaction(pool, async client => {
            const rows = await client.query<RunRow>(`SELECT * FROM core_runs WHERE account_id=$1 ${current ? "AND status IN ('active','completion_pending')" : ''} ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`, [account]);
            const run = rows.rows[0]; if (!run) return null;
            const now = new Date();
            if (current) await expire(client, run, now);
            return current && run.status === 'rejected' ? null : snapshot(run, await deadline(client, run.last_contact, now));
          }, controller.signal);
          if (!result) throw new HttpError(404, 'not_found'); return respond(res, 200, result);
        }
        const match = path.match(/^\/api\/v1\/runs\/([^/]+)(?:\/(checkpoints|takeover|abandon))?$/);
        if (!match || !uuid.test(match[1]!)) throw new HttpError(404, 'not_found');
        const id = match[1]!, action = match[2];
        if (req.method === 'POST' && action === 'checkpoints') {
          const request = await body(req, controller.signal); fields(request, ['checkpointSequence', 'writerGeneration', 'writerToken', 'idempotencyKey', 'ticks']);
          if (!Array.isArray(request.ticks) || request.ticks.some(tick => !Array.isArray(tick) || tick.some((input: unknown) =>
            !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'sequence' && key !== 'action') ||
            !Number.isSafeInteger((input as Record<string, unknown>).sequence) || typeof (input as Record<string, unknown>).action !== 'string'))) throw new HttpError(400, 'invalid_json');
          return respond(res, 200, await submitCheckpoint(pool, account, id, request as unknown as CheckpointRequest, undefined, controller.signal));
        }
        if ((req.method === 'GET' && !action) || (req.method === 'POST' && (action === 'takeover' || action === 'abandon'))) {
          const request = action === 'abandon' ? await body(req, controller.signal) : {};
          if (action === 'abandon') fields(request, ['writerGeneration', 'writerToken']);
          const value = await transaction(pool, async client => {
            const run = await load(client, account, id);
            const now = new Date();
            if (!action) await expire(client, run, now);
            let newToken: string | undefined;
            if (action === 'takeover') {
              if (run.status !== 'active') throw new HttpError(409, 'run_not_active');
              newToken = randomBytes(32).toString('base64url'); run.writer_generation = String(Number(run.writer_generation) + 1);
              await client.query('UPDATE core_runs SET writer_generation=$2,writer_token_hash=$3 WHERE id=$1', [id, run.writer_generation, tokenHash(newToken)]);
            }
            if (action === 'abandon') {
              if (run.status !== 'active' || !writer(run, request.writerGeneration, request.writerToken)) throw new HttpError(409, 'writer_fenced');
              await client.query("UPDATE core_runs SET status='abandoned',verification_status='rejected' WHERE id=$1", [id]); run.status = 'abandoned'; run.verification_status = 'rejected';
            }
            return { ...snapshot(run, await deadline(client, run.last_contact, now)), ...(newToken ? { writerToken: newToken } : {}) };
          }, controller.signal);
          return respond(res, 200, value);
        }
        throw new HttpError(404, 'not_found');
      } finally { clearTimeout(timer); res.off('close', onClose); release(); console.log(JSON.stringify({ level: 'INFO', msg: 'admission_state', outcome: 'released', active, waiting: waiters.length, wait_ms: 0 })); }
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const status = error instanceof HttpError || error instanceof CheckpointError ? error.status : 503;
      const code = error instanceof HttpError || error instanceof CheckpointError ? error.code : 'database_error';
      return respond(res, status, { error: { code, message: code } });
    }
  });
}

function configuredInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

export async function startCore(): Promise<void> {
  const databaseURL = process.env.CORE_DATABASE_URL, rawKeys = process.env.ACCESS_TOKEN_PUBLIC_KEYS_JSON, endpoint = process.env.CORE_PLATFORM_COMPLETION_URL, token = process.env.CORE_TO_PLATFORM_TOKEN, operator = process.env.CORE_OPERATOR_TOKEN;
  if (!databaseURL || !rawKeys || !endpoint || !token || !operator) throw Error('missing Core configuration');
  const keys: unknown = JSON.parse(rawKeys);
  if (!keys || typeof keys !== 'object' || Array.isArray(keys) || !Object.keys(keys).length || Object.entries(keys).some(([id, key]) => !id.trim() || typeof key !== 'string' || Buffer.from(key, 'base64url').length !== 32)) throw Error('invalid Core keys');
  const pool = new pg.Pool({ connectionString: databaseURL, max: configuredInt('CORE_DB_MAX_CONNECTIONS', 32, 2, 256), connectionTimeoutMillis: 5000, options: '-c statement_timeout=30000 -c lock_timeout=30000' });
  try { await pool.query('SELECT 1'); if (process.env.CORE_AUTO_MIGRATE === 'true') await migrate(pool); } catch (error) { await pool.end(); throw error; }
  const server = createCoreServer(pool, keys as Record<string, string>, operator, configuredInt('CORE_MAX_INFLIGHT_REQUESTS', 256, 1, 4096));
  server.headersTimeout = 5000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 60000;
  let stopping = false;
  const work = async () => { while (!stopping) { try { if (await dispatchCompletion(pool, endpoint, token)) continue; } catch { console.error(JSON.stringify({ level: 'WARN', msg: 'completion_dispatch_failed', status: 'retrying', reason: 'dispatch_failed' })); } await new Promise(resolve => setTimeout(resolve, 1000)); } };
  const workers = Array.from({ length: configuredInt('CORE_OUTBOX_WORKERS', 4, 1, 32) }, () => work());
  const backlogTimer = setInterval(() => { void transaction(pool, client => client.query<{ pending: string; retrying: string; oldest_age_ms: string }>(`SELECT count(*) AS pending,
    count(*) FILTER (WHERE (status='pending' AND attempts>0) OR (status='leased' AND attempts>1)) AS retrying,
    COALESCE(GREATEST(0,extract(epoch FROM (now()-min(created_at)))*1000),0) AS oldest_age_ms FROM core_outbox WHERE status IN ('pending','leased')`), AbortSignal.timeout(2000))
    .then(result => console.log(JSON.stringify({ level: 'INFO', msg: 'completion_backlog', pending: Number(result.rows[0]?.pending ?? 0), retrying: Number(result.rows[0]?.retrying ?? 0), oldest_age_ms: Math.floor(Number(result.rows[0]?.oldest_age_ms ?? 0)) })))
    .catch(() => console.error(JSON.stringify({ level: 'WARN', msg: 'completion_backlog_sample_failed', reason: 'query_failed' }))); }, 30000);
  const address = process.env.CORE_LISTEN_ADDR ?? ':8080';
  const match = address.match(/^(.*):(\d+)$/);
  if (!match) { stopping = true; clearInterval(backlogTimer); await Promise.all(workers); await pool.end(); throw Error('invalid listen address'); }
  server.listen(Number(match[2]), match[1] || '0.0.0.0');
  const stop = () => {
    stopping = true;
    clearInterval(backlogTimer);
    server.close(() => { void Promise.all(workers).then(() => pool.end()); });
    setTimeout(() => server.closeAllConnections(), 10000).unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
