const STEP_MS = 1000 / 60;
const MAX_GAP_MS = 250;
const MAX_STEPS_PER_FRAME = 5;

export class FixedStepClock {
  private debt = 0;
  private tick = 0;
  private pauseRequested = false;

  constructor(private readonly onTick: (tick: number) => void) {}

  advance(elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
    if (elapsedMs > MAX_GAP_MS) {
      this.debt = 0;
      this.pauseRequested = true;
      return;
    }
    this.debt += elapsedMs;
    let count = 0;
    while (this.debt + 1e-7 >= STEP_MS && count < MAX_STEPS_PER_FRAME) {
      this.debt = Math.max(0, this.debt - STEP_MS);
      this.onTick(++this.tick);
      count++;
    }
  }

  takePauseRequest(): boolean {
    const requested = this.pauseRequested;
    this.pauseRequested = false;
    return requested;
  }

  get interpolation(): number {
    return this.debt / STEP_MS;
  }

  resume(): void {
    this.debt = 0;
  }
}
