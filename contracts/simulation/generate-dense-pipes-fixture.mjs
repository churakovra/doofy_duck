// Generate the catalog-10 full-state replay fixture after build:sim.
import { writeFileSync } from 'node:fs';
import { canonicalState, createRun, createRunDescriptor, makeInput, step, DENSE_PIPES_SIMULATION_VERSION, DENSE_PIPES_GENERATOR_VERSION, DENSE_PIPES_CONFIG_ID, DENSE_PIPES_DEFAULT_CONFIG } from '../../packages/game-sim/dist/index.js';
const snapshot = state => JSON.parse(canonicalState(state));
const base = createRun(createRunDescriptor({ runId: 'dense-pipes-replay', seed: 42 }, DENSE_PIPES_DEFAULT_CONFIG));
const initial = { ...base, phase: 'RUNNING', pipes: [], collectibles: [], nextPipeIndex: 16,
  nextPipeX: 350_000, lastGapCenter: 280_000, nextSpawnPipeIndex: 16 };
const frames = [makeInput(initial.nextInputSequence, 'FLAP')];
const result = step(initial, frames);
const fixture = { fixtureRevision: 'dense-pipes-replay-1', simulationVersion: DENSE_PIPES_SIMULATION_VERSION,
  generatorVersion: DENSE_PIPES_GENERATOR_VERSION, configId: DENSE_PIPES_CONFIG_ID, cases: [{ name: 'pressure-refill',
    syntheticInitialState: true, initialState: snapshot(initial), operations: [{ kind: 'step', frames,
      expectedState: snapshot(result.state), expectedEvents: result.events }] }] };
writeFileSync(new URL('./dense-pipes-replay-v1.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
