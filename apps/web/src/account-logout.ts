export function finishAccountLogout(
  pendingWrites: Promise<unknown>,
  clearAccount: () => Promise<unknown>,
  releaseWriter: () => void,
): Promise<void> {
  return pendingWrites
    .catch(() => undefined)
    .then(clearAccount)
    .catch(() => undefined)
    .finally(() => { try { releaseWriter(); } catch { /* Local teardown is best-effort. */ } })
    .then(() => undefined);
}
