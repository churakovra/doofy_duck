import { describe, expect, it, vi } from 'vitest';
import { acquireWalletSession, type WalletLocks } from './wallet-session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('wallet session ownership', () => {
  it('waits for a disposed pending native request before the StrictMode replacement acquires', async () => {
    const grant = deferred<void>();
    let reserved = false;
    const locks: WalletLocks = { request: async (_name, _options, cb) => {
      // Native availability is decided when requesting, before callback delivery.
      const lock = reserved ? null : {};
      if (lock) reserved = true;
      await grant.promise;
      try { await cb(lock); } finally { if (lock) reserved = false; }
    } };
    const events: string[] = [];
    const callbacks = { owned: () => events.push('owned'), busy: () => events.push('busy'), memoryOnly: () => events.push('memory') };
    const first = acquireWalletSession(locks, callbacks);
    first.dispose();
    const replacement = acquireWalletSession(locks, callbacks);
    try {
      grant.resolve();
      await vi.waitFor(() => expect(events).toEqual(['owned']));
    } finally { replacement.dispose(); }
  });

  it('holds the exclusive lock until disposal and releases it once', async () => {
    let callback: ((lock: object | null) => Promise<void>) | undefined;
    let released = false;
    const locks: WalletLocks = { request: async (_name, _options, cb) => {
      callback = cb;
      await cb({});
      released = true;
    } };
    const owned: string[] = [];
    const session = acquireWalletSession(locks, { owned: () => owned.push('owned'), busy: () => owned.push('busy'), memoryOnly: () => owned.push('memory') });
    await Promise.resolve();
    expect(released).toBe(false);
    expect(owned).toEqual(['owned']);
    session.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(released).toBe(true);
    expect(callback).toBeTypeOf('function');
  });

  it('ignores a lock granted after the component disposed while the request was pending', async () => {
    const grant = deferred<void>();
    const locks: WalletLocks = { request: async (_name, _options, cb) => { await grant.promise; await cb({}); } };
    const events: string[] = [];
    const session = acquireWalletSession(locks, { owned: () => events.push('owned'), busy: () => events.push('busy'), memoryOnly: () => events.push('memory') });
    session.dispose();
    grant.resolve();
    await grant.promise;
    await Promise.resolve();
    expect(events).toEqual([]);
  });

  it('blocks a secondary session when another tab owns the lock', async () => {
    const locks: WalletLocks = { request: async (_name, _options, cb) => { await cb(null); } };
    const events: string[] = [];
    const session = acquireWalletSession(locks, { owned: () => events.push('owned'), busy: () => events.push('busy'), memoryOnly: () => events.push('memory') });
    await Promise.resolve();
    expect(events).toEqual(['busy']);
    session.dispose();
  });

  it('falls back to memory-only mode when lock request throws synchronously', () => {
    const events: string[] = [];
    const denied = { request: () => { throw new Error('denied immediately'); } } as unknown as WalletLocks;
    acquireWalletSession(denied, { owned: () => events.push('owned'), busy: () => events.push('busy'), memoryOnly: () => events.push('memory') });
    expect(events).toEqual(['memory']);
  });

  it('uses explicitly memory-only mode when Web Locks are missing or denied', async () => {
    const events: string[] = [];
    acquireWalletSession(undefined, { owned: () => events.push('owned'), busy: () => events.push('busy'), memoryOnly: () => events.push('memory') });
    expect(events).toEqual(['memory']);
    const denied: WalletLocks = { request: async () => { throw new Error('denied'); } };
    acquireWalletSession(denied, { owned: () => events.push('owned'), busy: () => events.push('busy'), memoryOnly: () => events.push('memory') });
    await Promise.resolve();
    expect(events).toEqual(['memory', 'memory']);
  });
});
