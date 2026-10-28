import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRIOR_DEFAULT_CONFIG, PRIOR_DEFAULT_CONFIG_ID, DEFAULT_CONFIG, DEFAULT_CONFIG_ID, BONUS_SEGMENTS_CONFIG_ID, BONUS_SEGMENTS_DEFAULT_CONFIG, BONUS_SEGMENTS_V2_CONFIG_ID, BONUS_SEGMENTS_V2_DEFAULT_CONFIG, BONUS_SEGMENTS_V2_GENERATOR_VERSION, BONUS_SEGMENTS_V2_SIMULATION_VERSION, COIN_COURSE_DEFAULT_CONFIG, COIN_COURSE_CONFIG_ID, COIN_COURSE_GENERATOR_VERSION, COIN_COURSE_SIMULATION_VERSION, CURRENCY_FORMATIONS_DEFAULT_CONFIG, CURRENCY_FORMATIONS_CONFIG_ID, CURRENCY_FORMATIONS_SIMULATION_VERSION, CURRENCY_FORMATIONS_GENERATOR_VERSION, PAIRED_ROUTES_DEFAULT_CONFIG, PAIRED_ROUTES_CONFIG_ID, PAIRED_ROUTES_GENERATOR_VERSION, PAIRED_ROUTES_SIMULATION_VERSION, GENERATOR_VERSION, LEGACY_DEFAULT_CONFIG, LEGACY_DEFAULT_CONFIG_ID, LEGACY_GENERATOR_VERSION, LEGACY_SIMULATION_VERSION, PRIOR_GENERATOR_VERSION, PRIOR_SIMULATION_VERSION, SIMULATION_VERSION, VARIED_OBSTACLE_DEFAULT_CONFIG, VARIED_OBSTACLE_DEFAULT_CONFIG_ID, VARIED_OBSTACLE_GENERATOR_VERSION, VARIED_OBSTACLE_SIMULATION_VERSION, WETLAND_DEFAULT_CONFIG, WETLAND_DEFAULT_CONFIG_ID, WETLAND_GENERATOR_VERSION, WETLAND_SIMULATION_VERSION, canonicalState, createRun, createRunDescriptor, makeInput, mix32, pauseRun, restartRun, resumeRun, step } from '../src/index.js';
import type { GameConfig, GameEvent, InputFrame, RunDescriptor, RunState } from '../src/index.js';
type Operation = { kind: string; frames?: InputFrame[]; ticks?: number; flapTicks?: number[]; descriptor?: RunDescriptor; expectedState: RunState; expectedEvents: GameEvent[] };
type Case = { name: string; syntheticInitialState: boolean; initialState: RunState; operations: Operation[] };
type InvalidCase = { name: string; kind: string; descriptor?: RunDescriptor; config?: GameConfig; initialState?: RunState; frames?: InputFrame[] };
const fixture = JSON.parse(readFileSync('contracts/simulation/golden-v1.json', 'utf8')) as { fixtureRevision: string; contractVersion: string; rules: { generation: { firstPipeX: number }; speed: string }; defaultConfig: GameConfig; cases: Case[]; mixerVectors: { input: number; output: number }[]; invalidCases: InvalidCase[] };
const bonusSegmentFixture = JSON.parse(readFileSync('contracts/simulation/bonus-segments-v1.json', 'utf8')) as {
  fixtureRevision: string; simulationVersion: string; generatorVersion: string; configId: string; cases: Case[];
};
const bonusSegmentsV2Fixture = JSON.parse(readFileSync('contracts/simulation/bonus-segments-v2.json', 'utf8')) as {
  fixtureRevision: string; simulationVersion: string; generatorVersion: string; configId: string; cases: Case[];
};
const bonusSegmentsRecoveryFixture = JSON.parse(readFileSync('contracts/simulation/bonus-segments-recovery-v1.json', 'utf8')) as {
  fixtureRevision: string; simulationVersion: string; generatorVersion: string; configId: string; cases: Case[];
};
describe('shared contract fixtures', () => {
  it('pins the current ruleset identity and default config', () => {
    expect(fixture.fixtureRevision).toBe('stepped-challenges-1');
    expect(fixture.contractVersion).toBe(LEGACY_SIMULATION_VERSION);
    expect(fixture.defaultConfig).toEqual(LEGACY_DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG_ID).toBe('dd-v3-curved-pipes-v1');
    expect(createRunDescriptor({ runId: 'fixture-contract', seed: 1 }).configId).toBe(DEFAULT_CONFIG_ID);
    expect([SIMULATION_VERSION, GENERATOR_VERSION, DEFAULT_CONFIG_ID]).toEqual(['3.2.0', '3.2.0', 'dd-v3-curved-pipes-v1']);
    expect(DEFAULT_CONFIG.wetland?.catalogVersion).toBe(13);
    expect(BONUS_SEGMENTS_DEFAULT_CONFIG.wetland?.catalogVersion).toBe(6);
    expect(BONUS_SEGMENTS_DEFAULT_CONFIG.wetland?.starFormations).toBe(false);
    expect(BONUS_SEGMENTS_V2_DEFAULT_CONFIG.wetland?.catalogVersion).toBe(7);
    expect(createRunDescriptor({ runId: 'bonus-segments-v1-frozen', seed: 1 }, BONUS_SEGMENTS_DEFAULT_CONFIG)).toMatchObject({
      simulationVersion: '2.5.0', generatorVersion: '2.5.0', configId: BONUS_SEGMENTS_CONFIG_ID,
    });
    expect(COIN_COURSE_DEFAULT_CONFIG.wetland?.catalogVersion).toBe(5);
    expect(createRunDescriptor({ runId: 'coin-course-frozen', seed: 1 }, COIN_COURSE_DEFAULT_CONFIG)).toMatchObject({
      simulationVersion: COIN_COURSE_SIMULATION_VERSION, generatorVersion: COIN_COURSE_GENERATOR_VERSION,
      configId: COIN_COURSE_CONFIG_ID,
    });
    expect(CURRENCY_FORMATIONS_DEFAULT_CONFIG.wetland?.catalogVersion).toBe(4);
    expect(createRunDescriptor({ runId: 'currency-formations-frozen', seed: 1 }, CURRENCY_FORMATIONS_DEFAULT_CONFIG)).toMatchObject({
      simulationVersion: CURRENCY_FORMATIONS_SIMULATION_VERSION, generatorVersion: CURRENCY_FORMATIONS_GENERATOR_VERSION,
      configId: CURRENCY_FORMATIONS_CONFIG_ID,
    });
    expect(createRunDescriptor({ runId: 'paired-contract', seed: 1 }, PAIRED_ROUTES_DEFAULT_CONFIG)).toMatchObject({
      simulationVersion: PAIRED_ROUTES_SIMULATION_VERSION, generatorVersion: PAIRED_ROUTES_GENERATOR_VERSION, configId: PAIRED_ROUTES_CONFIG_ID,
    });
    expect(DEFAULT_CONFIG.wetland?.families.every(family => family.obstacleTypes.every(type => type === 'pipes'))).toBe(true);
    expect(createRunDescriptor({ runId: 'varied-v2-contract', seed: 1 }, VARIED_OBSTACLE_DEFAULT_CONFIG)).toMatchObject({
      simulationVersion: VARIED_OBSTACLE_SIMULATION_VERSION, generatorVersion: VARIED_OBSTACLE_GENERATOR_VERSION,
      configId: VARIED_OBSTACLE_DEFAULT_CONFIG_ID,
    });
    expect(VARIED_OBSTACLE_DEFAULT_CONFIG.wetland?.catalogVersion).toBe(2);
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
    expect(current.config.wetland?.catalogVersion).toBe(13);
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
      expect.objectContaining({ properties: expect.objectContaining({ simulationVersion: { const: BONUS_SEGMENTS_V2_SIMULATION_VERSION }, generatorVersion: { const: BONUS_SEGMENTS_V2_GENERATOR_VERSION }, configId: { anyOf: expect.arrayContaining([expect.objectContaining({ const: BONUS_SEGMENTS_V2_CONFIG_ID })]) } }) }),
      expect.objectContaining({ properties: expect.objectContaining({ simulationVersion: { const: COIN_COURSE_SIMULATION_VERSION }, generatorVersion: { const: COIN_COURSE_GENERATOR_VERSION }, configId: expect.any(Object) }) }),
      expect.objectContaining({ properties: expect.objectContaining({ simulationVersion: { const: CURRENCY_FORMATIONS_SIMULATION_VERSION }, generatorVersion: { const: CURRENCY_FORMATIONS_GENERATOR_VERSION }, configId: expect.any(Object) }) }),
      expect.objectContaining({ properties: expect.objectContaining({ simulationVersion: { const: LEGACY_SIMULATION_VERSION }, generatorVersion: { const: LEGACY_GENERATOR_VERSION }, configId: expect.any(Object) }) }),
    ]));
  });
  it('replays catalog-6 bonus-segment shared state and event fixtures', () => {
    expect(bonusSegmentFixture).toMatchObject({ fixtureRevision: 'bonus-segments-1', simulationVersion: '2.5.0',
      generatorVersion: '2.5.0', configId: BONUS_SEGMENTS_CONFIG_ID });
    expect(bonusSegmentFixture.cases.map(example => example.name)).toEqual([
      'bonus-default-starts-with-catalog-6', 'ordinary-block-spawns-one-feather',
      'scheduled-star-is-one-pickup-by-default', 'third-gate-spawns-three-member-reward-figure',
    ]);
    for (const example of bonusSegmentFixture.cases) {
      let state = example.syntheticInitialState ? example.initialState : createRun(example.initialState.descriptor, example.initialState.config);
      expect(canonicalState(state)).toBe(canonicalState(example.initialState));
      for (const operation of example.operations) {
        if (operation.kind !== 'step') throw new Error(`unsupported bonus-segment fixture operation ${operation.kind}`);
        const result = step(state, operation.frames ?? []);
        state = result.state;
        expect(canonicalState(state)).toBe(canonicalState(operation.expectedState));
        expect(result.events).toEqual(operation.expectedEvents);
      }
    }
  });
  it('replays the separate catalog-6 steady recovery parity fixture', () => {
    expect(bonusSegmentsRecoveryFixture).toMatchObject({ fixtureRevision: 'bonus-segments-recovery-1',
      simulationVersion: '2.5.0', generatorVersion: '2.5.0', configId: BONUS_SEGMENTS_CONFIG_ID });
    expect(bonusSegmentsRecoveryFixture.cases.map(example => example.name)).toEqual([
      'catalog-6-steady-recovery-uses-70-percent-of-360000',
    ]);
    const example = bonusSegmentsRecoveryFixture.cases[0]!;
    const recoveryPipes = example.initialState.pipes.filter(pipe => pipe.index >= 12 && pipe.index < 16);
    expect(recoveryPipes).toHaveLength(4);
    expect(recoveryPipes.map(pipe => pipe.encounterFamily)).toEqual(['steady', 'steady', 'steady', 'steady']);
    expect(recoveryPipes.map(pipe => pipe.stationSpacing)).toEqual([267_600, 267_600, 267_600, 267_600]);
    let state = example.initialState;
    for (const operation of example.operations) {
      if (operation.kind !== 'step') throw new Error(`unsupported recovery fixture operation ${operation.kind}`);
      const result = step(state, operation.frames ?? []);
      state = result.state;
      expect(canonicalState(state)).toBe(canonicalState(operation.expectedState));
      expect(result.events).toEqual(operation.expectedEvents);
    }
  });
  it('replays catalog-7 bonus-segment shared state and event fixtures', () => {
    expect(bonusSegmentsV2Fixture).toMatchObject({ fixtureRevision: 'bonus-segments-v2-1',
      simulationVersion: BONUS_SEGMENTS_V2_SIMULATION_VERSION, generatorVersion: BONUS_SEGMENTS_V2_GENERATOR_VERSION,
      configId: BONUS_SEGMENTS_V2_CONFIG_ID });
    expect(bonusSegmentsV2Fixture.cases.map(example => example.name)).toEqual([
      'bonus-v2-default-starts-with-catalog-7', 'ordinary-block-spawns-one-feather',
      'scheduled-star-is-one-pickup-by-default', 'sloped-segment-exit-spawns-three-member-reward-figure',
    ]);
    for (const example of bonusSegmentsV2Fixture.cases) {
      let state = example.syntheticInitialState ? example.initialState : createRun(example.initialState.descriptor, example.initialState.config);
      expect(canonicalState(state)).toBe(canonicalState(example.initialState));
      for (const operation of example.operations) {
        if (operation.kind !== 'step') throw new Error(`unsupported bonus-segment-v2 fixture operation ${operation.kind}`);
        const result = step(state, operation.frames ?? []);
        state = result.state;
        expect(canonicalState(state)).toBe(canonicalState(operation.expectedState));
        expect(result.events).toEqual(operation.expectedEvents);
      }
    }
  });
  it('replays catalog-9 generated pressure state and events', () => {
    const fixture = JSON.parse(readFileSync('contracts/simulation/pressure-pipes-replay-v1.json', 'utf8')) as { cases: Case[] };
    for (const example of fixture.cases) {
      let state = example.initialState;
      for (const operation of example.operations) {
        const result = step(state, operation.frames ?? []);
        expect(canonicalState(result.state)).toBe(canonicalState(operation.expectedState));
        expect(result.events).toEqual(operation.expectedEvents);
        state = result.state;
      }
    }
  });
  it('replays catalog-10 generated dense state and events', () => {
    const fixture = JSON.parse(readFileSync('contracts/simulation/dense-pipes-replay-v1.json', 'utf8')) as { cases: Case[] };
    for (const example of fixture.cases) {
      let state = example.initialState;
      for (const operation of example.operations) {
        const result = step(state, operation.frames ?? []);
        expect(canonicalState(result.state)).toBe(canonicalState(operation.expectedState));
        expect(result.events).toEqual(operation.expectedEvents);
        state = result.state;
      }
    }
  });
  it('replays catalog-11 generated bonus state and events', () => {
    const fixture = JSON.parse(readFileSync('contracts/simulation/base-bonus-replay-v1.json', 'utf8')) as { cases: Case[] };
    for (const example of fixture.cases) {
      let state = example.initialState;
      for (const operation of example.operations) {
        const result = step(state, operation.frames ?? []);
        expect(canonicalState(result.state)).toBe(canonicalState(operation.expectedState));
        expect(result.events).toEqual(operation.expectedEvents);
        state = result.state;
      }
    }
  });
  it('replays catalog-13 generated bonus state and events', () => {
    const fixture = JSON.parse(readFileSync('contracts/simulation/curved-pipes-replay-v1.json', 'utf8')) as { cases: Case[] };
    for (const example of fixture.cases) {
      let state = example.initialState;
      for (const operation of example.operations) {
        const result = step(state, operation.frames ?? []);
        expect(canonicalState(result.state)).toBe(canonicalState(operation.expectedState));
        expect(result.events).toEqual(operation.expectedEvents);
        state = result.state;
      }
    }
  });
  it('replays catalog-12 generated bonus state and events', () => {
    const fixture = JSON.parse(readFileSync('contracts/simulation/varied-base-replay-v1.json', 'utf8')) as { cases: Case[] };
    for (const example of fixture.cases) {
      let state = example.initialState;
      for (const operation of example.operations) {
        const result = step(state, operation.frames ?? []);
        expect(canonicalState(result.state)).toBe(canonicalState(operation.expectedState));
        expect(result.events).toEqual(operation.expectedEvents);
        state = result.state;
      }
    }
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
