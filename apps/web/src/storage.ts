export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = 'doofy-duck:best:v1';

function browserStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readBest(storage: StorageLike | undefined = browserStorage()): number {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null && 'version' in value && 'best' in value) {
      const record = value as { version: unknown; best: unknown };
      if (record.version === 1 && Number.isSafeInteger(record.best) && (record.best as number) >= 0) return record.best as number;
    }
    return 0;
  } catch {
    return 0;
  }
}

export function writeBest(storage: StorageLike | undefined, best: number): boolean {
  if (!Number.isSafeInteger(best) || best < 0) return false;
  try {
    storage?.setItem(KEY, JSON.stringify({ version: 1, best }));
    return storage !== undefined;
  } catch {
    return false;
  }
}
