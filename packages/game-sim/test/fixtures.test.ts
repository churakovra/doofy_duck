import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRIOR_DEFAULT_CONFIG, PRIOR_DEFAULT_CONFIG_ID, DEFAULT_CONFIG, DEFAULT_CONFIG_ID, GENERATOR_VERSION, LEGACY_DEFAULT_CONFIG, LEGACY_DEFAULT_CONFIG_ID, LEGACY_GENERATOR_VERSION, LEGACY_SIMULATION_VERSION, PRIOR_GENERATOR_VERSION, PRIOR_SIMULATION_VERSION, SIMULATION_VERSION, WETLAND_DEFAULT_CONFIG, WETLAND_DEFAULT_CONFIG_ID, WETLAND_GENERATOR_VERSION, WETLAND_SIMULATION_VERSION, canonicalState, createRun, createRunDescriptor, makeInput, mix32, pauseRun, restartRun, resumeRun, step } from '../src/index.js';
import type { GameConfig, GameEvent, InputFrame, RunDescriptor, RunState } from '../src/index.js';
type Operation = { kind: string; frames?: InputFrame[]; ticks?: number; flapTicks?: number[]; descriptor?: RunDescriptor; expectedState: RunState; expectedEvents: GameEvent[] };
type Case = { name: string; syntheticInitialState: boolean; initialState: RunState; operations: Operation[] };
type InvalidCase = { name: string; kind: string; descriptor?: RunDescriptor; config?: GameConfig; initialState?: RunState; frames?: InputFrame[] };
const fixture = JSON.parse(readFileSync('contracts/simulation/golden-v1.json', 'utf8')) as { fixtureRevision: string; contractVersion: string; rules: { generation: { firstPipeX: number }; speed: string }; defaultConfig: GameConfig; cases: Case[]; mixerVectors: { input: number; output: number }[]; invalidCases: InvalidCase[] };
describe('shared contract fixtures', () => {
  it('pins the current ruleset identity and default config', () => {
    expect(fixture.fixtureRevision).toBe('stepped-challenges-1');
    expect(fixture.contractVersion).toBe(LEGACY_SIMULATION_VERSION);
    expect(fixture.defaultConfig).toEqual(LEGACY_DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG_ID).toBe('dd-v2-varied-obstacles-v1');
    expect(createRunDescriptor({ runId: 'fixture-contract', seed: 1 }).configId).toBe(DEFAULT_CONFIG_ID);
    expect(DEFAULT_CONFIG.wetland?.catalogVersion).toBe(2);
    expect(createRunDescriptor({ runId: 'wetland-v2-contract', seed: 1 }, WETLAND_DEFAULT_CONFIG)).toMatchObject({
      simulationVersion: WETLAND_SIMULATION_VERSION, generatorVersion: WETLAND_GENERATOR_VERSION, configId: WETLAND_DEFAULT_CONFIG_ID,
    });
    expect(createRunDescriptor({ runId: 'prior-fixture-contract', seed: 1 }, PRIOR_DEFAULT_CONFIG)).toMatchObject({
      simulationVersion: PRIOR_SIMULATION_VERSION, generatorVersion: PRIOR_GENERATOR_VERSION, configId: PRIOR_DEFAULT_CONFIG_ID,
    });
    expect(LEGACY_DEFAULT_CONFIG_ID).toBe('dd-v1-stepped-v1');
    expect(fixture.rules.speed).toContain('rampTicks');
  });
  it('serializes new wetland fields only for wetland rules', () => {
    const current = createRun(createRunDescriptor({ runId: 'wetland-state', seed: 7 }));
    expect(current.nextPipeX).toBeDefined();
    expect(current.config.wetland).toBeDefined();
    const priorDescriptor = createRunDescriptor({ runId: 'prior-state', seed: 7 }, PRIOR_DEFAULT_CONFIG);
    const prior = createRun(priorDescriptor, PRIOR_DEFAULT_CONFIG);
    expect(prior).not.toHaveProperty('nextPipeX');
    expect(prior.config).not.toHaveProperty('wetland');
    expect(prior.pipes[0]).not.toHaveProperty('obstacles');
  });
  it('keeps the shared run descriptor schema aligned with exported versions', () => {
    const schema = JSON.parse(readFileSync('contracts/simulation/run-descriptor.schema.json', 'utf8')) as {
      oneOf: { properties: { simulationVersion: { const: string }; generatorVersion: { const: string } } }[];
    };
    expect(schema.oneOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ properties: expect.objectContaining({ simulationVersion: { const: SIMULATION_VERSION }, generatorVersion: { const: GENERATOR_VERSION }, configId: expect.any(Object) }) }),
      expect.objectContaining({ properties: expect.objectContaining({ simulationVersion: { const: LEGACY_SIMULATION_VERSION }, generatorVersion: { const: LEGACY_GENERATOR_VERSION }, configId: expect.any(Object) }) }),
    ]));
  });
  it('pins the actual safe opening instead of obsolete tuning', () => {
    expect(fixture.rules.generation.firstPipeX).toBe(PRIOR_DEFAULT_CONFIG.pipes.safeLeadIn);
  });
  for (const vector of fixture.mixerVectors) it(`mixer ${vector.input}`, () => expect(mix32(vector.input)).toBe(vector.output));
  for (const example of fixture.cases) it(`replays complete canonical states and events: ${example.name}`, () => {
    let state = example.syntheticInitialState ? example.initialState : createRun(example.initialState.descriptor, example.initialState.config);
    expect(canonicalState(state)).toBe(canonicalState(example.initialState));
    for (const op of example.operations) {
      let events: readonly GameEvent[] = [];
      switch (op.kind) {
        case 'step': { const result = step(state, op.frames!); state = result.state; events = result.events; break; }
        case 'pause': state = pauseRun(state); break;
        case 'resume': state = resumeRun(state); break;
        case 'restart': state = restartRun(state, op.descriptor!); break;
        case 'advance': {
          const flapTicks = new Set(op.flapTicks);
          const all: GameEvent[] = [];
          for (let tick = 1; tick <= op.ticks!; tick++) {
            const result = step(state, flapTicks.has(tick) ? [makeInput(state.nextInputSequence, 'FLAP')] : []);
            state = result.state; all.push(...result.events);
          }
          events = all; break;
        }
        default: throw Error(`Unknown fixture operation ${op.kind}`);
      }
      expect(canonicalState(state)).toBe(canonicalState(op.expectedState));
      expect(events).toEqual(op.expectedEvents);
    }
  });
  for (const example of fixture.invalidCases) it(`rejects fixture: ${example.name}`, () => {
    if (example.kind === 'create') expect(() => createRun(example.descriptor!, example.config!)).toThrow();
    else expect(() => step(example.initialState!, example.frames!)).toThrow();
  });
});
