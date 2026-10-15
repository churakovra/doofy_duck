import { deepFreeze, incrementCounter, MAX_COUNTER } from "./internal.js";
import { validateConfig } from "./config.js";
import { mix32, type GameConfig, type Pipe, type RunState, type StepResult } from "./types.js";

export function generateNext(s: RunState): StepResult {
  const pipes = [...s.pipes];
  let rng = s.rngState,
    index = s.nextPipeIndex;
  const spacing = s.config.pipes.spacing;
  let previousGap = s.lastGapCenter;
  let x = pipes.length
    ? pipes[pipes.length - 1]!.x + spacing
    : s.config.pipes.safeLeadIn;
  while (
    pipes.length < s.config.limits.maxActivePipes &&
    x <= s.config.pipes.horizon
  ) {
    rng = (rng + 0x9e3779b9) >>> 0;
    const p = s.config.pipes;
    const sample = mix32((s.descriptor.seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0);
    const raw = p.gapMinCenter + sample % (p.gapMaxCenter - p.gapMinCenter + 1);
    const low = index === 0 ? Math.max(p.gapMinCenter, previousGap - 35000) : Math.max(p.gapMinCenter, previousGap - p.maxGapDelta);
    const high = index === 0 ? Math.min(p.gapMaxCenter, previousGap + 35000) : Math.min(p.gapMaxCenter, previousGap + p.maxGapDelta);
    const gapCenter = Math.max(low, Math.min(high, raw));
    previousGap = gapCenter;
    pipes.push({ id: `pipe-${index}`, index, x, gapCenter, scored: false });
    index = incrementCounter(index);
    x += spacing;
  }
  return {
    state: deepFreeze({ ...s, pipes, rngState: rng, nextPipeIndex: index, lastGapCenter: previousGap }),
    events: [],
  };
}
export function bonusY(config: GameConfig, seed: number, pipe: Pipe, radius: number): number {
  const p = config.pipes, f = config.flight;
  const half = Math.floor(p.gapHeight / 2);
  const safeLow = pipe.gapCenter - half + f.duckHalfHeight + radius + 2;
  const safeHigh = pipe.gapCenter + half - f.duckHalfHeight - radius - 2;
  const innerLow = Math.max(safeLow, pipe.gapCenter - Math.floor(half * 0.7));
  const innerHigh = Math.min(safeHigh, pipe.gapCenter + Math.floor(half * 0.7));
  if (innerLow >= innerHigh) return Math.floor((safeLow + safeHigh) / 2);
  const maxOffset = Math.min(42000, Math.floor((innerHigh - innerLow) / 2));
  const sample = mix32((seed ^ Math.imul(pipe.index + 1, 0x85ebca6b)) >>> 0);
  const magnitude = 16000 + sample % Math.max(1, maxOffset - 15999);
  const signed = (sample & 0x80000000) ? -magnitude : magnitude;
  return Math.max(innerLow, Math.min(innerHigh, pipe.gapCenter + signed));
}
/** Speed for a one-based active simulation tick; READY is still stationary. */
export function worldSpeedAt(config: GameConfig, tick: number, score = 0): number {
  validateConfig(config);
  if (!Number.isSafeInteger(tick) || tick > MAX_COUNTER || !Number.isSafeInteger(score) || score < 0 || score > MAX_COUNTER)
    throw Error("tick and score must be safe simulation counters");
  const elapsed = Math.min(Math.max(tick - 1, 0), config.pipes.rampTicks);
  const base = config.pipes.speed + Math.floor((config.pipes.maxSpeed - config.pipes.speed) * elapsed / config.pipes.rampTicks);
  const maxSteps = Math.ceil((config.pipes.maxSpeed - base) * 100 / (config.pipes.speed * config.pipes.speedStepPercent || 1));
  const steps = Math.min(Math.floor(score / config.pipes.speedEveryPipes), maxSteps);
  return Math.min(config.pipes.maxSpeed, base + Math.floor(config.pipes.speed * steps * config.pipes.speedStepPercent / 100));
}
