import type { Pool, PoolClient } from 'pg';
import { expect, it, vi } from 'vitest';
import { acquireClient } from '../src/db.js';

it('releases a connection acquired after the waiting request is cancelled', async () => {
  let deliver!: (client: PoolClient) => void;
  const pool = { connect: () => new Promise<PoolClient>(resolve => { deliver = resolve; }) } as unknown as Pool;
  const release = vi.fn(); const controller = new AbortController();
  const result = acquireClient(pool, controller.signal);
  controller.abort();
  await expect(result).rejects.toThrow('request cancelled');
  deliver({ release } as unknown as PoolClient);
  await Promise.resolve();
  expect(release).toHaveBeenCalledOnce();
});
