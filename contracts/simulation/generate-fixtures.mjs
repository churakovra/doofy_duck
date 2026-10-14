// Reviewed-fixture producer: run only after inspecting a deliberate rule change.
// Existing fixtures are checked by tests; regeneration is never an automatic test step.
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, PATTERN_CATALOG, createRun, step, pauseRun, resumeRun, restartRun, makeInput, configIdFor, canonicalState, mix32 } from '../../packages/game-sim/dist/index.js';
const descriptor = (name, seed = 1, config = DEFAULT_CONFIG) => ({ runId: name, seed, simulationVersion: '1.0.0', generatorVersion: '1.0.0', configId: configIdFor(config) });
const snapshot = s => JSON.parse(canonicalState(s));
const cases = [];
function scenario(name, config = DEFAULT_CONFIG, seed = 1, alter) {
  let state = createRun(descriptor(name, seed, config), config);
  if (alter) state = alter(state);
  const entry = { name, syntheticInitialState: Boolean(alter), initialState: snapshot(state), operations: [] };
  cases.push(entry);
  const apply = operation => {
    let events = [];
    if (operation.kind === 'step') { const r = step(state, operation.frames); state = r.state; events = [...r.events]; }
    if (operation.kind === 'pause') state = pauseRun(state);
    if (operation.kind === 'resume') state = resumeRun(state);
    if (operation.kind === 'restart') state = restartRun(state, operation.descriptor);
    if (operation.kind === 'advance') {
      const ticks = new Set(operation.flapTicks);
      for (let t = 1; t <= operation.ticks; t++) {
        const r = step(state, ticks.has(t) ? [makeInput(state.nextInputSequence, 'FLAP')] : []);
        state = r.state; events.push(...r.events);
      }
    }
    entry.operations.push({ ...operation, expectedState: snapshot(state), expectedEvents: events });
    return state;
  };
  return { apply, get state() { return state; },
    control(ticks) {
      const flapTicks = [];
      let temporary = state;
      for (let t = 1; t <= ticks; t++) {
        const flap = temporary.phase === 'READY' || (temporary.duck.y >= 333000 && temporary.duck.vy > 0);
        if (flap) flapTicks.push(t);
        temporary = step(temporary, flap ? [makeInput(temporary.nextInputSequence, 'FLAP')] : []).state;
        assert.equal(temporary.phase, 'RUNNING');
      }
      const result = apply({ kind: 'advance', ticks, flapTicks });
      assert.deepEqual(snapshot(result), snapshot(temporary));
      return result;
    }
  };
}
const lifecycle = scenario('lifecycle');
lifecycle.apply({ kind: 'step', frames: [makeInput(0, 'FLAP')] });
assert.equal(lifecycle.state.duck.y, 285880);
for (let i = 0; i < 3; i++) lifecycle.apply({ kind: 'step', frames: [] });
lifecycle.apply({ kind: 'pause' }); lifecycle.apply({ kind: 'step', frames: [] });
lifecycle.apply({ kind: 'resume' }); lifecycle.apply({ kind: 'step', frames: [makeInput(1, 'FLAP')] });
lifecycle.apply({ kind: 'restart', descriptor: descriptor('lifecycle-restarted', 7) });
assert.equal(lifecycle.state.tick, 0);
const dead = scenario('terminal-death');
dead.apply({ kind: 'advance', ticks: 200, flapTicks: [1] });
assert.equal(dead.state.phase, 'DEAD');
dead.apply({ kind: 'step', frames: [makeInput(dead.state.nextInputSequence, 'FLAP')] });
const score = scenario('score-edge', DEFAULT_CONFIG, 2, s => ({ ...s, phase: 'RUNNING', pipes: [{ id: 'edge-pipe', index: 0, x: s.duck.x - s.config.flight.duckHalfWidth - Math.floor(s.config.pipes.width / 2) + s.config.pipes.speed, gapCenter: 280000, scored: false }] }));
score.apply({ kind: 'step', frames: [] }); assert.equal(score.state.score, 0);
score.apply({ kind: 'step', frames: [] }); assert.equal(score.state.score, 1);
score.apply({ kind: 'step', frames: [] }); assert.equal(score.state.score, 1);
const lethal = scenario('lethal-suppresses-score-and-pickup', DEFAULT_CONFIG, 3, s => ({ ...s, phase: 'RUNNING', duck: { ...s.duck, y: s.config.pipes.floorY - s.config.flight.duckHalfHeight - 1, vy: 1000 }, pipes: [{ id: 'past-pipe', index: 0, x: 0, gapCenter: 280000, scored: false }], collectibles: [{ id: 'lethal-item', typeId: 'FEATHER', x: s.duck.x + s.config.pipes.speed, y: s.config.pipes.floorY - s.config.flight.duckHalfHeight, amount: 1, radius: 7000, collected: false }] }));
lethal.apply({ kind: 'step', frames: [] }); assert.equal(lethal.state.phase, 'DEAD'); assert.equal(lethal.state.score, 0); assert.deepEqual(lethal.state.totals, {});
const pickup = scenario('once-only-pickups', DEFAULT_CONFIG, 4, s => ({ ...s, phase: 'RUNNING', collectibles: ['FEATHER', 'GAME_STAR'].map((typeId, i) => ({ id: `test-item-${i}`, typeId, x: s.duck.x + s.config.pipes.speed, y: s.duck.y, amount: i + 1, radius: 7000, collected: false })) }));
pickup.apply({ kind: 'step', frames: [] }); assert.deepEqual(pickup.state.totals, { FEATHER: 1, GAME_STAR: 2 });
pickup.apply({ kind: 'step', frames: [] }); assert.deepEqual(pickup.state.totals, { FEATHER: 1, GAME_STAR: 2 });
const noneConfig = { ...DEFAULT_CONFIG, spawnNoneWeight: 4294967273 };
const none = scenario('none-bucket', noneConfig);
none.apply({ kind: 'step', frames: [makeInput(0, 'FLAP')] }); assert.equal(none.state.collectibles.length, 0);
none.apply({ kind: 'step', frames: [] });
const disabled = scenario('disabled-currencies', { ...DEFAULT_CONFIG, collectibles: DEFAULT_CONFIG.collectibles.map(d => ({ ...d, weight: 0 })) });
disabled.apply({ kind: 'step', frames: [makeInput(0, 'FLAP')] }); assert.equal(disabled.state.collectibles.length, 0);
const ineligible = scenario('temporarily-ineligible', { ...DEFAULT_CONFIG, spawnNoneWeight: 0, collectibles: [{ ...DEFAULT_CONFIG.collectibles[1], minPipeIndex: 100 }] });
ineligible.apply({ kind: 'step', frames: [makeInput(0, 'FLAP')] }); assert.equal(ineligible.state.collectibles.length, 0);
const long = scenario('default-long-run', DEFAULT_CONFIG, 3);
long.control(219); long.control(781); long.control(23000);
assert.equal(long.state.tick, 24000); assert.ok(long.state.score > 100);
const base = createRun(descriptor('invalid-base'));
const fixture = {
  contractVersion: '1.0.0', fixtureRevision: 'foundation-2',
  rules: { numericUnit: 'millipixel', ticksPerSecond: 60, inputTick: 'Each step call advances one tick; frames are applied on that tick; input sequence contiguous; multiple FLAPs in one call apply one impulse.', canonical: 'Recursively sorted ASCII object keys; arrays preserve order; safe integers only; no absent or null runtime fields.', generation: { firstPipeX: DEFAULT_CONFIG.pipes.safeLeadIn, spacing: DEFAULT_CONFIG.pipes.spacing, patternBlockSize: 4, patternSelection: 'fmix32(uint32(seed XOR imul(floor(pipeIndex/4)+1,0x9e3779b9))) modulo catalog length; index modulo 4 selects gap', cursor: 'rng cursor advances by uint32(0x9e3779b9) for each generated pipe, and once per evaluated pipe index >=2 spawn opportunity, including NONE and capacity suppression' }, spawn: 'Filter eligibility/spacing, cumulative half-open NONE-first buckets; total zero after filtering means NONE; one opportunity per pipe. Existing items move once; newly spawned items stay aligned with their post-movement pipe. Capacity suppresses spawn without retry.', ordering: 'input/integration/world move; lethal collision; if alive score ordered pipes; generate; spawn opportunities in pipe order; collect in stored array order; cleanup. Lethal tick does not move/collect items or generate.', configIdentity: 'dd-v1-default iff config content equals current DEFAULT_CONFIG. Otherwise dd-v1-config: followed by canonical JSON of {configuration,patterns}. No hash collision and no implicit historical registry. Pre-release fixture replaces obsolete never-released tuning.', limits: 'Counter increments checked before Number.MAX_SAFE_INTEGER-1. Object window stays local; no accumulated distance coordinate. Unsupported configs are experiments, not guaranteed reachable.' },
  defaultConfig: DEFAULT_CONFIG, patternCatalog: PATTERN_CATALOG,
  mixerVectors: [0,1,305419896,4294967295].map(input => ({ input, output: mix32(input) })),
  reachabilityWitness: { controller: 'first tick FLAP; thereafter FLAP when previous y>=333000 and vy>0', firstPipeContactTick: 93, commonSafeCenterIntervalExclusive: [222000,338000], observedOrbitYRange: [227440,335600], cycleStartTick:115, cycleEndTick:219, cyclePeriod:104, testedLongRunTicks:24000, note:'Closed vertical orbit lies strictly inside every supported default gap; establishes a default-physics surviving strategy across arbitrary catalog transitions, not all player states or custom configs.' },
  cases,
  invalidCases: [
    { name:'unsupported-simulation', kind:'create', descriptor:{ ...base.descriptor, simulationVersion:'99.0.0' }, config:DEFAULT_CONFIG },
    { name:'negative-seed', kind:'create', descriptor:{ ...base.descriptor, seed:-1 }, config:DEFAULT_CONFIG },
    { name:'config-mismatch', kind:'create', descriptor:base.descriptor, config:{ ...DEFAULT_CONFIG, flight:{ ...DEFAULT_CONFIG.flight, gravity:81 } } },
    { name:'sequence-gap', kind:'step', initialState:snapshot(base), frames:[makeInput(2,'FLAP')] },
    { name:'tick-overflow', kind:'step', initialState:{ ...snapshot(base), phase:'RUNNING', tick:Number.MAX_SAFE_INTEGER }, frames:[] }
  ]
};
writeFileSync(new URL('./golden-v1.json', import.meta.url), JSON.stringify(fixture, null, 2)+'\n');
console.log(JSON.stringify({ cases: cases.length, longRunTicks:long.state.tick, longRunScore:long.state.score, fixtureRevision:fixture.fixtureRevision }));
