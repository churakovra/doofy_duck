// Explicit producer for the catalog-7 deterministic bonus-segment replay contract.
// Run after build:sim; this writes only bonus-segments-v2.json.
import { writeFileSync } from 'node:fs';

const simulationModule = process.env.DUCK_SIM_MODULE ?? new URL('../../packages/game-sim/dist/index.js', import.meta.url).href;
const {
  BONUS_SEGMENTS_V2_CONFIG_ID,
  BONUS_SEGMENTS_V2_DEFAULT_CONFIG,
  BONUS_SEGMENTS_V2_GENERATOR_VERSION,
  BONUS_SEGMENTS_V2_SIMULATION_VERSION,
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

const defaultState = createRun(createRunDescriptor({ runId: 'bonus-v2-default-start', seed: 41 }, BONUS_SEGMENTS_V2_DEFAULT_CONFIG));
const defaultStarted = record('bonus-v2-default-starts-with-catalog-7', defaultState,
  [makeInput(defaultState.nextInputSequence, 'FLAP')], false);
if (defaultStarted.state.config.wetland?.catalogVersion !== 7) throw new Error('catalog-7 default run missing');

function ordinaryPickupState(seed, pipeIndex = 1) {
  const base = createRun(createRunDescriptor({ runId: `bonus-v2-normal-pickup-${seed}`, seed }, BONUS_SEGMENTS_V2_DEFAULT_CONFIG));
  const pipe = base.pipes.find(item => item.index === pipeIndex);
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
cases.push({ name: 'ordinary-block-spawns-one-feather', syntheticInitialState: true,
  initialState: snapshot(ordinary.state), operations: [{ kind: 'step', frames: [makeInput(ordinary.state.nextInputSequence, 'FLAP')],
    expectedState: snapshot(ordinary.result.state), expectedEvents: [...ordinary.result.events] }] });

const starSeed = 13;
const starBase = createRun(createRunDescriptor({ runId: 'bonus-v2-single-star', seed: starSeed }, BONUS_SEGMENTS_V2_DEFAULT_CONFIG));
const starPipe = starBase.pipes.find(item => item.index === 1);
if (!starPipe) throw new Error('catalog-7 initial pipe missing for scheduled Star witness');
const starState = { ...starBase, phase: 'RUNNING', collectibles: [], pipes: [{ ...starPipe, x: 500_000 }],
  nextSpawnPipeIndex: starPipe.index, nextStarPipeIndex: starPipe.index, starScheduleOrdinal: 0, nextPipeX: 10_000_000,
  duck: { ...starBase.duck, y: 280_000, vy: 0 } };
const starFrames = [makeInput(starState.nextInputSequence, 'FLAP')];
const starResult = step(starState, starFrames);
if (starResult.state.collectibles.filter(item => item.typeId === 'GAME_STAR').length !== 1)
  throw new Error('scheduled single-GAME_STAR pickup witness failed');
cases.push({ name: 'scheduled-star-is-one-pickup-by-default', syntheticInitialState: true,
  initialState: snapshot(starState), operations: [{ kind: 'step', frames: starFrames,
    expectedState: snapshot(starResult.state), expectedEvents: [...starResult.events] }] });

let course;
for (let seed = 0; seed < 2048; seed++) {
  const firstBlock = [2, 3].find(block => isBonusSegmentBlock(seed, block));
  if (firstBlock === undefined) continue;
  const base = createRun(createRunDescriptor({ runId: `bonus-v2-course-${seed}`, seed }, BONUS_SEGMENTS_V2_DEFAULT_CONFIG));
  const firstIndex = firstBlock * 4;
  const thirdGateIndex = firstIndex + 2;
  const generated = generateNext({ ...base, pipes: [], nextPipeIndex: firstIndex,
    nextSpawnPipeIndex: firstIndex, nextPipeX: 350_000, lastGapCenter: 280_000 });
  const route = generated.state.pipes.filter(pipe => pipe.index >= firstIndex && pipe.index <= firstIndex + 3);
  if (route.length < 4 || Math.min(route[0].gapCenter, route[1].gapCenter, route[2].gapCenter) ===
      Math.max(route[0].gapCenter, route[1].gapCenter, route[2].gapCenter)) continue;
  const state = { ...generated.state, phase: 'RUNNING', nextSpawnPipeIndex: thirdGateIndex,
    duck: { ...base.duck, y: 280_000, vy: 0 } };
  const result = step(state, [makeInput(state.nextInputSequence, 'FLAP')]);
  if (result.state.collectibles.filter(item => item.typeId === 'FEATHER').length !== 3) continue;
  course = { state, result, route };
  break;
}
if (!course) throw new Error('could not find a sloped catalog-7 segment with its reward figure and recovery station');
cases.push({ name: 'sloped-segment-exit-spawns-three-member-reward-figure', syntheticInitialState: true,
  initialState: snapshot(course.state), operations: [{ kind: 'step', frames: [makeInput(course.state.nextInputSequence, 'FLAP')],
    expectedState: snapshot(course.result.state), expectedEvents: [...course.result.events] }] });

const fixture = { fixtureRevision: 'bonus-segments-v2-1', simulationVersion: BONUS_SEGMENTS_V2_SIMULATION_VERSION,
  generatorVersion: BONUS_SEGMENTS_V2_GENERATOR_VERSION, configId: BONUS_SEGMENTS_V2_CONFIG_ID, cases };
writeFileSync(new URL('./bonus-segments-v2.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
console.log(JSON.stringify({ fixtureRevision: fixture.fixtureRevision, cases: cases.map(item => item.name),
  course: { route: course.route.map(pipe => ({ index: pipe.index, gapCenter: pipe.gapCenter, spacing: pipe.stationSpacing })) } }));
