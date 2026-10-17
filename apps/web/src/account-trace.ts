import type { InputFrame } from '@doofy-duck/game-sim';

export type TraceTick = readonly InputFrame[];
export type PendingCheckpoint = {
  sequence: number;
  idempotencyKey: string;
  ticks: TraceTick[];
};
export type AccountTrace = {
  accountId: string;
  runId: string;
  writerGeneration: number;
  writerToken: string;
  nextCheckpointSequence: number;
  activeTicks: number;
  unsentTicks: TraceTick[];
  pending: PendingCheckpoint[];
};

export interface TraceStorage {
  readonly persistent: boolean;
  load(accountId: string, runId: string): Promise<AccountTrace | undefined>;
  save(trace: AccountTrace): Promise<void>;
  remove(accountId: string, runId: string, writerGeneration?: number): Promise<void>;
  clearAccount(accountId: string): Promise<void>;
}

const DB_NAME = 'doofy-duck-account-traces';
const STORE_NAME = 'traces';
const BATCH_SIZE = 120;
const MAX_ACTIVE_TICKS = 216_000;

function traceKey(accountId: string, runId: string): string { return `${accountId}:${runId}`; }

function checkpointKeyRange(key: string): IDBKeyRange {
  const prefix = `${key}:checkpoint:`;
  return IDBKeyRange.bound(prefix, `${prefix}\uffff`);
}

function accountKeyRange(accountId: string): IDBKeyRange {
  const prefix = `${accountId}:`;
  return IDBKeyRange.bound(prefix, `${prefix}\uffff`);
}

export function isValidStoredTrace(value: unknown, accountId: string, runId: string): value is AccountTrace {
  if (!value || typeof value !== 'object') return false;
  const trace = value as Partial<AccountTrace>;
  if (trace.accountId !== accountId || trace.runId !== runId
    || !Number.isSafeInteger(trace.writerGeneration) || trace.writerGeneration! < 1
    || typeof trace.writerToken !== 'string' || trace.writerToken.length < 1 || trace.writerToken.length > 512
    || !Number.isSafeInteger(trace.nextCheckpointSequence) || trace.nextCheckpointSequence! < 0
    || !Number.isSafeInteger(trace.activeTicks) || trace.activeTicks! < 0 || trace.activeTicks! > MAX_ACTIVE_TICKS
    || !Array.isArray(trace.unsentTicks) || trace.unsentTicks.length >= BATCH_SIZE
    || !Array.isArray(trace.pending)) return false;

  const allTicks: TraceTick[] = [...trace.pending.flatMap((item) => item?.ticks ?? []), ...trace.unsentTicks];
  if (allTicks.length > MAX_ACTIVE_TICKS || allTicks.length > trace.activeTicks!) return false;
  let lastInputSequence = -1;
  for (const tick of allTicks) {
    if (!Array.isArray(tick) || tick.length > 1) return false;
    for (const input of tick) {
      if (!input || !Number.isSafeInteger(input.sequence) || input.sequence < 0 || input.action !== 'FLAP'
        || (lastInputSequence >= 0 && input.sequence !== lastInputSequence + 1)) return false;
      lastInputSequence = input.sequence;
    }
  }

  let previousSequence = -1;
  for (const checkpoint of trace.pending) {
    if (!checkpoint || !Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence <= previousSequence
      || checkpoint.sequence >= trace.nextCheckpointSequence!
      || (previousSequence >= 0 && checkpoint.sequence !== previousSequence + 1)
      || typeof checkpoint.idempotencyKey !== 'string' || checkpoint.idempotencyKey.length < 1 || checkpoint.idempotencyKey.length > 128
      || !Array.isArray(checkpoint.ticks) || checkpoint.ticks.length < 1 || checkpoint.ticks.length > BATCH_SIZE) return false;
    previousSequence = checkpoint.sequence;
  }
  if (previousSequence >= 0 && previousSequence !== trace.nextCheckpointSequence! - 1) return false;
  return true;
}

export function appendTraceTick(trace: AccountTrace, inputs: TraceTick): AccountTrace {
  const next = { ...trace, activeTicks: trace.activeTicks + 1, unsentTicks: [...trace.unsentTicks, [...inputs]] };
  if (next.unsentTicks.length < BATCH_SIZE) return next;
  return checkpointPendingTicks(next);
}

export function checkpointPendingTicks(trace: AccountTrace): AccountTrace {
  if (trace.unsentTicks.length === 0) return trace;
  const checkpoint: PendingCheckpoint = {
    sequence: trace.nextCheckpointSequence,
    idempotencyKey: crypto.randomUUID(),
    ticks: trace.unsentTicks,
  };
  return {
    ...trace,
    nextCheckpointSequence: trace.nextCheckpointSequence + 1,
    unsentTicks: [],
    pending: [...trace.pending, checkpoint],
  };
}

export function acknowledgeCheckpoint(trace: AccountTrace, checkpointSequence: number, serverActiveTicks: number): AccountTrace {
  return {
    ...trace,
    activeTicks: Math.max(trace.activeTicks, serverActiveTicks),
    pending: trace.pending.filter((checkpoint) => checkpoint.sequence > checkpointSequence),
  };
}

export function acknowledgeLatestTrace(
  latest: AccountTrace,
  submitted: AccountTrace,
  checkpointSequence: number,
  serverActiveTicks: number,
): AccountTrace {
  if (latest.accountId !== submitted.accountId || latest.runId !== submitted.runId
    || latest.writerGeneration !== submitted.writerGeneration) return latest;
  return acknowledgeCheckpoint(latest, checkpointSequence, serverActiveTicks);
}

export class MemoryTraceStorage implements TraceStorage {
  readonly persistent = false;
  private readonly traces = new Map<string, AccountTrace>();

  async load(accountId: string, runId: string) { return this.traces.get(traceKey(accountId, runId)); }
  async save(trace: AccountTrace) {
    const key = traceKey(trace.accountId, trace.runId);
    if ((this.traces.get(key)?.writerGeneration ?? 0) > trace.writerGeneration) return;
    this.traces.set(key, trace);
  }
  async remove(accountId: string, runId: string, writerGeneration?: number) {
    const key = traceKey(accountId, runId);
    const current = this.traces.get(key);
    if (writerGeneration !== undefined && current?.writerGeneration !== writerGeneration) return;
    this.traces.delete(key);
  }
  async clearAccount(accountId: string) {
    for (const [key, trace] of this.traces) if (trace.accountId === accountId) this.traces.delete(key);
  }
}

function openTraceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed to open'));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export class IndexedDbTraceStorage implements TraceStorage {
  private readonly memory = new MemoryTraceStorage();
  private readonly knownPending = new Map<string, { revision: number; sequences: Set<number> }>();
  private failed = false;
  constructor(private readonly database: Promise<IDBDatabase> = openTraceDatabase()) {}
  get persistent(): boolean { return !this.failed; }

  async load(accountId: string, runId: string): Promise<AccountTrace | undefined> {
    if (this.failed) return this.memory.load(accountId, runId);
    try {
      const db = await this.database;
      const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
      const key = traceKey(accountId, runId);
      const [meta, records] = await Promise.all([
        idbRequest(store.get(`${key}:meta`)) as Promise<{ trace?: { storageRevision?: number } & object } | undefined>,
        idbRequest(store.getAll(checkpointKeyRange(key))) as Promise<{ key: string; checkpoint?: unknown }[]>,
      ]);
      if (!meta?.trace) return undefined;
      const checkpointRecords = records.sort((left, right) =>
        Number(left.key.slice(`${key}:checkpoint:`.length)) - Number(right.key.slice(`${key}:checkpoint:`.length)));
      const pending = checkpointRecords.map((record) => record.checkpoint);
      const candidate = { ...(meta.trace as object), pending };
      if (!isValidStoredTrace(candidate, accountId, runId)) return undefined;
      if (checkpointRecords.some((record, index) => record.key !== `${key}:checkpoint:${candidate.pending[index]?.sequence}`)) return undefined;
      const revision = meta.trace.storageRevision;
      if (Number.isSafeInteger(revision)) {
        this.knownPending.set(key, { revision: revision as number, sequences: new Set(candidate.pending.map(({ sequence }) => sequence)) });
      } else {
        this.knownPending.delete(key);
      }
      return structuredClone(candidate);
    } catch {
      this.failed = true;
      return this.memory.load(accountId, runId);
    }
  }

  async save(trace: AccountTrace): Promise<void> {
    if (this.failed) return this.memory.save(trace);
    try {
      const db = await this.database;
      const key = traceKey(trace.accountId, trace.runId);
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const transactionResult = transactionDone(transaction);
      const store = transaction.objectStore(STORE_NAME);
      const knownPending = this.knownPending.get(key);
      const metaRequest = idbRequest(store.get(`${key}:meta`)) as Promise<{ trace?: { writerGeneration?: number; storageRevision?: number } } | undefined>;
      const meta = await metaRequest;
      if (Number.isSafeInteger(meta?.trace?.writerGeneration) && meta!.trace!.writerGeneration! > trace.writerGeneration) {
        await transactionResult;
        return;
      }
      const revision = Number.isSafeInteger(meta?.trace?.storageRevision) ? meta!.trace!.storageRevision! : 0;
      const hasCurrentCache = meta?.trace !== undefined && knownPending?.revision === revision;
      const checkpointKeysRequest = !hasCurrentCache
        ? idbRequest(store.getAllKeys(checkpointKeyRange(key))) as Promise<IDBValidKey[]>
        : Promise.resolve([] as IDBValidKey[]);
      const checkpointKeys = await checkpointKeysRequest;
      const previous = hasCurrentCache ? knownPending!.sequences : new Set(checkpointKeys
        .filter((checkpointKey): checkpointKey is string => typeof checkpointKey === 'string')
        .map((checkpointKey) => Number(checkpointKey.slice(`${key}:checkpoint:`.length))));
      const nextSet = new Set(trace.pending.map(({ sequence }) => sequence));
      for (const checkpoint of trace.pending) {
        if (!previous.has(checkpoint.sequence)) store.put({ key: `${key}:checkpoint:${checkpoint.sequence}`, checkpoint: structuredClone(checkpoint) });
      }
      for (const sequence of previous) if (!nextSet.has(sequence)) store.delete(`${key}:checkpoint:${sequence}`);
      const metadata = {
        accountId: trace.accountId, runId: trace.runId,
        storageRevision: revision + 1,
        writerGeneration: trace.writerGeneration, writerToken: trace.writerToken,
        nextCheckpointSequence: trace.nextCheckpointSequence, activeTicks: trace.activeTicks,
        unsentTicks: trace.unsentTicks,
      };
      store.put({ key: `${key}:meta`, trace: structuredClone(metadata) });
      await transactionResult;
      this.knownPending.set(key, { revision: revision + 1, sequences: nextSet });
    } catch {
      this.failed = true;
      await this.memory.save(trace);
    }
  }

  async remove(accountId: string, runId: string, writerGeneration?: number): Promise<void> {
    if (this.failed) return this.memory.remove(accountId, runId);
    try {
      const db = await this.database;
      const key = traceKey(accountId, runId);
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const done = transactionDone(transaction);
      const store = transaction.objectStore(STORE_NAME);
      const [meta, checkpointKeys] = await Promise.all([
        idbRequest(store.get(`${key}:meta`)) as Promise<{ trace?: { writerGeneration?: number } } | undefined>,
        idbRequest(store.getAllKeys(checkpointKeyRange(key))) as Promise<IDBValidKey[]>,
      ]);
      if (writerGeneration !== undefined && meta?.trace?.writerGeneration !== writerGeneration) {
        await done;
        return;
      }
      store.delete(`${key}:meta`);
      for (const checkpointKey of checkpointKeys) if (typeof checkpointKey === 'string') store.delete(checkpointKey);
      await done;
      this.knownPending.delete(key);
    } catch {
      this.failed = true;
      await this.memory.remove(accountId, runId);
    }
  }

  async clearAccount(accountId: string): Promise<void> {
    if (this.failed) return this.memory.clearAccount(accountId);
    try {
      const db = await this.database;
      const keys = await idbRequest(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys(accountKeyRange(accountId))) as IDBValidKey[];
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      for (const key of keys) if (typeof key === 'string') store.delete(key);
      await transactionDone(transaction);
      for (const key of this.knownPending.keys()) if (key.startsWith(`${accountId}:`)) this.knownPending.delete(key);
    } catch {
      this.failed = true;
      await this.memory.clearAccount(accountId);
    }
  }
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

export function createAccountTraceStorage(): TraceStorage {
  return new IndexedDbTraceStorage();
}
