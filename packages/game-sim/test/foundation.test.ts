import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, canonicalJSON, createRun, createRunDescriptor, step,
} from '../src/index.js';
import type { GameConfig, RunState } from '../src/index.js';

const baseDescriptor = { runId: 'foundation-edge', seed: 1 };
const customConfig = (changes: Partial<GameConfig> = {}): GameConfig => ({
  ...DEFAULT_CONFIG,
  ...changes,
  flight: { ...DEFAULT_CONFIG.flight, ...changes.flight },
  pipes: { ...DEFAULT_CONFIG.pipes, ...changes.pipes },
  limits: { ...DEFAULT_CONFIG.limits, ...changes.limits },
  collectibles: changes.collectibles ?? DEFAULT_CONFIG.collectibles,
});

describe('foundation edge cases', () => {
  it.each(['__proto__', 'constructor', 'toString'])('counts collectible type ID %s as an own total', typeId => {
    const config = customConfig({ collectibles: [{ ...DEFAULT_CONFIG.collectibles[0]!, typeId }] });
    const descriptor = createRunDescriptor(baseDescriptor, config);
    const initial = createRun(descriptor, config);
    const running: RunState = Object.freeze({
      ...initial, phase: 'RUNNING',
      collectibles: [{ id: 'edge-item', typeId, x: initial.duck.x, y: initial.duck.y, amount: 3, radius: 7000, collected: false }],
    });
    const result = step(running, []);
    expect(result.state.totals[typeId]).toBe(3);
    expect(Object.hasOwn(result.state.totals, typeId)).toBe(true);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'CurrencyCollected', typeId, amount: 3 }));
    expect(running.totals).toEqual({});
    expect(running.collectibles[0]?.collected).toBe(false);
  });

  it('canonicalizes HTML-sensitive characters and Unicode keys using UTF-16 ordering', () => {
    expect(canonicalJSON({ text: '<>&\u2028\u2029' })).toBe(`{"text":"<>&  "}`);
    const supplementary = '\u{10000}', bmp = '\uE000';
    expect(canonicalJSON({ [supplementary]: 1, [bmp]: 2 })).toBe(`{"${supplementary}":1,"${bmp}":2}`);
  });

  it('accepts a spawn table whose total is Number.MAX_SAFE_INTEGER', () => {
    const config = customConfig({
      spawnNoneWeight: Number.MAX_SAFE_INTEGER,
      collectibles: DEFAULT_CONFIG.collectibles.map(d => ({ ...d, weight: 0 })),
    });
    expect(() => createRun(createRunDescriptor(baseDescriptor, config), config)).not.toThrow();
  });

  it('copies the config without freezing the caller-owned object', () => {
    const config = customConfig();
    const descriptor = createRunDescriptor(baseDescriptor, config);
    const state = createRun(descriptor, config);
    const stateConfig = state.config;
    expect(Object.isFrozen(config)).toBe(false);
    expect(Object.isFrozen(config.pipes)).toBe(false);
    (config.pipes as { speed: number }).speed++;
    expect(state.config).toBe(stateConfig);
    expect(state.config.pipes.speed).toBe(DEFAULT_CONFIG.pipes.speed);
  });

  it('rejects non-string collectible type IDs and appearances at runtime', () => {
    for (const [field, value] of [['typeId', 4], ['appearance', null]] as const) {
      const definition = { ...DEFAULT_CONFIG.collectibles[0]!, [field]: value };
      const config = customConfig({ collectibles: [definition] as unknown as GameConfig['collectibles'] });
      expect(() => createRunDescriptor(baseDescriptor, config)).toThrow();
    }
  });

  it('uses floor for negative half-way run and first-gap centers', () => {
    const config = customConfig({
      pipes: { ...DEFAULT_CONFIG.pipes, ceilingY: -1000000, floorY: -439001, gapMinCenter: -840000, gapMaxCenter: -599999 },
    });
    const state = createRun(createRunDescriptor(baseDescriptor, config), config);
    expect(state.duck.y).toBe(-719501);
    expect(state.pipes[0]?.gapCenter).toBe(-685000);
  });
});
