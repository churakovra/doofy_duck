import { describe, expect, it } from 'vitest';
import { PRIOR_DEFAULT_CONFIG, LEGACY_DEFAULT_CONFIG, createRunDescriptor, createRun, generateNext, makeInput, step, worldSpeedAt } from '../src/index.js';

const descriptor = (seed = 1, config = PRIOR_DEFAULT_CONFIG) => createRunDescriptor({ runId: `retune-${seed}`, seed }, config);

describe('focused arcade retune', () => {
  it('uses a sharper default flap arc', () => {
    const config = PRIOR_DEFAULT_CONFIG;
    expect(config.flight).toMatchObject({ gravity: 320, flapVelocity: -5600, maxFallSpeed: 8500, duckX: 100000 });
    let state = createRun(descriptor());
    state = step(state, [makeInput(0, 'FLAP')]).state;
    const impulseY = state.duck.y;
    let ticksToApex = 0;
    while (state.duck.vy < 0 && ticksToApex < 100) {
      state = step(state, []).state;
      ticksToApex++;
    }
    expect(impulseY - state.duck.y).toBeGreaterThan(35000);
    expect(ticksToApex).toBeLessThan(18);
  });

  it('varies seeded gap centers within bounded adjacent changes', () => {
    const config = { ...LEGACY_DEFAULT_CONFIG, challenges: null, pipes: { ...LEGACY_DEFAULT_CONFIG.pipes, horizon: 2_500_000 } };
    const centers = createRun(descriptor(142, config), config).pipes.map(pipe => pipe.gapCenter);
    expect(new Set(centers).size).toBeGreaterThan(3);
    expect(centers[0]).toBeGreaterThanOrEqual(245000);
    expect(centers[0]).toBeLessThanOrEqual(315000);
    for (let i = 1; i < centers.length; i++) expect(Math.abs(centers[i]! - centers[i - 1]!)).toBeLessThanOrEqual(85000);
    expect(createRun(descriptor(142, config), config).pipes.map(pipe => pipe.gapCenter)).toEqual(centers);
  });

  it('adds score-based speed steps at each configured pipe-count boundary', () => {
    const config = PRIOR_DEFAULT_CONFIG;
    expect([9, 10, 20, 40].map(score => worldSpeedAt(PRIOR_DEFAULT_CONFIG, 1, score)))
      .toEqual([3000, 3300, 3600, 4200]);
    expect(config.pipes).toMatchObject({ speed: 3000, maxSpeed: 4800, speedEveryPipes: 10, speedStepPercent: 10 });
  });

  it('retains seeded gap-walk continuity after every live pipe has been pruned', () => {
    const config = { ...LEGACY_DEFAULT_CONFIG, challenges: null, pipes: { ...LEGACY_DEFAULT_CONFIG.pipes, horizon: 2_500_000 } };
    const run = createRun(descriptor(142, config), config);
    const prior = run.pipes.at(-1)!.gapCenter;
    const pruned = { ...run, pipes: [] };
    const refilled = generateNext(pruned).state;
    expect(Math.abs(refilled.pipes[0]!.gapCenter - prior)).toBeLessThanOrEqual(config.pipes.maxGapDelta);
  });

  it('records a real seeded FEATHER pickup and deterministic terminal death after taps stop', () => {
    const config = { ...LEGACY_DEFAULT_CONFIG, challenges: null, pipes: { ...LEGACY_DEFAULT_CONFIG.pipes, spacing: 225000, maxSpeed: 5800 } };
    let state = createRun(descriptor(0, config), config);
    let sequence = 0;
    const taps = new Set([1, 19, 52, 86, 120, 166]);
    let picked = false;
    while (state.phase !== 'DEAD' && state.tick < 1000) {
      const nextTick = state.tick + 1;
      const frames = taps.has(nextTick) ? [makeInput(sequence++, 'FLAP')] : [];
      const result = step(state, frames);
      state = result.state;
      if (result.events.some(event => event.type === 'CurrencyCollected' && event.typeId === 'FEATHER')) {
        picked = true;
        break;
      }
    }
    expect(picked).toBe(true);
    expect(state.tick).toBe(171);
    expect(state.totals.FEATHER).toBe(1);
    while (state.phase !== 'DEAD' && state.tick < 1000) state = step(state, []).state;
    expect(state.phase).toBe('DEAD');
    expect(state.tick).toBe(229);
    expect(state.totals.FEATHER).toBe(1);
  });

  it('places a generated pickup off-center but safely inside its opening', () => {
    const config = PRIOR_DEFAULT_CONFIG;
    const state = createRun(descriptor(7));
    const started = step(state, [makeInput(0, 'FLAP')]).state;
    for (const collectible of started.collectibles) {
      const pipe = started.pipes.find(item => item.id === `pipe-${collectible.id.split('-')[1]}`)!;
      const p = config.pipes, f = config.flight;
      expect(collectible.x).toBe(pipe.x);
      expect(Math.abs(collectible.y - pipe.gapCenter)).toBeGreaterThan(0);
      expect(collectible.y - collectible.radius - f.duckHalfHeight).toBeGreaterThan(pipe.gapCenter - p.gapHeight / 2);
      expect(collectible.y + collectible.radius + f.duckHalfHeight).toBeLessThan(pipe.gapCenter + p.gapHeight / 2);
    }
  });
});
