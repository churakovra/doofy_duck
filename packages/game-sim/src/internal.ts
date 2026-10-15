const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>))
      freeze(child);
  }
  return value;
};

export const deepFreeze = <T>(value: T): T => freeze(value);
export const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1;

export function incrementCounter(value: number, amount = 1): number {
  const next = value + amount;
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(next) || next > MAX_COUNTER)
    throw Error("simulation counter limit exceeded");
  return next;
}
