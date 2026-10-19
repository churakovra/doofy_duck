// Explicit producer for the catalog-3 paired-route trace. Run after build:sim,
// inspect the authored scenarios, and never invoke this from a test command.
import { writeFileSync } from 'node:fs';
const simulationModule = process.env.DUCK_SIM_MODULE ?? new URL('../../packages/game-sim/dist/index.js', import.meta.url).href;
const { DEFAULT_CONFIG, SIMULATION_VERSION, GENERATOR_VERSION, DEFAULT_CONFIG_ID,
  canonicalState, createRun, createRunDescriptor, makeInput, step } = await import(simulationModule);

const snapshot = state => JSON.parse(canonicalState(state));
const descriptor = (runId, seed) => createRunDescriptor({ runId, seed }, DEFAULT_CONFIG);
const cases = [];
function record(name, state, frames) {
  const result = step(state, frames);
  cases.push({ name, syntheticInitialState: state.tick !== 0 || state.phase !== 'READY',
    initialState: snapshot(state), operations: [{ kind: 'step', frames, expectedState: snapshot(result.state), expectedEvents: [...result.events] }] });
  return result;
}
const ready = createRun(descriptor('paired-ready-start', 7));
record('paired-ready-starts-on-first-flap', ready, [makeInput(0, 'FLAP')]);

const scoreBase = createRun(descriptor('paired-score-once', 11));
const firstPipe = scoreBase.pipes[0];
const scoreState = { ...scoreBase, phase: 'RUNNING', duck: { ...scoreBase.duck, y: 280000, vy: 0 },
  pipes: [{ ...firstPipe, x: 60000, scored: false }] };
const scored = record('paired-station-scores-once', scoreState, []);
if (scored.state.score !== 1 || scored.events[0]?.type !== 'ObstaclePassed') throw new Error('score witness did not pass exactly one paired station');

const fatalBase = createRun(descriptor('paired-fatal-suppresses-pickup', 13));
const fatalY = fatalBase.config.pipes.ceilingY + fatalBase.config.flight.duckHalfHeight + 100;
const fatalState = { ...fatalBase, phase: 'RUNNING', duck: { ...fatalBase.duck, y: fatalY, vy: -500 }, pipes: [],
  collectibles: [{ id: 'fatal-feather', typeId: 'FEATHER', x: fatalBase.config.flight.duckX + fatalBase.config.pipes.speed,
    y: fatalY - 180, amount: 1, radius: 7000, collected: false }] };
const died = record('paired-fatal-tick-suppresses-pickup', fatalState, []);
if (died.state.phase !== 'DEAD' || died.state.totals.FEATHER !== undefined) throw new Error('fatal tick collected a pickup');

const fixture = { fixtureRevision: 'wetland-paired-stations-1', simulationVersion: SIMULATION_VERSION,
  generatorVersion: GENERATOR_VERSION, configId: DEFAULT_CONFIG_ID, cases };
writeFileSync(new URL('./wetland-v3.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
console.log(JSON.stringify({ fixtureRevision: fixture.fixtureRevision, cases: cases.map(item => item.name) }));
