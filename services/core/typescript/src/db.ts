import type { Pool, PoolClient } from 'pg';

/** Release late connections if a request expires while waiting for the pool. */
export async function acquireClient(pool: Pool, signal?: AbortSignal): Promise<PoolClient> {
  if (!signal) return pool.connect();
  if (signal.aborted) throw new Error('request cancelled');
  return new Promise((resolve, reject) => {
    let cancelled = false;
    const abort = () => { cancelled = true; reject(new Error('request cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
    void pool.connect().then(client => {
      signal.removeEventListener('abort', abort);
      if (cancelled || signal.aborted) { client.release(); if (!cancelled) reject(new Error('request cancelled')); }
      else resolve(client);
    }, error => { signal.removeEventListener('abort', abort); if (!cancelled) reject(error); });
    if (signal.aborted) abort();
  });
}
