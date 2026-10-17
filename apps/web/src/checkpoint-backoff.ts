export class CheckpointBackoff {
  private failures = 0;
  private nextAttemptAt = 0;
  private runId: string | undefined;

  constructor(private readonly random: () => number = Math.random) {}

  canAttempt(runId?: string): boolean {
    if (runId !== undefined && this.runId !== runId) this.reset(runId);
    return Date.now() >= this.nextAttemptAt;
  }

  defer(retryAfterMs = 0): number {
    const delay = Math.max(retryAfterMs, Math.min(30_000, 1_000 * 2 ** Math.min(this.failures, 5))) + Math.floor(this.random() * 500);
    this.failures += 1;
    this.nextAttemptAt = Date.now() + delay;
    return delay;
  }

  succeeded(): void {
    this.failures = 0;
    this.nextAttemptAt = 0;
  }

  reset(runId?: string): void {
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.runId = runId;
  }
}
