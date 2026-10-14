import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_CONFIG_ID, GENERATOR_VERSION, SIMULATION_VERSION, canonicalState, createRun, createRunDescriptor, makeInput, mix32, pauseRun, restartRun, resumeRun, step } from '../src/index.js';
import type { GameConfig, GameEvent, InputFrame, RunDescriptor, RunState } from '../src/index.js';
type Operation = { kind: string; frames?: InputFrame[]; ticks?: number; flapTicks?: number[]; descriptor?: RunDescriptor; expectedState: RunState; expectedEvents: GameEvent[] };
type Case = { name: string; syntheticInitialState: boolean; initialState: RunState; operations: Operation[] };
type InvalidCase = { name: string; kind: string; descriptor?: RunDescriptor; config?: GameConfig; initialState?: RunState; frames?: InputFrame[] };
const fixture = JSON.parse(readFileSync('contracts/simulation/golden-v1.json', 'utf8')) as { fixtureRevision: string; contractVersion: string; rules: { generation: { firstPipeX: number }; speed: string }; defaultConfig: GameConfig; cases: Case[]; mixerVectors: { input: number; output: number }[]; invalidCases: InvalidCase[] };
describe('shared contract fixtures', () => {
  it('pins the current ruleset identity and default config', () => {
    expect(fixture.fixtureRevision).toBe('foundation-arcade-2');
    expect(fixture.contractVersion).toBe(SIMULATION_VERSION);
    expect(fixture.defaultConfig).toEqual(DEFAULT_CONFIG);
    expect(createRunDescriptor({ runId: 'fixture-contract', seed: 1 }).configId).toBe(DEFAULT_CONFIG_ID);
    expect(fixture.rules.speed).toContain('rampTicks');
  });
  it('keeps the shared run descriptor schema aligned with exported versions', () => {
    const schema = JSON.parse(readFileSync('contracts/simulation/run-descriptor.schema.json', 'utf8')) as {
      properties: { simulationVersion: { const: string }; generatorVersion: { const: string } };
    };
    expect(schema.properties.simulationVersion.const).toBe(SIMULATION_VERSION);
    expect(schema.properties.generatorVersion.const).toBe(GENERATOR_VERSION);
  });
  it('pins the actual safe opening instead of obsolete tuning', () => {
    expect(fixture.rules.generation.firstPipeX).toBe(DEFAULT_CONFIG.pipes.safeLeadIn);
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
