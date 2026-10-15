import { describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '@doofy-duck/game-sim';
import { createLocalProgressSession } from './local-progress';
import type { StorageLike } from './storage';
import type { WalletLocks } from './wallet-session';

const walletKey = 'doofy-duck:wallet:v1';
const bestKey = 'doofy-duck:best:v1';
const zero = { FEATHER: 0, GAME_STAR: 0 };

function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  const writes: Array<[string, string]> = [];
  const storage: StorageLike = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { writes.push([key, value]); values.set(key, value); },
  };
  return { storage, values, writes };
}

function ended(runId: string, score: number, totals: Record<string, number>): Extract<GameEvent, { type: 'RunEnded' }> {
  return { type: 'RunEnded', runId, score, totals, tick: 10 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('local progress session', () => {
  it('restores wallet and deduplication IDs only after acquiring ownership', async () => {
    const prior = { version: 1, balances: { FEATHER: 8, GAME_STAR: 3 }, settledRunIds: ['old-run'] };
    const { storage } = memoryStorage({ [walletKey]: JSON.stringify(prior) });
    const grant = deferred<void>();
    const locks: WalletLocks = { request: async (_name, _options, callback) => { await grant.promise; await callback({}); } };
    const session = createLocalProgressSession({ storage, locks });

    expect(session.getSnapshot().walletSessionStatus).toBe('pending');
    grant.resolve();
    await vi.waitFor(() => expect(session.getSnapshot()).toMatchObject({
      wallet: prior.balances, walletPersistent: true, walletSessionStatus: 'owned', best: 0,
    }));

    session.settleCompletedRun(ended('old-run', 4, { FEATHER: 9 }));
    expect(session.getSnapshot().wallet).toEqual(prior.balances);
    session.dispose();
  });

  it('settles a completed run once, publishes the gain, and keeps the highest best score', async () => {
    const { storage, values } = memoryStorage({ [bestKey]: JSON.stringify({ version: 1, best: 11 }) });
    const locks: WalletLocks = { request: async (_name, _options, callback) => { await callback({}); } };
    const session = createLocalProgressSession({ storage, locks });
    await vi.waitFor(() => expect(session.getSnapshot().walletSessionStatus).toBe('owned'));

    session.settleCompletedRun(ended('run-1', 7, { FEATHER: 3, GAME_STAR: 2 }));
    expect(session.getSnapshot()).toMatchObject({
      wallet: { FEATHER: 3, GAME_STAR: 2 }, walletPersistent: true,
      lastGain: { FEATHER: 3, GAME_STAR: 2 }, best: 11,
    });
    session.settleCompletedRun(ended('run-1', 20, { FEATHER: 100, GAME_STAR: 100 }));
    expect(session.getSnapshot()).toMatchObject({
      wallet: { FEATHER: 3, GAME_STAR: 2 }, lastGain: zero, best: 20,
    });
    expect(JSON.parse(values.get(bestKey)!)).toEqual({ version: 1, best: 20 });
    session.dispose();
  });

  it('uses memory-only wallet settlement when locks are missing or denied, while best can persist', async () => {
    for (const locks of [undefined, { request: async () => { throw new Error('denied'); } } as WalletLocks]) {
      const { storage, writes } = memoryStorage();
      const session = createLocalProgressSession({ storage, locks });
      await vi.waitFor(() => expect(session.getSnapshot().walletSessionStatus).toBe('memory'));

      session.settleCompletedRun(ended('memory-run', 6, { FEATHER: 4 }));
      expect(session.getSnapshot()).toMatchObject({
        wallet: { FEATHER: 4, GAME_STAR: 0 }, walletPersistent: false,
        walletSessionStatus: 'memory', best: 6,
      });
      expect(writes.map(([key]) => key)).toEqual([bestKey]);
      session.dispose();
    }
  });

  it('blocks settlement while another session owns the wallet lock', async () => {
    const { storage, writes } = memoryStorage();
    const locks: WalletLocks = { request: async (_name, _options, callback) => { await callback(null); } };
    const session = createLocalProgressSession({ storage, locks });
    await vi.waitFor(() => expect(session.getSnapshot().walletSessionStatus).toBe('busy'));

    session.settleCompletedRun(ended('busy-run', 5, { FEATHER: 2 }));
    expect(session.getSnapshot()).toMatchObject({ wallet: zero, walletPersistent: false, walletSessionStatus: 'busy', best: 0 });
    expect(writes).toEqual([]);
    session.dispose();
  });

  it('ignores completed runs entirely while ownership is pending', async () => {
    const grant = deferred<void>();
    const { storage, writes } = memoryStorage();
    const locks: WalletLocks = { request: async (_name, _options, callback) => { await grant.promise; await callback({}); } };
    const session = createLocalProgressSession({ storage, locks });
    const listener = vi.fn();
    session.subscribe(listener);

    session.settleCompletedRun(ended('pending-run', 8, { FEATHER: 3 }));
    expect(session.getSnapshot()).toMatchObject({ wallet: zero, walletSessionStatus: 'pending', best: 0, lastGain: null });
    expect(writes).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect(session.canPlay()).toBe(false);
    session.dispose();
    grant.resolve();
  });

  it('retains wallet memory and best memory after storage read or write failures', async () => {
    let writes = 0;
    const broken: StorageLike = {
      getItem: () => { throw new Error('storage denied'); },
      setItem: () => { writes += 1; throw new Error('storage denied'); },
    };
    const locks: WalletLocks = { request: async (_name, _options, callback) => { await callback({}); } };
    const session = createLocalProgressSession({ storage: broken, locks });
    await vi.waitFor(() => expect(session.getSnapshot().walletSessionStatus).toBe('owned'));

    session.settleCompletedRun(ended('write-fails', 12, { FEATHER: 5 }));
    expect(session.getSnapshot()).toMatchObject({ wallet: { FEATHER: 5, GAME_STAR: 0 }, walletPersistent: false, best: 12 });
    session.refreshBest();
    expect(session.getSnapshot().best).toBe(12);
    expect(writes).toBeGreaterThan(0);
    session.dispose();
  });

  it('keeps the loaded wallet in memory if a later wallet write fails', async () => {
    const values = new Map([[walletKey, JSON.stringify({ version: 1, balances: { FEATHER: 7, GAME_STAR: 2 }, settledRunIds: [] })]]);
    const storage: StorageLike = {
      getItem: (key) => values.get(key) ?? null,
      setItem: () => { throw new Error('write blocked'); },
    };
    const locks: WalletLocks = { request: async (_name, _options, callback) => { await callback({}); } };
    const session = createLocalProgressSession({ storage, locks });
    await vi.waitFor(() => expect(session.getSnapshot().walletSessionStatus).toBe('owned'));
    session.settleCompletedRun(ended('wallet-write-fails', 4, { FEATHER: 3 }));
    expect(session.getSnapshot()).toMatchObject({
      wallet: { FEATHER: 10, GAME_STAR: 2 }, walletPersistent: false,
      walletSessionStatus: 'memory', lastGain: { FEATHER: 3, GAME_STAR: 0 },
    });
    session.dispose();
  });

  it('does not consult ambient browser storage when storage is explicitly unavailable', async () => {
    const ambient = memoryStorage();
    vi.stubGlobal('localStorage', ambient.storage);
    const locks: WalletLocks = { request: async (_name, _options, callback) => { await callback({}); } };
    const session = createLocalProgressSession({ storage: null, locks });
    await vi.waitFor(() => expect(session.getSnapshot().walletSessionStatus).toBe('owned'));
    session.settleCompletedRun(ended('no-storage', 2, { FEATHER: 1 }));
    expect(session.getSnapshot()).toMatchObject({ wallet: { FEATHER: 1, GAME_STAR: 0 }, walletPersistent: false, best: 2 });
    expect(ambient.writes.map(([key]) => key)).toEqual([]);
    session.dispose();
    vi.unstubAllGlobals();
  });

  it('notifies subscribers on changes, honors unsubscribe, and stops notifications and writes after disposal', async () => {
    const { storage, writes } = memoryStorage();
    const locks: WalletLocks = { request: async (_name, _options, callback) => { await callback({}); } };
    const session = createLocalProgressSession({ storage, locks });
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    await vi.waitFor(() => expect(session.getSnapshot().walletSessionStatus).toBe('owned'));
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    session.settleCompletedRun(ended('active-run', 3, { FEATHER: 1 }));
    expect(listener).not.toHaveBeenCalled();
    session.dispose();
    expect(session.canPlay()).toBe(false);
    const writesAtDispose = writes.length;
    session.settleCompletedRun(ended('late-run', 40, { FEATHER: 50 }));
    session.refreshBest();
    expect(listener).not.toHaveBeenCalled();
    expect(writes).toHaveLength(writesAtDispose);
    expect(session.getSnapshot()).toMatchObject({ wallet: { FEATHER: 1, GAME_STAR: 0 }, best: 3 });
  });

  it('ignores a lock delivered after disposal while acquisition is pending', async () => {
    const grant = deferred<void>();
    const { storage, writes } = memoryStorage();
    const locks: WalletLocks = { request: async (_name, _options, callback) => { await grant.promise; await callback({}); } };
    const session = createLocalProgressSession({ storage, locks });
    const listener = vi.fn();
    session.subscribe(listener);
    session.dispose();
    const disposedSnapshot = session.getSnapshot();
    grant.resolve();
    await grant.promise;
    await Promise.resolve();
    expect(session.getSnapshot()).toEqual(disposedSnapshot);
    expect(listener).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('retries a retained personal best after a transient write failure', async () => {
    const { storage, values } = memoryStorage();
    let blocked = true;
    const transient: StorageLike = {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => {
        if (key === bestKey && blocked) throw new Error('temporary failure');
        storage.setItem(key, value);
      },
    };
    const session = createLocalProgressSession({ storage: transient, locks: undefined });
    await vi.waitFor(() => expect(session.canPlay()).toBe(true));
    session.settleCompletedRun(ended('record', 22, { FEATHER: 1 }));
    expect(values.has(bestKey)).toBe(false);
    blocked = false;
    session.settleCompletedRun(ended('later', 2, { FEATHER: 1 }));
    expect(JSON.parse(values.get(bestKey)!)).toEqual({ version: 1, best: 22 });
    session.dispose();
  });

  it('preserves a newer in-memory best when persisting a smaller score fails', async () => {
    const { storage } = memoryStorage({ [bestKey]: JSON.stringify({ version: 1, best: 14 }) });
    const failingBestStorage: StorageLike = {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => {
        if (key === bestKey) throw new Error('best write blocked');
        storage.setItem(key, value);
      },
    };
    const locks: WalletLocks = { request: async (_name, _options, callback) => { await callback({}); } };
    const session = createLocalProgressSession({ storage: failingBestStorage, locks });
    await vi.waitFor(() => expect(session.getSnapshot().walletSessionStatus).toBe('owned'));
    session.settleCompletedRun(ended('new-record', 22, { FEATHER: 1 }));
    session.settleCompletedRun(ended('lower-score', 2, { FEATHER: 1 }));
    expect(session.getSnapshot().best).toBe(22);
    session.dispose();
  });

  it('publishes frozen snapshots and only notifies for a changed best on refresh', async () => {
    const { storage, values, writes } = memoryStorage({ [bestKey]: JSON.stringify({ version: 1, best: 4 }) });
    const locks: WalletLocks = { request: async (_name, _options, callback) => { await callback({}); } };
    const session = createLocalProgressSession({ storage, locks });
    const listener = vi.fn();
    session.subscribe(listener);
    await vi.waitFor(() => expect(session.getSnapshot().walletSessionStatus).toBe('owned'));
    const ownedSnapshot = session.getSnapshot();
    expect(Object.isFrozen(ownedSnapshot)).toBe(true);
    expect(Object.isFrozen(ownedSnapshot.wallet)).toBe(true);
    expect(() => { (ownedSnapshot.wallet as { FEATHER: number }).FEATHER = 99; }).toThrow();

    listener.mockClear();
    session.refreshBest();
    expect(listener).not.toHaveBeenCalled();
    values.set(bestKey, JSON.stringify({ version: 1, best: 9 }));
    session.refreshBest();
    expect(session.getSnapshot().best).toBe(9);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
    session.dispose();
  });
});
