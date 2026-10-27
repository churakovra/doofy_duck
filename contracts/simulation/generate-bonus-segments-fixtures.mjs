// Explicit producer for the catalog-6 deterministic bonus-segment replay contract.
// Run after build:sim; this writes only bonus-segments-v1.json.
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

const snapshot = state => JSON.parse(canonicalState(state));
const cases = [];
function record(name, state, frames = [], syntheticInitialState = true) {
  const result = step(state, frames);
  cases.push({ name, syntheticInitialState, initialState: snapshot(state), operations: [{ kind: 'step', frames,
    expectedState: snapshot(result.state), expectedEvents: [...result.events] }] });
  return result;
}

const defaultDescriptor = createRunDescriptor({ runId: 'bonus-default-start', seed: 41 }, BONUS_SEGMENTS_DEFAULT_CONFIG);
const defaultState = createRun(defaultDescriptor, BONUS_SEGMENTS_DEFAULT_CONFIG);
const defaultStarted = record('bonus-default-starts-with-catalog-6', defaultState,
  [makeInput(defaultState.nextInputSequence, 'FLAP')], false);
if (defaultStarted.state.config.wetland?.catalogVersion !== 6) throw new Error('catalog-6 default run missing');

function ordinaryPickupState(seed) {
  const descriptor = createRunDescriptor({ runId: `bonus-normal-pickup-${seed}`, seed }, BONUS_SEGMENTS_DEFAULT_CONFIG);
  const base = createRun(descriptor, BONUS_SEGMENTS_DEFAULT_CONFIG);
  const pipe = base.pipes.find(item => item.index === 1);
  const state = { ...base, phase: 'RUNNING', collectibles: [], pipes: [{ ...pipe, x: 500_000 }],
    nextSpawnPipeIndex: pipe.index, nextPipeX: 10_000_000,
    duck: { ...base.duck, y: 280_000, vy: 0 } };
  return { state, result: step(state, [makeInput(state.nextInputSequence, 'FLAP')]) };
}

let ordinary;
for (let seed = 0; seed < 2048; seed++) {
  const candidate = ordinaryPickupState(seed);
  const feathers = candidate.result.state.collectibles.filter(item => item.typeId === 'FEATHER');
  if (feathers.length === 1) { ordinary = candidate; break; }
}
if (!ordinary) throw new Error('could not find an ordinary single-FEATHER pickup witness');
const ordinaryFrames = [makeInput(ordinary.state.nextInputSequence, 'FLAP')];
cases.push({ name: 'ordinary-block-spawns-one-feather', syntheticInitialState: true,
  initialState: snapshot(ordinary.state), operations: [{ kind: 'step', frames: ordinaryFrames,
    expectedState: snapshot(ordinary.result.state), expectedEvents: [...ordinary.result.events] }] });

const starSeed = 13;
const starDescriptor = createRunDescriptor({ runId: 'bonus-single-star', seed: starSeed }, BONUS_SEGMENTS_DEFAULT_CONFIG);
const starBase = createRun(starDescriptor, BONUS_SEGMENTS_DEFAULT_CONFIG);
const starPipe = starBase.pipes.find(item => item.index === 1);
const starState = { ...starBase, phase: 'RUNNING', collectibles: [], pipes: [{ ...starPipe, x: 500_000 }],
  nextSpawnPipeIndex: starPipe.index, nextStarPipeIndex: starPipe.index, starScheduleOrdinal: 0,
  nextPipeX: 10_000_000, duck: { ...starBase.duck, y: 280_000, vy: 0 } };
const starFrames = [makeInput(starState.nextInputSequence, 'FLAP')];
const starResult = record('scheduled-star-is-one-pickup-by-default', starState, starFrames);
if (starResult.state.collectibles.filter(item => item.typeId === 'GAME_STAR').length !== 1)
  throw new Error('default scheduled Star was not a single pickup');

const courseSeed = 44;
const courseDescriptor = createRunDescriptor({ runId: 'bonus-course-reward', seed: courseSeed }, BONUS_SEGMENTS_DEFAULT_CONFIG);
const firstBlock = [2, 3].find(block => isBonusSegmentBlock(courseSeed, block));
if (firstBlock === undefined) throw new Error('no first scheduled bonus segment');
const thirdGateIndex = firstBlock * 4 + 2;
const courseBase = createRun(courseDescriptor, BONUS_SEGMENTS_DEFAULT_CONFIG);
const generated = generateNext({ ...courseBase, pipes: [], nextPipeIndex: thirdGateIndex,
  nextSpawnPipeIndex: thirdGateIndex, nextPipeX: 420_000, lastGapCenter: 280_000 });
const courseState = { ...generated.state, phase: 'RUNNING', nextSpawnPipeIndex: thirdGateIndex,
  duck: { ...courseBase.duck, y: 280_000, vy: 0 } };
const courseFrames = [makeInput(courseState.nextInputSequence, 'FLAP')];
const courseResult = record('third-gate-spawns-three-member-reward-figure', courseState, courseFrames);
if (courseResult.state.collectibles.filter(item => item.typeId === 'FEATHER').length !== 3)
  throw new Error('bonus-segment reward figure missing');

const fixture = { fixtureRevision: 'bonus-segments-1', simulationVersion: BONUS_SEGMENTS_SIMULATION_VERSION,
  generatorVersion: BONUS_SEGMENTS_GENERATOR_VERSION, configId: BONUS_SEGMENTS_CONFIG_ID, cases };
writeFileSync(new URL('./bonus-segments-v1.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
console.log(JSON.stringify({ fixtureRevision: fixture.fixtureRevision, cases: cases.map(item => item.name) }));
