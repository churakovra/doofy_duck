export interface WalletLocks {
  request(name: string, options: { mode: 'exclusive'; ifAvailable: true }, callback: (lock: object | null) => Promise<void>): Promise<void>;
}

export interface WalletSessionCallbacks {
  owned(): void;
  busy(): void;
  memoryOnly(): void;
}

export interface WalletSession {
  dispose(): void;
}

const LOCK_NAME = 'doofy-duck:wallet:v1:writable-session';
// A disposed request may still reserve its native lock until its callback settles.
const pendingReleases = new WeakMap<WalletLocks, Promise<void>>();

/** Grants one persistent writer for this origin; other contexts never write unlocked. */
export function acquireWalletSession(locks: WalletLocks | undefined, callbacks: WalletSessionCallbacks): WalletSession {
  let disposed = false;
  let release: (() => void) | undefined;
  const handleFailure = () => {
    if (!disposed) callbacks.memoryOnly();
  };
  const request = (): Promise<void> => {
    if (disposed || !locks) return Promise.resolve();
    try {
      return locks.request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (disposed) return;
      if (!lock) {
        callbacks.busy();
        return;
      }
      let finish!: () => void;
      const held = new Promise<void>((resolve) => { finish = resolve; });
      release = finish;
      callbacks.owned();
      await held;
      }).catch(handleFailure);
    } catch {
      handleFailure();
      return Promise.resolve();
    }
  };
  const completion = locks && typeof locks.request === 'function'
    ? (pendingReleases.get(locks)?.then(request, request) ?? request())
    : undefined;
  const session: WalletSession = {
    dispose() {
      if (disposed) return;
      disposed = true;
      release?.();
      if (locks && completion) pendingReleases.set(locks, completion);
    },
  };

  if (!completion) callbacks.memoryOnly();
  else void completion.then(() => {
    if (locks && pendingReleases.get(locks) === completion) pendingReleases.delete(locks);
  });

  return session;
}

export function browserWalletLocks(): WalletLocks | undefined {
  try {
    return (navigator as Navigator & { locks?: WalletLocks }).locks;
  } catch {
    return undefined;
  }
}
