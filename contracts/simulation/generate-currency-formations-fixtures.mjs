// Explicit producer for the catalog-4 currency-formation replay contract.
// Run after build:sim; this writes only currency-formations-v1.json.
import { writeFileSync } from 'node:fs';
const simulationModule = process.env.DUCK_SIM_MODULE ?? new URL('../../packages/game-sim/dist/index.js', import.meta.url).href;
const { DEFAULT_CONFIG, SIMULATION_VERSION, GENERATOR_VERSION, DEFAULT_CONFIG_ID,
  canonicalState, createRun, createRunDescriptor, makeInput, step } = await import(simulationModule);

const snapshot = state => JSON.parse(canonicalState(state));
const descriptor = (runId, seed) => createRunDescriptor({ runId, seed }, DEFAULT_CONFIG);
const cases = [];
function record(name, state, frames = []) {
  const result = step(state, frames);
  cases.push({ name, syntheticInitialState: state.tick !== 0 || state.phase !== 'READY',
    initialState: snapshot(state), operations: [{ kind: 'step', frames, expectedState: snapshot(result.state), expectedEvents: [...result.events] }] });
  return result;
}

const ready = createRun(descriptor('currency-ready-start', 7));
record('currency-ready-starts-on-first-flap', ready, [makeInput(0, 'FLAP')]);

const featherBase = createRun(descriptor('currency-feather-formation', 11));
const featherState = { ...featherBase, phase: 'RUNNING', duck: { ...featherBase.duck, y: 280000, vy: 0 } };
const feathers = record('currency-feather-members-spawn-individually', featherState);
if (!feathers.state.collectibles.some(item => item.typeId === 'FEATHER' && item.id.endsWith('-0'))) throw new Error('feather group witness missing members');

const starBase = createRun(descriptor('currency-star-formation', 13));
const ordinal = 0;
const starState = { ...starBase, phase: 'RUNNING', nextStarPipeIndex: 1, starScheduleOrdinal: ordinal,
  duck: { ...starBase.duck, y: 280000, vy: 0 } };
const stars = record('currency-scheduled-star-members-spawn-individually', starState);
if (stars.state.collectibles.filter(item => item.typeId === 'GAME_STAR').length !== 5) throw new Error('five-member Star group missing');

const fixture = { fixtureRevision: 'currency-formations-1', simulationVersion: SIMULATION_VERSION,
  generatorVersion: GENERATOR_VERSION, configId: DEFAULT_CONFIG_ID, cases };
writeFileSync(new URL('./currency-formations-v1.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
console.log(JSON.stringify({ fixtureRevision: fixture.fixtureRevision, cases: cases.map(item => item.name) }));
