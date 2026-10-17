import { describe, expect, it } from 'vitest';
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
});
