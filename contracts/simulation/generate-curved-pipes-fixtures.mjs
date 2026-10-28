// Generate catalog-13 geometry vectors and full-state replay after build:sim.
import { writeFileSync } from 'node:fs';
import { canonicalState, createRun, createRunDescriptor, generateNext, makeInput, step, SIMULATION_VERSION, GENERATOR_VERSION, DEFAULT_CONFIG_ID, DEFAULT_CONFIG } from '../../packages/game-sim/dist/index.js';
import { isScheduledBonusBlock } from '../../packages/game-sim/dist/generation.js';
const cases = [];
for (const seed of [0, 1, 42, 4294967295]) for (const block of [0, 1, 6, 7, 8, 13, 14, 15]) {
  const state = createRun(createRunDescriptor({ runId: 'vector', seed }, DEFAULT_CONFIG));
  const pipes = generateNext({ ...state, pipes: [], nextPipeIndex: block * 4, nextPipeX: 100_000, lastGapCenter: 280_000 }).state.pipes.slice(0, 4);
  cases.push({ seed, block, centers: pipes.map(pipe => pipe.gapCenter), spacings: pipes.map(pipe => pipe.stationSpacing) });
}
writeFileSync(new URL('./curved-pipes-v1.json', import.meta.url), JSON.stringify({ cases }, null, 2) + '\n');
const base = createRun(createRunDescriptor({ runId: 'curved-pipes-replay', seed: 42 }, DEFAULT_CONFIG));
const block = [6, 7, 8].find(value => isScheduledBonusBlock(base.config, base.descriptor.seed, value));
const initial = { ...base, phase: 'RUNNING', pipes: [], collectibles: [], nextPipeIndex: block * 4,
  nextPipeX: 350_000, lastGapCenter: 280_000, nextSpawnPipeIndex: block * 4 };
const frames = [makeInput(initial.nextInputSequence, 'FLAP')];
const result = step(initial, frames);
const snapshot = state => JSON.parse(canonicalState(state));
const fixture = { fixtureRevision: 'curved-pipes-replay-1', simulationVersion: SIMULATION_VERSION,
  generatorVersion: GENERATOR_VERSION, configId: DEFAULT_CONFIG_ID, cases: [{ name: 'bonus-refill',
    syntheticInitialState: true, initialState: snapshot(initial), operations: [{ kind: 'step', frames,
      expectedState: snapshot(result.state), expectedEvents: result.events }] }] };
writeFileSync(new URL('./curved-pipes-replay-v1.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
