import { describe, expect, it } from 'vitest';
import { PRIOR_DEFAULT_CONFIG, configIdFor, createRunDescriptor, createRun, makeInput, pauseRun, restartRun, resumeRun, step, worldSpeedAt } from '../src/index.js';
import type { RunState } from '../src/index.js';

const descriptor = (runId = 'speed-test', config = PRIOR_DEFAULT_CONFIG) => createRunDescriptor({ runId, seed: 3 }, config);
const runningAt = (tick: number, extra: Partial<RunState> = {}) => {
  const initial = step(createRun(descriptor()), [makeInput(0, 'FLAP')]).state;
  return { ...initial, tick, phase: 'RUNNING' as const, duck: { ...initial.duck, y: 280000, vy: 0 }, pipes: [{ id: 'p', index: 90, x: 800000, gapCenter: 280000, scored: false }], collectibles: [{ id: 'c', typeId: 'FEATHER', x: 800000, y: 280000, amount: 1, radius: 7000, collected: false }], ...extra };
};

describe('active-time world speed ramp', () => {
  it('computes the specified one-based integer speed curve exactly', () => {
    expect([0, 1, 2, 2701, 5400, 5401, 9000].map(tick => worldSpeedAt(PRIOR_DEFAULT_CONFIG, tick)))
      .toEqual([3000, 3000, 3000, 4800, 4800, 4800, 4800]);
  });
  it.each([[1.5], [Number.MAX_SAFE_INTEGER], [Number.MAX_SAFE_INTEGER + 1], [Number.NaN], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY]])(
    'rejects invalid tick values: %s', (tick) => {
      expect(() => worldSpeedAt(PRIOR_DEFAULT_CONFIG, tick!)).toThrow();
    },
  );
  it('keeps zero and negative ticks at base speed, and accepts MAX_COUNTER', () => {
    expect(worldSpeedAt(PRIOR_DEFAULT_CONFIG, 0)).toBe(3000);
    expect(worldSpeedAt(PRIOR_DEFAULT_CONFIG, -1)).toBe(3000);
    expect(worldSpeedAt(PRIOR_DEFAULT_CONFIG, Number.MAX_SAFE_INTEGER - 1)).toBe(4800);
  });
  it.each([
    ['zero ramp', { ...PRIOR_DEFAULT_CONFIG, pipes: { ...PRIOR_DEFAULT_CONFIG.pipes, rampTicks: 0 } }],
    ['incomplete config', { ...PRIOR_DEFAULT_CONFIG, pipes: undefined }],
    ['out-of-range speed config', { ...PRIOR_DEFAULT_CONFIG, pipes: { ...PRIOR_DEFAULT_CONFIG.pipes, maxSpeed: 10_000_001 } }],
  ])('rejects invalid config passed directly to worldSpeedAt: %s', (_label, config) => {
    expect(() => worldSpeedAt(config as never, 1)).toThrow();
  });
  it('uses initial speed on tick 1 and advances smoothly to the midpoint', () => {
    const t1 = step(runningAt(0), []).state;
    expect(t1.pipes[0]!.x).toBe(800000 - 3000);
    const middle = step(runningAt(2700), []).state;
    expect(middle.pipes[0]!.x).toBe(800000 - 4800);
    expect(middle.collectibles[0]!.x).toBe(middle.pipes[0]!.x);
  });
  it('caps speed and moves existing entities by one identical computed amount', () => {
    const result = step(runningAt(5399), []).state;
    expect(result.pipes[0]!.x).toBe(800000 - 4800);
    const capped = step(runningAt(5400), []).state;
    expect(capped.pipes[0]!.x).toBe(795200);
    expect(capped.collectibles[0]!.x).toBe(capped.pipes[0]!.x);
  });
  it('freezes progression while paused and restart returns to the initial curve', () => {
    const before = runningAt(2700);
    const paused = pauseRun(before);
    expect(step(paused, []).state).toBe(paused);
    const resumedTick = step(resumeRun(paused), []).state;
    expect(resumedTick.pipes[0]!.x).toBe(800000 - 4800);
    const restarted = restartRun(before, descriptor('speed-restarted'));
    expect(restarted.tick).toBe(0);
    expect(step(restarted, [makeInput(0, 'FLAP')]).state.pipes[0]!.x).toBe(420000 - 3000);
  });
  it.each([
    ['max speed below base', { ...PRIOR_DEFAULT_CONFIG.pipes, maxSpeed: 2399, rampTicks: 5400 }],
    ['pipe width below cap speed', { ...PRIOR_DEFAULT_CONFIG.pipes, maxSpeed: 52001, rampTicks: 5400 }],
    ['zero ramp', { ...PRIOR_DEFAULT_CONFIG.pipes, maxSpeed: 4800, rampTicks: 0 }],
    ['unsafe ramp', { ...PRIOR_DEFAULT_CONFIG.pipes, maxSpeed: 4800, rampTicks: Number.MAX_SAFE_INTEGER }],
  ])('rejects invalid speed config: %s', (_label, pipes) => {
    expect(() => configIdFor({ ...PRIOR_DEFAULT_CONFIG, pipes } as never)).toThrow();
  });
});
