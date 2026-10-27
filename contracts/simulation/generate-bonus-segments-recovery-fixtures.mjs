// Explicit producer for catalog-6 steady recovery spacing parity.
// Run after build:sim; this writes only bonus-segments-recovery-v1.json.
import { writeFileSync } from 'node:fs';

const simulationModule = process.env.DUCK_SIM_MODULE ?? new URL('../../packages/game-sim/dist/index.js', import.meta.url).href;
const {
  BONUS_SEGMENTS_CONFIG_ID,
  BONUS_SEGMENTS_DEFAULT_CONFIG,
  BONUS_SEGMENTS_GENERATOR_VERSION,
  BONUS_SEGMENTS_SIMULATION_VERSION,
  canonicalState,
  createRun,
  createRunDescriptor,
  generateNext,
  isBonusSegmentBlock,
  makeInput,
  step,
} = await import(simulationModule);

const seed = 1;
const recoveryBlock = 3;
if (!isBonusSegmentBlock(seed, 2) || isBonusSegmentBlock(seed, recoveryBlock))
  throw new Error('seed must schedule block 2 and leave the following steady block ordinary');
const descriptor = createRunDescriptor({ runId: 'bonus-segments-recovery-v1', seed }, BONUS_SEGMENTS_DEFAULT_CONFIG);
const base = createRun(descriptor, BONUS_SEGMENTS_DEFAULT_CONFIG);
const firstPipeIndex = recoveryBlock * 4;
const generated = generateNext({ ...base, pipes: [], nextPipeIndex: firstPipeIndex,
  nextSpawnPipeIndex: firstPipeIndex, nextPipeX: 100_000, lastGapCenter: 280_000 });
const recoveryPipes = generated.state.pipes.filter(pipe => pipe.index >= firstPipeIndex && pipe.index < firstPipeIndex + 4);
if (recoveryPipes.length !== 4 || recoveryPipes.some(pipe => pipe.encounterFamily !== 'steady' || pipe.stationSpacing !== 267_600))
  throw new Error(`catalog-6 recovery block spacing mismatch: ${recoveryPipes.map(pipe => pipe.stationSpacing)}`);

const initialState = { ...generated.state, phase: 'RUNNING',
  duck: { ...base.duck, y: recoveryPipes[0].gapCenter, vy: 0 } };
const frames = [makeInput(initialState.nextInputSequence, 'FLAP')];
const result = step(initialState, frames);
const snapshot = state => JSON.parse(canonicalState(state));
const fixture = {
  fixtureRevision: 'bonus-segments-recovery-1',
  simulationVersion: BONUS_SEGMENTS_SIMULATION_VERSION,
  generatorVersion: BONUS_SEGMENTS_GENERATOR_VERSION,
  configId: BONUS_SEGMENTS_CONFIG_ID,
  cases: [{ name: 'catalog-6-steady-recovery-uses-70-percent-of-360000', syntheticInitialState: true,
    initialState: snapshot(initialState), operations: [{ kind: 'step', frames,
      expectedState: snapshot(result.state), expectedEvents: [...result.events] }] }],
};
writeFileSync(new URL('./bonus-segments-recovery-v1.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
console.log(JSON.stringify({ fixtureRevision: fixture.fixtureRevision, cases: fixture.cases.map(item => item.name),
  spacing: recoveryPipes.map(pipe => pipe.stationSpacing) }));
