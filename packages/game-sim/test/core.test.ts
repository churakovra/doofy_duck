import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, createRun, step, pauseRun, resumeRun, restartRun,
  makeInput, validateConfig, validateDescriptor, mix32, generateNext,
  Feather, GameStar, collectibleFromDefinition, canonicalState, configIdFor,
} from '../src/index.js';
import type { RunDescriptor, InputFrame } from '../src/index.js';

const descriptor: RunDescriptor = {
  runId: 'run-001', seed: 1, simulationVersion: '1.1.0', generatorVersion: '1.0.0', configId: 'dd-v1-speed-v1',
};
const press = (sequence: number): InputFrame => makeInput(sequence, 'FLAP');

describe('public contract validation', () => {
  it('accepts the immutable default config and rejects invalid physics', () => {
    expect(validateConfig(DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, flight: { ...DEFAULT_CONFIG.flight, gravity: -1 } })).toThrow(/gravity/i);
  });
  it('rejects invalid geometry and a custom config under the default identity', () => {
    expect(() => validateConfig({
      ...DEFAULT_CONFIG,
      flight: { ...DEFAULT_CONFIG.flight, duckHalfHeight: -1 },
    })).toThrow(/geometry|extent/i);
    expect(() => createRun({ ...descriptor, configId: 'unregistered-config' })).toThrow(/config/i);
  });

  it('rejects malformed run descriptors and input sequence gaps', () => {
    expect(validateDescriptor(descriptor)).toEqual(descriptor);
    expect(() => validateDescriptor({ ...descriptor, seed: -1 })).toThrow(/seed/i);
    const state = createRun(descriptor);
    expect(() => step(state, [press(2)])).toThrow(/sequence/i);
  });
});

describe('deterministic flight and lifecycle', () => {
  it('starts with first flap, applies gravity in documented integer units, and repeats exactly', () => {
    const initial = createRun(descriptor);
    const a = step(initial, [press(0)]);
    const b = step(createRun(descriptor), [press(0)]);
    expect(a.state.phase).toBe('RUNNING');
    expect(a.state.duck.vy).toBe(DEFAULT_CONFIG.flight.flapVelocity + DEFAULT_CONFIG.flight.gravity);
    expect(canonicalState(a.state)).toBe(canonicalState(b.state));
    expect(a.events.map(e => e.type)).toContain('RunStarted');
  });
  it('pause freezes tick and resume requires explicit action', () => {
    let state = step(createRun(descriptor), [press(0)]).state;
    const paused = pauseRun(state);
    const noStep = step(paused, []);
    expect(noStep.state.tick).toBe(paused.tick);
    expect(noStep.state.phase).toBe('PAUSED');
    state = resumeRun(noStep.state);
    expect(state.phase).toBe('RUNNING');
  });
  it('boundary edge contact kills once and post-death ticks are inert', () => {
    const cfg = { ...DEFAULT_CONFIG, flight: { ...DEFAULT_CONFIG.flight, gravity: 1000, maxFallSpeed: 1000, flapVelocity: -1 } };
    let state = step(createRun({ ...descriptor, configId: configIdFor(cfg) }, cfg), [press(0)]).state;
    for (let i = 0; i < 400 && state.phase !== 'DEAD'; i++) state = step(state, []).state;
    expect(state.phase).toBe('DEAD');
    const again = step(state, [press(state.nextInputSequence)]);
    expect(again.state).toEqual(state);
    expect(again.events).toEqual([]);
  });
  it('restart resets transient state and uses the supplied new identity', () => {
    const state = step(createRun(descriptor), [press(0)]).state;
    const restarted = restartRun(state, { ...descriptor, runId: 'run-002', seed: 2 });
    expect(restarted.descriptor.runId).toBe('run-002');
    expect(restarted.tick).toBe(0);
    expect(restarted.phase).toBe('READY');
    expect(restarted.score).toBe(0);
  });
});

describe('score and bounded generated world', () => {
  it('scores a passed pipe pair exactly once', () => {
    let state = step(createRun(descriptor), [press(0)]).state;
    const pipe = { id: 'pipe-test', index: 90, x: state.config.flight.duckX - state.config.flight.duckHalfWidth - Math.floor(state.config.pipes.width / 2) + state.config.pipes.speed - 1, gapCenter: 280000, scored: false };
    state = Object.freeze({ ...state, pipes: [pipe], nextPipeIndex: 91 });
    const first = step(state, []);
    expect(first.events.filter(e => e.type === 'PipePassed')).toHaveLength(1);
    expect(first.state.score).toBe(1);
    const second = step(first.state, []);
    expect(second.events.filter(e => e.type === 'PipePassed')).toHaveLength(0);
    expect(second.state.score).toBe(1);
  });
  it('collects an intersecting item once and updates only the run total', () => {
    let state = step(createRun(descriptor), [press(0)]).state;
    const item = { id: 'collectible-test', typeId: 'FEATHER', x: state.config.flight.duckX + state.config.pipes.speed, y: state.duck.y, amount: 1, radius: 7000, collected: false };
    state = Object.freeze({ ...state, collectibles: [item] });
    const first = step(state, []);
    expect(first.events.filter(e => e.type === 'CurrencyCollected')).toHaveLength(1);
    expect(first.state.totals.FEATHER).toBe(1);
    const second = step(first.state, []);
    expect(second.events.filter(e => e.type === 'CurrencyCollected')).toHaveLength(0);
    expect(second.state.totals.FEATHER).toBe(1);
  });

  it('pins the specified 32-bit mixer outputs', () => {
    expect([mix32(0), mix32(1), mix32(0x12345678)]).toEqual([0, 1364076727, 3816608188]);
  });
  it('generates stable monotonically identified pipes in a bounded horizon', () => {
    const result = generateNext(createRun(descriptor));
    expect(result.state.pipes.length).toBeLessThanOrEqual(DEFAULT_CONFIG.limits.maxActivePipes);
    expect(result.state.pipes[0]?.id).toBe('pipe-0');
    expect(result.state.pipes.map(p => p.x)).toEqual([...result.state.pipes.map(p => p.x)].sort((a,b) => a-b));
    expect(generateNext(createRun(descriptor)).state.pipes).toEqual(result.state.pipes);
  });
  it('maintains bounded live world on a known surviving flap sequence', () => {
    const config = { ...DEFAULT_CONFIG, flight: { ...DEFAULT_CONFIG.flight, gravity: 1, flapVelocity: -11, maxFallSpeed: 100 }, pipes: { ...DEFAULT_CONFIG.pipes, speed: 100, gapHeight: 300000 } };
    let state = createRun({ ...descriptor, configId: configIdFor(config) }, config);
    let flapSeq = 0;
    for (let t = 0; t < 24000 && state.phase !== 'DEAD'; t++) {
      const input = t % 20 === 0 ? [press(flapSeq++)] : [];
      state = step(state, input).state;
      expect(state.pipes.length).toBeLessThanOrEqual(DEFAULT_CONFIG.limits.maxActivePipes);
      expect(state.collectibles.length).toBeLessThanOrEqual(DEFAULT_CONFIG.limits.maxActiveCollectibles);
      expect(state.inputHistory.length).toBe(0);
    }
    expect(state.tick).toBeGreaterThan(1200);
  });
});

describe('collectible definitions and pickup', () => {
  it('exposes validated inheritance types with typed pickup effects', () => {
    const feather = new Feather();
    const star = new GameStar();
    expect(feather.typeId).toBe('FEATHER');
    expect(star.typeId).toBe('GAME_STAR');
    expect(collectibleFromDefinition(feather.definition).pickup('run-001', 'c-1', 9)).toMatchObject({ type: 'CurrencyCollected', amount: 1, tick: 9 });
  });
  it('consumes each eligible pipe opportunity once, even when NONE wins', () => {
    const config = {
      ...DEFAULT_CONFIG,
      collectibles: [],
      spawnNoneWeight: 1,
    };
    let state = createRun({ ...descriptor, configId: configIdFor(config) }, config);
    state = step(state, [press(0)]).state;
    expect(state.nextSpawnPipeIndex).toBe(state.nextPipeIndex);
    expect(state.rngState).toBe((1 + (state.nextPipeIndex + Math.max(0, state.nextPipeIndex - 2)) * 0x9e3779b9) >>> 0);
    const again = step(state, []).state;
    expect(again.rngState).toBe(state.rngState);
    expect(again.nextSpawnPipeIndex).toBe(state.nextSpawnPipeIndex);
  });

  it('treats an all-disabled spawn table as NONE', () => {
    const config = {
      ...DEFAULT_CONFIG,
      collectibles: DEFAULT_CONFIG.collectibles.map(definition => ({ ...definition, weight: 0 })),
      spawnNoneWeight: 10,
    };
    const state = createRun({ ...descriptor, configId: configIdFor(config) }, config);
    const started = step(state, [press(0)]);
    expect(started.state.collectibles).toEqual([]);
  });
  it('preserves supplied amount when constructing a feather definition', () => {
    const definition = { ...DEFAULT_CONFIG.collectibles[0]!, amount: 31 };
    expect(collectibleFromDefinition(definition).definition.amount).toBe(31);
  });
});

describe('version compatibility', () => {
  it('rejects unsupported simulation versions', () => {
    expect(() => createRun({ ...descriptor, simulationVersion: '99.0.0' })).toThrow(/simulation version/i);
  });
});
