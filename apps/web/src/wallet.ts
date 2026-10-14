export type WalletBalances = { FEATHER: number; GAME_STAR: number };
export interface WalletStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface WalletRun { runId: string; totals: Partial<WalletBalances> }
export interface WalletLoad { wallet: WalletBalances; persistent: boolean; settledRunIds: string[] }
export interface WalletSettlement extends WalletLoad { gain: WalletBalances; settled: boolean }

const KEY = 'doofy-duck:wallet:v1';
const MAX_SETTLED_RUNS = 128;
const zero = (): WalletBalances => ({ FEATHER: 0, GAME_STAR: 0 });
const validTotal = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function browserStorage(): WalletStorage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function validBalances(value: unknown): value is WalletBalances {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return validTotal(record.FEATHER) && validTotal(record.GAME_STAR);
}

export function loadWallet(storage: WalletStorage | undefined = browserStorage()): WalletLoad {
  if (!storage) return { wallet: zero(), persistent: false, settledRunIds: [] };
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return { wallet: zero(), persistent: true, settledRunIds: [] };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid wallet');
    const record = parsed as Record<string, unknown>;
    const ids = record.settledRunIds;
    if (record.version !== 1 || !validBalances(record.balances) || !Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw new Error('Invalid wallet');
    return { wallet: { ...record.balances }, persistent: true, settledRunIds: ids.slice(-MAX_SETTLED_RUNS) };
  } catch {
    return { wallet: zero(), persistent: false, settledRunIds: [] };
  }
}

export function settleWalletRun(
  current: WalletBalances,
  run: WalletRun,
  storage: WalletStorage | null | undefined = browserStorage(),
  priorRunIds: readonly string[] = [],
): WalletSettlement {
  const unchanged = { ...current };
  const zeroGain = zero();
  const ids = priorRunIds.slice(-MAX_SETTLED_RUNS);
  if (typeof run.runId !== 'string' || run.runId.length === 0 || ids.includes(run.runId) || !validBalances(current)) {
    return { wallet: unchanged, gain: zeroGain, settled: false, persistent: storage === null ? false : loadWallet(storage).persistent, settledRunIds: ids };
  }
  const feather = run.totals.FEATHER ?? 0;
  const star = run.totals.GAME_STAR ?? 0;
  if (!validTotal(feather) || !validTotal(star)) return { wallet: unchanged, gain: zeroGain, settled: false, persistent: storage === null ? false : loadWallet(storage).persistent, settledRunIds: ids };
  const next = { FEATHER: current.FEATHER + feather, GAME_STAR: current.GAME_STAR + star };
  if (!validBalances(next)) return { wallet: unchanged, gain: zeroGain, settled: false, persistent: false, settledRunIds: ids };
  const nextIds = [...ids, run.runId].slice(-MAX_SETTLED_RUNS);
  let persistent = false;
  try {
    if (storage) {
      storage.setItem(KEY, JSON.stringify({ version: 1, balances: next, settledRunIds: nextIds }));
      persistent = true;
    }
  } catch { persistent = false; }
  return { wallet: next, gain: { FEATHER: feather, GAME_STAR: star }, settled: true, persistent, settledRunIds: nextIds };
}
