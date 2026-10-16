// Reviewed-fixture producer: run only after inspecting a deliberate rule change.
// Existing fixtures are checked by tests; regeneration is never an automatic test step.
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, PATTERN_CATALOG, configIdFor, createRunDescriptor, createRun, step, pauseRun, resumeRun, restartRun, makeInput, canonicalState, mix32, worldSpeedAt } from '../../packages/game-sim/dist/index.js';
const descriptor = (name, seed = 1, config = DEFAULT_CONFIG) => createRunDescriptor({ runId: name, seed }, config);
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
assert.equal(lifecycle.state.duck.y, 275220);
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
const witnessConfig = { ...DEFAULT_CONFIG, challenges: null, flight: { ...DEFAULT_CONFIG.flight, gravity: 1, flapVelocity: -11, maxFallSpeed: 100 }, pipes: { ...DEFAULT_CONFIG.pipes, maxSpeed: 5800, spacing: 225000, gapHeight: 300000, gapMinCenter: 230000, gapMaxCenter: 330000, maxGapDelta: 30000 } };
const long = scenario('custom-bounded-long-run', witnessConfig, 3);
long.control(219); long.control(781); long.control(23000);
assert.equal(long.state.tick, 24000); assert.ok(long.state.score > 100);
assert.equal(configIdFor(DEFAULT_CONFIG), 'dd-v1-stepped-v1');
const traversal = scenario('default-challenge-traversal', DEFAULT_CONFIG, 0);
const observedBands = new Set();
let observedTarget = 280000;
for (let segment = 0; segment < 10; segment++) {
  let temporary = traversal.state;
  const flapTicks = [];
  for (let tick = 1; tick <= 500; tick++) {
    const pipe = temporary.pipes.find(item => item.x >= temporary.duck.x) ?? temporary.pipes.at(-1);
    if (pipe.challengeId) observedBands.add(DEFAULT_CONFIG.challenges.families.find(family => family.id === pipe.challengeId).band);
    if (pipe.x <= 360000) observedTarget = pipe.gapCenter;
    const flap = temporary.phase === 'READY' || temporary.duck.y > observedTarget + 24000;
    if (flap) flapTicks.push(tick);
    temporary = step(temporary, flap ? [makeInput(temporary.nextInputSequence, 'FLAP')] : []).state;
    assert.equal(temporary.phase, 'RUNNING');
  }
  traversal.apply({ kind: 'advance', ticks: 500, flapTicks });
}
assert.deepEqual([...observedBands].sort(), ['cruise', 'intro', 'pressure', 'recovery']);
assert.equal(traversal.state.tick, 5000);
assert.ok(traversal.state.nextPipeIndex > DEFAULT_CONFIG.limits.maxActivePipes, 'default trace should exercise horizon refill');
assert.ok(traversal.state.pipes.every(pipe => pipe.challengeId && Number.isInteger(pipe.challengeStep)), 'default trace pipes carry challenge metadata');
const speedMiddle = scenario('speed-midpoint', DEFAULT_CONFIG, 1, s => ({
  ...s, phase: 'RUNNING', tick: 2699, nextPipeIndex: 91, nextSpawnPipeIndex: 91,
  duck: { ...s.duck, y: 280000, vy: 0 },
  pipes: [{ id: 'speed-pipe', index: 90, x: 800000, gapCenter: 280000, scored: false }],
  collectibles: [{ id: 'speed-pickup', typeId: 'FEATHER', x: 800000, y: 280000, amount: 1, radius: 7000, collected: false }]
}));
speedMiddle.apply({ kind: 'step', frames: [] });
assert.equal(speedMiddle.state.pipes.find(p => p.id === 'speed-pipe').x, 795201);
assert.equal(speedMiddle.state.collectibles.find(c => c.id === 'speed-pickup').x, 795201);
speedMiddle.apply({ kind: 'pause' }); speedMiddle.apply({ kind: 'step', frames: [] }); speedMiddle.apply({ kind: 'resume' });
const speedCap = scenario('speed-cap-boundary', DEFAULT_CONFIG, 1, s => ({
  ...s, phase: 'RUNNING', tick: 5399, nextPipeIndex: 91, nextSpawnPipeIndex: 91,
  duck: { ...s.duck, y: 280000, vy: 0 },
  pipes: [{ id: 'speed-pipe', index: 90, x: 800000, gapCenter: 280000, scored: false }],
  collectibles: [{ id: 'speed-pickup', typeId: 'FEATHER', x: 800000, y: 280000, amount: 1, radius: 7000, collected: false }]
}));
speedCap.apply({ kind: 'step', frames: [] });
assert.equal(speedCap.state.pipes.find(p => p.id === 'speed-pipe').x, 795200);
const speedCapped = scenario('speed-capped', DEFAULT_CONFIG, 1, s => ({ ...s, phase: 'RUNNING', tick: 5400, nextPipeIndex: 91, nextSpawnPipeIndex: 91, duck: { ...s.duck, y: 280000, vy: 0 }, pipes: [{ id: 'speed-pipe', index: 90, x: 800000, gapCenter: 280000, scored: false }] }));
speedCapped.apply({ kind: 'step', frames: [] });
assert.equal(speedCapped.state.pipes.find(p => p.id === 'speed-pipe').x, 795200);
const requiredTravel = DEFAULT_CONFIG.pipes.safeLeadIn - Math.floor(DEFAULT_CONFIG.pipes.width / 2) - DEFAULT_CONFIG.flight.duckX - DEFAULT_CONFIG.flight.duckHalfWidth;
let firstPipeContactTick = 0, traveled = 0;
while (traveled < requiredTravel) { firstPipeContactTick++; traveled += worldSpeedAt(DEFAULT_CONFIG, firstPipeContactTick); }
const base = createRun(descriptor('invalid-base'));
const fixture = {
  contractVersion: '1.3.0', fixtureRevision: 'stepped-challenges-1',
  rules: { numericUnit: 'millipixel', ticksPerSecond: 60, inputTick: 'Each step call advances one tick; frames are applied on that tick; input sequence contiguous; multiple FLAPs in one call apply one impulse.', speed: 'For one-based active tick t, base=speed+floor((maxSpeed-speed)*clamp(t-1,0,rampTicks)/rampTicks); add floor(speed*floor(score/speedEveryPipes)*speedStepPercent/100), capped at maxSpeed. A score earned during this step affects the following step.', canonical: 'Recursively sorted ASCII object keys; arrays preserve order; safe integers only; challenge metadata is included on generated default pipes and challenges:null is canonicalized as explicit null.', generation: { firstPipeX: DEFAULT_CONFIG.pipes.safeLeadIn, spacing: DEFAULT_CONFIG.pipes.spacing, gapSelection: 'center_i is clamp(raw_i, previousGap +/- maxGapDelta, configured bounds); legacy custom rules use seeded independent fmix32 samples. Default rules select four-pipe authored families by pipe index: intro block 0; seeded adjacent cruise families in blocks 1-2; then independently seeded pressure block 3, recovery block 4, alternating pressure/recovery indefinitely. Family selection does not consume the collectible RNG. Default challenge families: intro-steady [280,280,280,280]k; cruise-steady [280,280,280,280]k, cruise-rise [265,275,290,305]k, cruise-dip [295,285,270,255]k, cruise-offset [300,300,270,270]k; pressure-rise [280,230,190,270]k, pressure-dip [280,320,350,280]k, pressure-offset [280,330,300,220]k; recovery-steady [280,280,280,280]k. Shared gap height 156000 and spacing 300000; every selectable family boundary is validated against maxGapDelta 85000 and is not silently clamped.', cursor: 'rng cursor advances by uint32(0x9e3779b9) for each generated pipe and each evaluated spawn opportunity, including NONE and capacity suppression' }, spawn: 'Filter eligibility/spacing, cumulative half-open NONE-first buckets; total zero after filtering means NONE; one opportunity per pipe. Existing items move once; newly spawned items stay aligned with their post-movement pipe. Capacity suppresses spawn without retry.', ordering: 'input/integration/world move; lethal collision; if alive score ordered pipes; generate; spawn opportunities in pipe order; collect in stored array order; cleanup. Lethal tick does not move/collect items or generate.', configIdentity: 'dd-v1-stepped-v1 iff config content equals current DEFAULT_CONFIG. Otherwise dd-v1-config: followed by canonical JSON of {configuration,patterns}. No hash collision and no implicit historical registry. A null or omitted custom challenge set retains legacy seeded gap-only generation.', limits: 'Counter increments checked before Number.MAX_SAFE_INTEGER-1. Object window stays local; no accumulated distance coordinate. Unsupported custom configs are experiments, not guaranteed reachable.' },
  defaultConfig: DEFAULT_CONFIG, patternCatalog: PATTERN_CATALOG,
  mixerVectors: [0,1,305419896,4294967295].map(input => ({ input, output: mix32(input) })),
  reactionEvidence: { observedPipeCenter: 360000, collisionEntryX: 138000, speedCap: 4800, geometricLeadTicks: (360000 - 138000) / 4800, controllerHeldPreviousLaneTicks: 18, ticksPerSecond: 60, evidence: 'All 26 selectable family edges crossed with real Step physics at prior-exit entry states y offsets -5000/0/5000 and vertical velocities -500/0/500 after holding the previous lane for 18 ticks. A separate 64-seed, 5000-tick controller corpus survives and observes all 26 edges. This is bounded controller-specific evidence, not a universal or human latest-action guarantee; playtest acceptance remains open.' },
  reachabilityWitness: { controller: 'bounded custom-physics long-run controller only; not a default-feasibility claim', firstPipeContactTick, firstPipeContactTravel: traveled, testedLongRunTicks: 24000, note: 'Default gaps vary and require active steering; custom witness does not prove default or arbitrary-config reachability.' },
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
console.log(JSON.stringify({ cases: cases.length, longRunTicks:long.state.tick, longRunScore:long.state.score, firstPipeContactTick, fixtureRevision:fixture.fixtureRevision }));
