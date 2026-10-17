import { describe, expect, it, vi } from 'vitest';
import { acknowledgeCheckpoint, acknowledgeLatestTrace, appendTraceTick, IndexedDbTraceStorage, isValidStoredTrace, MemoryTraceStorage, type AccountTrace } from './account-trace';

function newTrace(): AccountTrace {
  return {
    accountId: 'account-a', runId: 'run-a', writerGeneration: 1, writerToken: 'writer-secret',
    nextCheckpointSequence: 0, activeTicks: 0, unsentTicks: [], pending: [],
  };
}

describe('account replay trace', () => {
  it('records empty and input ticks exactly and forms contiguous 120 tick batches', () => {
    let trace = appendTraceTick(newTrace(), [{ sequence: 0, action: 'FLAP' }]);
    trace = appendTraceTick(trace, []);
    expect(trace.unsentTicks).toEqual([[{ sequence: 0, action: 'FLAP' }], []]);
    expect(trace.activeTicks).toBe(2);
    for (let index = 2; index < 120; index++) trace = appendTraceTick(trace, []);
    expect(trace.pending).toHaveLength(1);
    expect(trace.pending[0]?.sequence).toBe(0);
    expect(trace.pending[0]?.ticks).toHaveLength(120);
    expect(trace.unsentTicks).toEqual([]);
  });

  it('drops only server-acknowledged checkpoints when reconciling a snapshot', () => {
    let trace = newTrace();
    for (let index = 0; index < 240; index++) trace = appendTraceTick(trace, []);
    trace = acknowledgeCheckpoint(trace, 0, 120);
    expect(trace.pending.map(({ sequence }) => sequence)).toEqual([1]);
    expect(trace.activeTicks).toBe(240);
  });

  it('keeps ticks appended while a checkpoint request is in flight', () => {
    let submitted = newTrace();
    for (let index = 0; index < 120; index++) submitted = appendTraceTick(submitted, []);
    const checkpoint = submitted.pending[0]!;
    let latest = submitted;
    for (let index = 0; index < 7; index++) latest = appendTraceTick(latest, []);
    const acknowledged = acknowledgeLatestTrace(latest, submitted, checkpoint.sequence, 120);

    expect(acknowledged.pending).toEqual([]);
    expect(acknowledged.unsentTicks).toHaveLength(7);
    expect(acknowledged.activeTicks).toBe(127);
  });

  it('falls back to memory and exposes that persistence is unavailable', async () => {
    const memoryFallback = new IndexedDbTraceStorage(Promise.reject(new Error('denied')));
    await memoryFallback.save(newTrace());
    expect(memoryFallback.persistent).toBe(false);
    expect(await memoryFallback.load('account-a', 'run-a')).toMatchObject({ writerToken: 'writer-secret' });
  });

  it('rejects corrupt or foreign persisted traces before they can be replayed', () => {
    const valid = newTrace();
    expect(isValidStoredTrace(valid, 'account-a', 'run-a')).toBe(true);
    expect(isValidStoredTrace({ ...valid, accountId: 'account-b' }, 'account-a', 'run-a')).toBe(false);
    expect(isValidStoredTrace({ ...valid, activeTicks: 216_001 }, 'account-a', 'run-a')).toBe(false);
    expect(isValidStoredTrace({ ...valid, writerToken: '' }, 'account-a', 'run-a')).toBe(false);
    expect(isValidStoredTrace({ ...valid, unsentTicks: [[{ sequence: 4, action: 'TELEPORT' }]] }, 'account-a', 'run-a')).toBe(false);
    expect(isValidStoredTrace({ ...valid, pending: [{ sequence: 3, idempotencyKey: 'key', ticks: [[]] }] }, 'account-a', 'run-a')).toBe(false);
    let longTrace = newTrace();
    for (let index = 0; index < 1_320; index++) longTrace = appendTraceTick(longTrace, []);
    expect(isValidStoredTrace(longTrace, 'account-a', 'run-a')).toBe(true);
  });

  it('does not let a fenced writer overwrite a trace rebound to a newer generation', async () => {
    const storage = new MemoryTraceStorage();
    const current = { ...newTrace(), writerGeneration: 2, writerToken: 'new-token' };
    await storage.save(current);
    await storage.save({ ...newTrace(), unsentTicks: [[{ sequence: 0, action: 'FLAP' }]], activeTicks: 1 });
    await storage.remove('account-a', 'run-a', 1);
    expect(await storage.load('account-a', 'run-a')).toMatchObject({ writerGeneration: 2, writerToken: 'new-token' });
  });

  it('does not reread earlier checkpoint payloads while saving appended ticks', async () => {
    vi.stubGlobal('IDBKeyRange', { bound: (lower: string, upper: string) => ({ lower, upper }) });
    try {
      const database = new TraceDatabaseFixture();
      const storage = new IndexedDbTraceStorage(Promise.resolve(database.asDatabase()));
      let trace = newTrace();
      for (let index = 0; index < 240; index++) {
        trace = appendTraceTick(trace, []);
        await storage.save(trace);
      }

      expect(database.wholeStoreReads).toBe(0);
      expect(database.checkpointPayloadReads).toBe(0);
      expect(database.keyOnlyReads).toBe(1);
      expect([...database.records.keys()].filter((key) => key.includes(':checkpoint:'))).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rebuilds pending checkpoints after another storage instance clears the account', async () => {
    vi.stubGlobal('IDBKeyRange', { bound: (lower: string, upper: string) => ({ lower, upper }) });
    try {
      const database = new TraceDatabaseFixture();
      const storageA = new IndexedDbTraceStorage(Promise.resolve(database.asDatabase()));
      const storageB = new IndexedDbTraceStorage(Promise.resolve(database.asDatabase()));
      let trace = newTrace();
      for (let index = 0; index < 120; index++) trace = appendTraceTick(trace, []);
      await storageA.save(trace);

      await storageB.clearAccount('account-a');
      trace = appendTraceTick(trace, []);
      await storageA.save(trace);

      const reloaded = await new IndexedDbTraceStorage(Promise.resolve(database.asDatabase())).load('account-a', 'run-a');
      expect(reloaded?.pending).toEqual(trace.pending);
      expect(reloaded?.unsentTicks).toEqual(trace.unsentTicks);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rebuilds pending checkpoints after another storage instance removes the run', async () => {
    vi.stubGlobal('IDBKeyRange', { bound: (lower: string, upper: string) => ({ lower, upper }) });
    try {
      const database = new TraceDatabaseFixture();
      const storageA = new IndexedDbTraceStorage(Promise.resolve(database.asDatabase()));
      const storageB = new IndexedDbTraceStorage(Promise.resolve(database.asDatabase()));
      let trace = newTrace();
      for (let index = 0; index < 120; index++) trace = appendTraceTick(trace, []);
      await storageA.save(trace);

      await storageB.remove('account-a', 'run-a');
      trace = appendTraceTick(trace, []);
      await storageA.save(trace);

      const reloaded = await new IndexedDbTraceStorage(Promise.resolve(database.asDatabase())).load('account-a', 'run-a');
      expect(reloaded?.pending).toEqual(trace.pending);
      expect(reloaded?.unsentTicks).toEqual(trace.unsentTicks);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not let an IndexedDB writer replace a trace from a newer generation', async () => {
    vi.stubGlobal('IDBKeyRange', { bound: (lower: string, upper: string) => ({ lower, upper }) });
    try {
      const database = new TraceDatabaseFixture();
      const storageA = new IndexedDbTraceStorage(Promise.resolve(database.asDatabase()));
      const storageB = new IndexedDbTraceStorage(Promise.resolve(database.asDatabase()));
      let oldTrace = newTrace();
      for (let index = 0; index < 120; index++) oldTrace = appendTraceTick(oldTrace, []);
      await storageA.save(oldTrace);

      const newTraceAtGeneration2 = { ...newTrace(), writerGeneration: 2, writerToken: 'new-writer' };
      await storageB.save(newTraceAtGeneration2);
      await storageA.save(oldTrace);

      const reloaded = await new IndexedDbTraceStorage(Promise.resolve(database.asDatabase())).load('account-a', 'run-a');
      expect(reloaded).toMatchObject({ writerGeneration: 2, writerToken: 'new-writer', pending: [] });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

class TraceDatabaseFixture {
  readonly records = new Map<string, { key: string; [name: string]: unknown }>();
  wholeStoreReads = 0;
  checkpointPayloadReads = 0;
  keyOnlyReads = 0;

  asDatabase(): IDBDatabase {
    return {
      transaction: () => {
        const transaction = {
          oncomplete: null as ((event: Event) => void) | null,
          onabort: null as ((event: Event) => void) | null,
          onerror: null as ((event: Event) => void) | null,
          objectStore: () => ({
            get: (key: string) => {
              if (key.includes(':checkpoint:')) this.checkpointPayloadReads++;
              this.completeLater(transaction);
              return this.request(this.records.get(key));
            },
            getAll: (range?: IDBKeyRange) => {
              this.wholeStoreReads++;
              this.completeLater(transaction);
              return this.request(this.select(range));
            },
            getAllKeys: (range?: IDBKeyRange) => {
              this.keyOnlyReads++;
              this.completeLater(transaction);
              return this.request(this.select(range).map(({ key }) => key));
            },
            put: (record: { key: string; [name: string]: unknown }) => {
              this.records.set(record.key, record);
              this.completeLater(transaction);
              return {};
            },
            delete: (key: string) => {
              this.records.delete(key);
              this.completeLater(transaction);
              return {};
            },
          }),
        };
        return transaction as unknown as IDBTransaction;
      },
    } as unknown as IDBDatabase;
  }

  private select(range?: IDBKeyRange) {
    const bounds = range as unknown as { lower?: string; upper?: string } | undefined;
    return [...this.records.values()].filter(({ key }) =>
      !bounds || ((bounds.lower === undefined || key >= bounds.lower) && (bounds.upper === undefined || key <= bounds.upper)));
  }

  private request<T>(result: T): IDBRequest<T> {
    const request = {
      result: undefined as T | undefined,
      error: null,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
    };
    queueMicrotask(() => {
      request.result = result;
      request.onsuccess?.(new Event('success'));
    });
    return request as unknown as IDBRequest<T>;
  }

  private completeLater(transaction: { oncomplete: ((event: Event) => void) | null }) {
    setTimeout(() => transaction.oncomplete?.(new Event('complete')), 0);
  }
}
