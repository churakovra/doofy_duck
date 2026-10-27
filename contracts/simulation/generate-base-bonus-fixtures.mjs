// Generate catalog-11 geometry vectors and full-state replay after build:sim.
import { writeFileSync } from 'node:fs';
import { canonicalState, createRun, createRunDescriptor, generateNext, makeInput, step, BASE_BONUS_SIMULATION_VERSION, BASE_BONUS_GENERATOR_VERSION, BASE_BONUS_CONFIG_ID, BASE_BONUS_DEFAULT_CONFIG } from '../../packages/game-sim/dist/index.js';
import { isScheduledBonusBlock } from '../../packages/game-sim/dist/generation.js';
const cases = [];
for (const seed of [0, 1, 42, 4294967295]) for (const block of [0, 1, 6, 7, 8, 13, 14, 15]) {
  const state = createRun(createRunDescriptor({ runId: 'vector', seed }, BASE_BONUS_DEFAULT_CONFIG));
  const pipes = generateNext({ ...state, pipes: [], nextPipeIndex: block * 4, nextPipeX: 100_000, lastGapCenter: 280_000 }).state.pipes.slice(0, 4);
  cases.push({ seed, block, centers: pipes.map(pipe => pipe.gapCenter), spacings: pipes.map(pipe => pipe.stationSpacing) });
}
writeFileSync(new URL('./base-bonus-v1.json', import.meta.url), JSON.stringify({ cases }, null, 2) + '\n');
const base = createRun(createRunDescriptor({ runId: 'base-bonus-replay', seed: 42 }, BASE_BONUS_DEFAULT_CONFIG));
const block = [6, 7, 8].find(value => isScheduledBonusBlock(base.config, base.descriptor.seed, value));
const initial = { ...base, phase: 'RUNNING', pipes: [], collectibles: [], nextPipeIndex: block * 4,
  nextPipeX: 350_000, lastGapCenter: 280_000, nextSpawnPipeIndex: block * 4 };
const frames = [makeInput(initial.nextInputSequence, 'FLAP')];
const result = step(initial, frames);
const snapshot = state => JSON.parse(canonicalState(state));
const fixture = { fixtureRevision: 'base-bonus-replay-1', simulationVersion: BASE_BONUS_SIMULATION_VERSION,
  generatorVersion: BASE_BONUS_GENERATOR_VERSION, configId: BASE_BONUS_CONFIG_ID, cases: [{ name: 'bonus-refill',
    syntheticInitialState: true, initialState: snapshot(initial), operations: [{ kind: 'step', frames,
      expectedState: snapshot(result.state), expectedEvents: result.events }] }] };
writeFileSync(new URL('./base-bonus-replay-v1.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
