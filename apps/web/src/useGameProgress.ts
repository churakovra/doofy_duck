import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameEvent } from '@doofy-duck/game-sim';
import { acquireWalletSession, browserWalletLocks } from './wallet-session';
import { loadWallet, settleWalletRun, type WalletBalances } from './wallet';
import { readBest, writeBest } from './storage';

type WalletSessionStatus = 'pending' | 'owned' | 'memory' | 'busy';

export function useGameProgress() {
  const [wallet, setWallet] = useState<WalletBalances>({ FEATHER: 0, GAME_STAR: 0 });
  const walletRef = useRef<WalletBalances>({ FEATHER: 0, GAME_STAR: 0 });
  const settledRunIdsRef = useRef<string[]>([]);
  const [walletPersistent, setWalletPersistent] = useState(false);
  const [walletSessionStatus, setWalletSessionStatus] = useState<WalletSessionStatus>('pending');
  const walletSessionStatusRef = useRef<WalletSessionStatus>('pending');
  const walletWritesEnabledRef = useRef(false);
  const [lastGain, setLastGain] = useState<WalletBalances | null>(null);
  const [best, setBest] = useState(readBest);

  useEffect(() => acquireWalletSession(browserWalletLocks(), {
    owned: () => {
      const loaded = loadWallet();
      walletRef.current = loaded.wallet;
      settledRunIdsRef.current = loaded.settledRunIds;
      walletWritesEnabledRef.current = loaded.persistent;
      setWallet(loaded.wallet);
      setWalletPersistent(loaded.persistent);
      walletSessionStatusRef.current = 'owned';
      setWalletSessionStatus('owned');
    },
    busy: () => {
      walletSessionStatusRef.current = 'busy';
      setWalletSessionStatus('busy');
    },
    memoryOnly: () => {
      walletWritesEnabledRef.current = false;
      setWalletPersistent(false);
      walletSessionStatusRef.current = 'memory';
      setWalletSessionStatus('memory');
    },
  }).dispose, []);

  const canPlay = useCallback(() => walletSessionStatusRef.current !== 'pending' && walletSessionStatusRef.current !== 'busy', []);
  const settleRun = useCallback((event: Extract<GameEvent, { type: 'RunEnded' }>) => {
    const settlement = settleWalletRun(
      walletRef.current,
      { runId: event.runId, totals: event.totals },
      walletWritesEnabledRef.current ? undefined : null,
      settledRunIdsRef.current,
    );
    walletRef.current = settlement.wallet;
    settledRunIdsRef.current = settlement.settledRunIds;
    walletWritesEnabledRef.current = walletWritesEnabledRef.current && settlement.persistent;
    setWallet(settlement.wallet);
    setLastGain(settlement.gain);
    setWalletPersistent(settlement.persistent);
    if (!settlement.persistent) {
      walletSessionStatusRef.current = 'memory';
      setWalletSessionStatus('memory');
    }

    const nextBest = Math.max(readBest(), event.score);
    let browserStore: Storage | undefined;
    try { browserStore = window.localStorage; } catch { browserStore = undefined; }
    writeBest(browserStore, nextBest);
    setBest(nextBest);
  }, []);

  const refreshBest = useCallback(() => setBest(readBest()), []);
  return { wallet, walletPersistent, walletSessionStatus, lastGain, best, canPlay, settleRun, refreshBest };
}
