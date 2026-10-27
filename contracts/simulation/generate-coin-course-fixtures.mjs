// Explicit producer for the catalog-5 deterministic coin-course replay contract.
// Run after build:sim; this writes only coin-course-v1.json.
import { writeFileSync } from 'node:fs';
const simulationModule = process.env.DUCK_SIM_MODULE ?? new URL('../../packages/game-sim/dist/index.js', import.meta.url).href;
const { COIN_COURSE_DEFAULT_CONFIG, COIN_COURSE_CONFIG_ID, COIN_COURSE_SIMULATION_VERSION,
  COIN_COURSE_GENERATOR_VERSION, canonicalState, createRun, createRunDescriptor, makeInput, step } = await import(simulationModule);
const snapshot = state => JSON.parse(canonicalState(state));
const descriptor = createRunDescriptor({ runId: 'coin-course-fixture', seed: 44 }, COIN_COURSE_DEFAULT_CONFIG);
let state = createRun(descriptor);
// Pin the first scheduled course's third gate as the next unspawned station.
const firstBlock = 2 + 2 * ((await import(simulationModule)).mix32((descriptor.seed ^ 0x6d2b79f5) >>> 0) % 3);
const thirdGateIndex = firstBlock * 4 + 2;
const generated = (await import(simulationModule)).generateNext({ ...state, pipes: [], nextPipeIndex: thirdGateIndex,
  nextPipeX: 420000, lastGapCenter: 280000 });
state = { ...generated.state, phase: 'RUNNING', nextSpawnPipeIndex: thirdGateIndex,
  duck: { ...state.duck, y: 280000, vy: 0 } };
const result = step(state, [makeInput(state.nextInputSequence, 'FLAP')]);
const fixture = { fixtureRevision: 'coin-course-1', simulationVersion: COIN_COURSE_SIMULATION_VERSION,
  generatorVersion: COIN_COURSE_GENERATOR_VERSION, configId: COIN_COURSE_CONFIG_ID,
  cases: [{ name: 'course-feather-members-spawn-after-third-gate', syntheticInitialState: true,
    initialState: snapshot(state), operations: [{ kind: 'step', frames: [makeInput(state.nextInputSequence, 'FLAP')],
      expectedState: snapshot(result.state), expectedEvents: [...result.events] }] }] };
if (result.state.collectibles.filter(item => item.typeId === 'FEATHER').length !== 3) throw new Error('course FEATHER group missing');
writeFileSync(new URL('./coin-course-v1.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
console.log(JSON.stringify({ fixtureRevision: fixture.fixtureRevision, cases: fixture.cases.map(item => item.name) }));
