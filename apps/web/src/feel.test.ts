import { createRunDescriptor, createRun, DEFAULT_CONFIG } from '@doofy-duck/game-sim';
import { describe, expect, it } from 'vitest';
import { createFxPool, duckPose, flapEnvelope, fxPosition, pushFx, type Fx } from './feel';

describe('flight feel', () => {
  it('makes an accepted flap visibly kick upward even from a dive', () => {
    const pose = duckPose(8500, 1, false);
    expect(pose.rotation).toBeLessThan(-0.5);
    expect(pose.scaleY).toBeGreaterThan(1.12);
    expect(pose.scaleX).toBeLessThan(0.95);
    expect(duckPose(8500, 0, false).rotation).toBeGreaterThan(1);
  });

  it('finishes the impulse quickly and trails air behind rather than floating it upward', () => {
    expect(flapEnvelope(0.2, false)).toBe(0);
    const air = fxPosition({ x: 100, y: 250, kind: 'air', born: 0 }, 0.1);
    expect(air.x).toBeLessThan(95);
    expect(Math.abs(air.y - 250)).toBeLessThan(8);
  });

  it('leans upward while rising and into a bounded dive while falling', () => {
    expect(duckPose(-240, 0, false).rotation).toBeLessThan(0);
    expect(duckPose(240, 0, false).rotation).toBeGreaterThan(0);
    expect(duckPose(-240, 0, false).rotation).toBeGreaterThanOrEqual(-0.48);
    expect(duckPose(2_000, 0, false).rotation).toBeLessThanOrEqual(0.62);
  });

  it('produces a crisp flap envelope but removes overshoot in reduced motion', () => {
    expect(flapEnvelope(0, false)).toBe(1);
    expect(flapEnvelope(0.16, false)).toBeGreaterThan(0);
    expect(flapEnvelope(0.5, false)).toBe(0);
    expect(flapEnvelope(0, true)).toBe(0);
  });

  it('bounds the cosmetic pool and never mutates its input collection', () => {
    const pool = createFxPool(3);
    const initial: readonly Fx[] = [];
    const first = pushFx(initial, { x: 1, y: 2, kind: 'air', born: 0, seed: 1 }, pool);
    const second = pushFx(first, { x: 2, y: 3, kind: 'pickup', born: 0 }, pool);
    const bounded = pushFx(second, { x: 3, y: 4, kind: 'air', born: 0 }, pool);
    const overflow = pushFx(bounded, { x: 4, y: 5, kind: 'air', born: 0 }, pool);
    expect(initial).toEqual([]);
    expect(overflow).toHaveLength(3);
    expect(overflow.map((fx) => fx.x)).toEqual([2, 3, 4]);
  });

  it('does not mutate the authoritative run state while deriving presentation pose', () => {
    const state = createRun(createRunDescriptor({ runId: 'feel-test', seed: 1 }, DEFAULT_CONFIG));
    const before = JSON.stringify(state);
    duckPose(state.duck.vy, flapEnvelope(0.1, false), false);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('keeps pose and effects inert under reduced motion', () => {
    const normal = duckPose(180, 0.3, false);
    const reduced = duckPose(180, 0.3, true);
    expect(reduced.rotation).toBe(normal.rotation);
    expect(reduced.scaleX).toBe(1);
    expect(reduced.scaleY).toBe(1);
  });
});
