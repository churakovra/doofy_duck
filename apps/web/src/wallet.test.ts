import { describe, expect, it } from 'vitest';
import { loadWallet, settleWalletRun, type WalletStorage } from './wallet';

function memoryStorage(initial?: string): WalletStorage {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set('doofy-duck:wallet:v1', initial);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('local in-game wallet', () => {
  it('settles a completed run once and reloads cumulative balances', () => {
    const storage = memoryStorage();
    const initial = loadWallet(storage);
    const run = { runId: 'run-1', totals: { FEATHER: 3, GAME_STAR: 2 } };
    const first = settleWalletRun(initial.wallet, run, storage);
    const duplicate = settleWalletRun(first.wallet, run, storage, first.settledRunIds);

    expect(first.gain).toEqual({ FEATHER: 3, GAME_STAR: 2 });
    expect(first.wallet).toEqual({ FEATHER: 3, GAME_STAR: 2 });
    expect(duplicate.gain).toEqual({ FEATHER: 0, GAME_STAR: 0 });
    expect(loadWallet(storage)).toEqual({ wallet: first.wallet, persistent: true, settledRunIds: ['run-1'] });
  });

  it('keeps the memory wallet usable and reports non-persistence for missing or blocked storage', () => {
    const blocked: WalletStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    const first = loadWallet(undefined);
    const settled = settleWalletRun(first.wallet, { runId: 'memory-run', totals: { FEATHER: 4 } }, blocked);
    expect(settled.wallet.FEATHER).toBe(4);
    expect(settled.persistent).toBe(false);
    expect(loadWallet(undefined).wallet.FEATHER).toBe(0);
  });

  it('rejects malformed wallet records and unsafe totals without inventing balances', () => {
    const corrupt = memoryStorage('{bad json');
    expect(loadWallet(corrupt)).toEqual({ wallet: { FEATHER: 0, GAME_STAR: 0 }, persistent: false, settledRunIds: [] });
    const storage = memoryStorage(JSON.stringify({ version: 1, balances: { FEATHER: Number.MAX_SAFE_INTEGER, GAME_STAR: 0 }, settledRunIds: [] }));
    const loaded = loadWallet(storage);
    const settled = settleWalletRun(loaded.wallet, { runId: 'overflow-run', totals: { FEATHER: 1 } }, storage, loaded.settledRunIds);
    expect(settled.wallet.FEATHER).toBe(Number.MAX_SAFE_INTEGER);
    expect(settled.persistent).toBe(false);
  });

  it('validates run IDs and nonnegative safe-integer earnings', () => {
    const storage = memoryStorage();
    const initial = loadWallet(storage);
    const invalid = settleWalletRun(initial.wallet, { runId: '', totals: { FEATHER: -1, GAME_STAR: 1.2 } }, storage);
    expect(invalid.wallet).toEqual({ FEATHER: 0, GAME_STAR: 0 });
    expect(invalid.gain).toEqual({ FEATHER: 0, GAME_STAR: 0 });
  });

  it('settles in memory without touching storage when persistence is explicitly disabled', () => {
    let writes = 0;
    const storage: WalletStorage = { getItem: () => null, setItem: () => { writes += 1; } };
    const settled = settleWalletRun({ FEATHER: 5, GAME_STAR: 2 }, { runId: 'memory-only', totals: { FEATHER: 3 } }, null);
    expect(settled.wallet).toEqual({ FEATHER: 8, GAME_STAR: 2 });
    expect(settled.settled).toBe(true);
    expect(settled.persistent).toBe(false);
    expect(writes).toBe(0);
    expect(storage.getItem('doofy-duck:wallet:v1')).toBeNull();
  });

  it('rejects a non-string run ID before writing a corrupt dedup record', () => {
    const storage = memoryStorage();
    const initial = loadWallet(storage);
    const invalid = settleWalletRun(initial.wallet, { runId: 17, totals: { FEATHER: 5 } } as unknown as { runId: string; totals: { FEATHER: number } }, storage);
    expect(invalid.settled).toBe(false);
    expect(invalid.wallet).toEqual({ FEATHER: 0, GAME_STAR: 0 });
    expect(loadWallet(storage).persistent).toBe(true);
  });
});
