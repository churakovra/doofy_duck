import type { GameEvent } from '@doofy-duck/game-sim';
import { loadWallet, settleWalletRun, type WalletBalances } from './wallet';
import { acquireWalletSession, type WalletLocks } from './wallet-session';
import { readBest, writeBest, type StorageLike } from './storage';

export type WalletSessionStatus = 'pending' | 'owned' | 'memory' | 'busy';

export interface LocalProgressSnapshot {
  readonly wallet: Readonly<WalletBalances>;
  readonly walletPersistent: boolean;
  readonly walletSessionStatus: WalletSessionStatus;
  readonly lastGain: Readonly<WalletBalances> | null;
  readonly best: number;
}

export interface LocalProgressSession {
  getSnapshot(): LocalProgressSnapshot;
  subscribe(listener: () => void): () => void;
  canPlay(): boolean;
  settleCompletedRun(event: Extract<GameEvent, { type: 'RunEnded' }>): void;
  refreshBest(): void;
  dispose(): void;
}

const ZERO: WalletBalances = Object.freeze({ FEATHER: 0, GAME_STAR: 0 });
const unavailableStorage: StorageLike = {
  getItem() { throw new Error('Storage unavailable'); },
  setItem() { throw new Error('Storage unavailable'); },
};

function snapshot(
  wallet: Readonly<WalletBalances>,
  walletPersistent: boolean,
  walletSessionStatus: WalletSessionStatus,
  lastGain: Readonly<WalletBalances> | null,
  best: number,
): LocalProgressSnapshot {
  return Object.freeze({
    wallet: Object.freeze({ ...wallet }),
    walletPersistent,
    walletSessionStatus,
    lastGain: lastGain ? Object.freeze({ ...lastGain }) : null,
    best,
  });
}

/** Owns local progress without consulting browser globals. Wallet reads and writes happen only while its lock is held. */
export function createLocalProgressSession({
  storage,
  locks,
}: {
  storage: StorageLike | null;
  locks: WalletLocks | undefined;
}): LocalProgressSession {
  const store = storage ?? unavailableStorage;
  const listeners = new Set<() => void>();
  let wallet: WalletBalances = { ...ZERO };
  let settledRunIds: string[] = [];
  let walletPersistent = false;
  let disposed = false;
  let best = readBest(store);
  let current = snapshot(wallet, walletPersistent, 'pending', null, best);

  const publish = (lastGain: Readonly<WalletBalances> | null = current.lastGain) => {
    if (disposed) return;
    current = snapshot(wallet, walletPersistent, current.walletSessionStatus, lastGain, best);
    listeners.forEach((listener) => listener());
  };

  const walletSession = acquireWalletSession(locks, {
    owned() {
      queueMicrotask(() => {
        if (disposed) return;
        // Loading the wallet and its deduplication IDs is safe only after ownership was granted.
        const loaded = loadWallet(store);
        wallet = loaded.wallet;
        settledRunIds = loaded.settledRunIds;
        walletPersistent = Boolean(storage && loaded.persistent);
        current = snapshot(wallet, walletPersistent, 'owned', null, best);
        listeners.forEach((listener) => listener());
      });
    },
    busy() {
      queueMicrotask(() => {
        if (disposed) return;
        current = snapshot(wallet, false, 'busy', current.lastGain, best);
        listeners.forEach((listener) => listener());
      });
    },
    memoryOnly() {
      queueMicrotask(() => {
        if (disposed) return;
        walletPersistent = false;
        current = snapshot(wallet, false, 'memory', current.lastGain, best);
        listeners.forEach((listener) => listener());
      });
    },
  });

  return {
    getSnapshot: () => current,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    canPlay: () => !disposed && current.walletSessionStatus !== 'pending' && current.walletSessionStatus !== 'busy',
    settleCompletedRun(event) {
      if (disposed || current.walletSessionStatus === 'pending' || current.walletSessionStatus === 'busy') return;

      let gain: WalletBalances = { ...ZERO };
      if (current.walletSessionStatus === 'owned' || current.walletSessionStatus === 'memory') {
        const settlement = settleWalletRun(
          wallet,
          { runId: event.runId, totals: event.totals },
          walletPersistent ? store : null,
          settledRunIds,
        );
        wallet = settlement.wallet;
        settledRunIds = settlement.settledRunIds;
        gain = settlement.gain;
        walletPersistent = walletPersistent && settlement.persistent;
        if (!walletPersistent) current = snapshot(wallet, false, 'memory', gain, best);
      }

      const storedBest = readBest(store);
      const nextBest = Math.max(best, storedBest, event.score);
      best = nextBest;
      if (best > storedBest) writeBest(store, best);
      publish(gain);
    },
    refreshBest() {
      if (disposed) return;
      const refreshedBest = Math.max(best, readBest(store));
      if (refreshedBest !== best) {
        best = refreshedBest;
        publish();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      walletSession.dispose();
      listeners.clear();
    },
  };
}
