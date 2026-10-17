import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, LEGACY_DEFAULT_CONFIG, createRunDescriptor, createRun, step, makeInput, configIdFor, canonicalJSON } from '../src/index.js';
const descriptor = (seed = 1, config = DEFAULT_CONFIG) => createRunDescriptor({ runId: 'stabilization', seed }, config);

describe('parent stabilization regressions', () => {
  it.each([NaN, Infinity, -Infinity, 1.25, Number.MAX_SAFE_INTEGER + 1])('rejects a noncanonical number %s rather than coercing it', value => {
    expect(() => canonicalJSON({ value })).toThrow(/integer|number/i);
  });
  it('rejects undefined canonical fields rather than emitting invalid JSON', () => {
    expect(() => canonicalJSON({ value: undefined })).toThrow();
  });
  it('selects authored world patterns using the seed instead of a fixed catalog cycle', () => {
    const legacy = { ...LEGACY_DEFAULT_CONFIG, challenges: null };
    const layouts = new Set(Array.from({ length: 16 }, (_, seed) =>
      createRun(descriptor(seed, legacy), legacy).pipes.map(p => p.gapCenter).join(',')));
    expect(layouts.size).toBeGreaterThan(1);
    expect(createRun(descriptor(1, legacy), legacy).pipes).toEqual(createRun(descriptor(1, legacy), legacy).pipes);
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
  it('generates bounded, seeded reachable gap layouts over multiple world fills', () => {
    const config = { ...LEGACY_DEFAULT_CONFIG, challenges: null, pipes: { ...LEGACY_DEFAULT_CONFIG.pipes, spacing: 225000, horizon: 2_500_000 } };
    const ids = new Set<number>();
    for (let seed = 0; seed < 24; seed++) {
      const custom = createRun(descriptor(seed, config), config);
      const centers = custom.pipes.map(pipe => pipe.gapCenter);
      expect(centers.length).toBeGreaterThanOrEqual(8);
      for (let i = 0; i < centers.length; i++) {
        expect(centers[i]).toBeGreaterThanOrEqual(config.pipes.gapMinCenter);
        expect(centers[i]).toBeLessThanOrEqual(config.pipes.gapMaxCenter);
        if (i) expect(Math.abs(centers[i]! - centers[i - 1]!)).toBeLessThanOrEqual(config.pipes.maxGapDelta);
      }
      ids.add(centers[0]!);
      expect(createRun(descriptor(seed, config), config).pipes.map(pipe => pipe.gapCenter)).toEqual(centers);
    }
    expect(ids.size).toBeGreaterThan(8);
  });
  it('treats no eligible collectible types as NONE even with zero configured NONE weight', () => {
    const config = { ...LEGACY_DEFAULT_CONFIG, spawnNoneWeight: 0, collectibles: [{ ...LEGACY_DEFAULT_CONFIG.collectibles[1]!, minPipeIndex: 100 }] };
    const state = createRun(descriptor(1, config), config);
    const result = step(state, [makeInput(0, 'FLAP')]);
    expect(result.state.collectibles).toEqual([]);
    expect(result.state.nextSpawnPipeIndex).toBe(state.nextPipeIndex);
  });
  it('does not turn the NONE bucket into a positive-weight Feather', () => {
    const config = { ...DEFAULT_CONFIG, spawnNoneWeight: 4294967273 };
    const initial = createRun(descriptor(1, config), config);
    const result = step(initial, [makeInput(0, 'FLAP')]);
    expect(result.state.collectibles).toEqual([]);
  });
});
