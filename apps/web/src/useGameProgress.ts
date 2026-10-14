import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameEvent } from '@doofy-duck/game-sim';
import { createLocalProgressSession, type LocalProgressSession, type LocalProgressSnapshot } from './local-progress';
import { browserWalletLocks } from './wallet-session';
import { readBest, type StorageLike } from './storage';

function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function initialSnapshot(): LocalProgressSnapshot {
  return Object.freeze({
    wallet: Object.freeze({ FEATHER: 0, GAME_STAR: 0 }),
    walletPersistent: false,
    walletSessionStatus: 'pending',
    lastGain: null,
    best: readBest(),
  });
}

export function useGameProgress() {
  const [progress, setProgress] = useState<LocalProgressSnapshot>(initialSnapshot);
  const sessionRef = useRef<LocalProgressSession | null>(null);

  useEffect(() => {
    const session = createLocalProgressSession({ storage: browserStorage(), locks: browserWalletLocks() });
    sessionRef.current = session;
    const unsubscribe = session.subscribe(() => setProgress(session.getSnapshot()));
    setProgress(session.getSnapshot());
    return () => {
      unsubscribe();
      if (sessionRef.current === session) sessionRef.current = null;
      session.dispose();
    };
  }, []);

  const canPlay = useCallback(() => sessionRef.current?.canPlay() ?? false, []);
  const settleRun = useCallback((event: Extract<GameEvent, { type: 'RunEnded' }>) => {
    sessionRef.current?.settleCompletedRun(event);
  }, []);
  const refreshBest = useCallback(() => sessionRef.current?.refreshBest(), []);

  return { ...progress, canPlay, settleRun, refreshBest };
}
