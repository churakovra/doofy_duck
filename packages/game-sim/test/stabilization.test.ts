import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, createRun, step, makeInput, configIdFor, PATTERN_CATALOG, canonicalJSON, worldSpeedAt } from '../src/index.js';
const descriptor = (seed = 1) => ({ runId: 'stabilization', seed, simulationVersion: '1.1.0', generatorVersion: '1.0.0', configId: 'dd-v1-speed-v1' });

describe('parent stabilization regressions', () => {
  it.each([NaN, Infinity, -Infinity, 1.25, Number.MAX_SAFE_INTEGER + 1])('rejects a noncanonical number %s rather than coercing it', value => {
    expect(() => canonicalJSON({ value })).toThrow(/integer|number/i);
  });
  it('rejects undefined canonical fields rather than emitting invalid JSON', () => {
    expect(() => canonicalJSON({ value: undefined })).toThrow();
  });
  it('selects authored world patterns using the seed instead of a fixed catalog cycle', () => {
    const layouts = new Set(Array.from({ length: 16 }, (_, seed) =>
      createRun(descriptor(seed)).pipes.map(p => p.gapCenter).join(',')));
    expect(layouts.size).toBeGreaterThan(1);
    expect(createRun(descriptor(1)).pipes).toEqual(createRun(descriptor(1)).pipes);
  });
  it('rejects changed tuning hidden under the default configuration identity', () => {
    const changed = { ...DEFAULT_CONFIG, flight: { ...DEFAULT_CONFIG.flight, gravity: 81 } };
    expect(() => createRun(descriptor(), changed)).toThrow(/config/i);
  });
  it.each([
    ['missing spacing', () => { const c = structuredClone(DEFAULT_CONFIG); delete (c.pipes as unknown as Record<string, unknown>).spacing; return c; }],
    ['missing duckX', () => { const c = structuredClone(DEFAULT_CONFIG); delete (c.flight as unknown as Record<string, unknown>).duckX; return c; }],
    ['oversized pickup radius', () => ({ ...DEFAULT_CONFIG, collectibles: [{ ...DEFAULT_CONFIG.collectibles[0]!, radius: 1000000 }] })],
  ] as const)('rejects invalid configuration: %s', (_name, makeConfig) => {
    expect(() => configIdFor(makeConfig())).toThrow();
  });
  it('rejects tick overflow before producing an imprecise next state', () => {
    const state = step(createRun(descriptor()), [makeInput(0, 'FLAP')]).state;
    expect(() => step({ ...state, tick: Number.MAX_SAFE_INTEGER }, [])).toThrow(/counter|tick|limit/i);
  });
  it.each(Array.from({ length: 16 }, (_, seed) => seed))('supports a surviving default-physics run for seed %i', (seed) => {
    let state = createRun(descriptor(seed));
    for (let tick = 0; tick < 24000 && state.phase !== 'DEAD'; tick++) {
      const flap = state.phase === 'READY' || (state.duck.y >= 333000 && state.duck.vy > 0);
      state = step(state, flap ? [makeInput(state.nextInputSequence, 'FLAP')] : []).state;
      expect(state.pipes.length).toBeLessThanOrEqual(DEFAULT_CONFIG.limits.maxActivePipes);
      expect(state.collectibles.length).toBeLessThanOrEqual(DEFAULT_CONFIG.limits.maxActiveCollectibles);
    }
    expect(state.phase).toBe('RUNNING');
    expect(state.tick).toBe(24000);
    expect(state.score).toBeGreaterThan(100);
  });
  it('treats no eligible collectible types as NONE even with zero configured NONE weight', () => {
    const config = { ...DEFAULT_CONFIG, spawnNoneWeight: 0, collectibles: [{ ...DEFAULT_CONFIG.collectibles[1]!, minPipeIndex: 100 }] };
    const state = createRun({ ...descriptor(), configId: configIdFor(config) }, config);
    const result = step(state, [makeInput(0, 'FLAP')]);
    expect(result.state.collectibles).toEqual([]);
    expect(result.state.nextSpawnPipeIndex).toBe(state.nextPipeIndex);
  });
  it('has a closed surviving control cycle inside every supported pipe gap', () => {
    const { flight: f, pipes: p } = DEFAULT_CONFIG;
    const low = Math.max(...PATTERN_CATALOG.flatMap(pattern => pattern.gaps.map(gap => gap - Math.floor(p.gapHeight / 2) + f.duckHalfHeight)));
    const high = Math.min(...PATTERN_CATALOG.flatMap(pattern => pattern.gaps.map(gap => gap + Math.floor(p.gapHeight / 2) - f.duckHalfHeight)));
    const requiredTravel = p.safeLeadIn - Math.floor(p.width / 2) - f.duckX - f.duckHalfWidth;
    let firstContact = 0, travel = 0;
    while (travel < requiredTravel) { firstContact++; travel += worldSpeedAt(DEFAULT_CONFIG, firstContact); }
    expect(travel).toBeGreaterThanOrEqual(requiredTravel);
    expect(travel - worldSpeedAt(DEFAULT_CONFIG, firstContact)).toBeLessThan(requiredTravel);
    let state = createRun(descriptor(3));
    const seen = new Map<string, number>();
    let period = 0;
    for (let tick = 1; tick <= 1000; tick++) {
      const flap = state.phase === 'READY' || (state.duck.y >= 333000 && state.duck.vy > 0);
      state = step(state, flap ? [makeInput(state.nextInputSequence, 'FLAP')] : []).state;
      expect(state.phase).toBe('RUNNING');
      if (tick < firstContact) continue;
      expect(state.duck.y).toBeGreaterThan(low);
      expect(state.duck.y).toBeLessThan(high);
      const key = `${state.duck.y},${state.duck.vy}`;
      if (seen.has(key)) { period = tick - seen.get(key)!; break; }
      seen.set(key, tick);
    }
    expect(period).toBeGreaterThan(0);
  });
  it('does not turn the NONE bucket into a positive-weight Feather', () => {
    const config = { ...DEFAULT_CONFIG, spawnNoneWeight: 4294967273 };
    const initial = createRun({ ...descriptor(), configId: configIdFor(config) }, config);
    const result = step(initial, [makeInput(0, 'FLAP')]);
    expect(result.state.collectibles).toEqual([]);
  });
});
