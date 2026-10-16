import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, configIdFor, createRun, createRunDescriptor, generateNext, makeInput, validateConfig,
  pauseRun, resumeRun, restartRun, step, worldSpeedAt,
} from '../src/index.js';
import type { RunState } from '../src/index.js';

const descriptor = createRunDescriptor({ runId: 'challenge-test', seed: 0x12345678 });

function blockAt(block: number, seed = descriptor.seed): RunState {
  const base = createRun(createRunDescriptor({ runId: descriptor.runId, seed }));
  return {
    ...base,
    config: { ...base.config, pipes: { ...base.config.pipes, horizon: 1_400_000 } },
    pipes: [], nextPipeIndex: block * 4,
  };
}

describe('stepped default challenges', () => {
  it('assigns four-pipe families deterministically by seeded block and marks each step', () => {
    const first = generateNext(blockAt(0)).state.pipes;
    const repeated = generateNext(blockAt(0)).state.pipes;
    expect(first).toEqual(repeated);
    expect(first).toHaveLength(4);
    expect(first.map(pipe => [pipe.challengeId, pipe.challengeStep])).toEqual([
      [first[0]!.challengeId, 0],
      [first[0]!.challengeId, 1],
      [first[0]!.challengeId, 2],
      [first[0]!.challengeId, 3],
    ]);
    expect(first[0]!.challengeId).toBe('intro-steady');
  });

  it('moves from intro through cruise and pressure, then inserts recovery after pressure', () => {
    const family = (block: number) => generateNext(blockAt(block)).state.pipes[0]!.challengeId;
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(family)).toMatchObject([
      'intro-steady', expect.stringMatching(/^cruise-/), expect.stringMatching(/^cruise-/),
      expect.stringMatching(/^pressure-/), 'recovery-steady',
      expect.stringMatching(/^pressure-/), 'recovery-steady',
      expect.stringMatching(/^pressure-/), 'recovery-steady',
    ]);
    const gaps = (block: number) => generateNext(blockAt(block)).state.pipes.map(pipe => pipe.gapCenter);
    expect(new Set(gaps(0)).size).toBe(1);
    expect(new Set(gaps(2)).size).toBeGreaterThan(1);
    expect(new Set(gaps(3)).size).toBeGreaterThan(2);
    expect(new Set(gaps(4)).size).toBe(1);
  });

  it('keeps repeated challenge families bounded for a long deterministic seed corpus', () => {
    for (const seed of [0, 1, 2, 3, 17, 999, 0xffffffff]) {
      const ids = Array.from({ length: 80 }, (_, block) =>
        generateNext(blockAt(block, seed)).state.pipes[0]!.challengeId,
      );
      for (let i = 2; i < ids.length; i++) {
        expect(ids[i] === ids[i - 1] && ids[i] === ids[i - 2]).toBe(false);
      }
    }
  });

  it('does not advance exposed challenges while paused and restarts from the seed schedule', () => {
    const initial = createRun(descriptor);
    const started = step(initial, [makeInput(0, 'FLAP')]).state;
    const paused = pauseRun(started);
    expect(step(paused, []).state).toBe(paused);
    expect(resumeRun(paused).pipes.map(pipe => pipe.challengeId)).toEqual(
      started.pipes.map(pipe => pipe.challengeId),
    );
    const restarted = restartRun(started, createRunDescriptor({ runId: 'challenge-restart', seed: descriptor.seed }));
    expect(restarted.pipes.map(pipe => pipe.challengeId)).toEqual(initial.pipes.map(pipe => pipe.challengeId));
  });

  it('lets custom configurations explicitly retain legacy gap-only generation', () => {
    const config = { ...DEFAULT_CONFIG, challenges: null };
    const customDescriptor = createRunDescriptor({ runId: 'legacy-custom', seed: 8 }, config);
    const pipes = createRun(customDescriptor, config).pipes;
    expect(pipes.every(pipe => pipe.challengeId === undefined)).toBe(true);
    const withoutChallenges = Object.fromEntries(
      Object.entries(DEFAULT_CONFIG).filter(([key]) => key !== 'challenges'),
    ) as Omit<typeof DEFAULT_CONFIG, 'challenges'>;
    expect(configIdFor(withoutChallenges)).toBe(configIdFor(config));
    expect(configIdFor(config)).not.toBe(configIdFor(DEFAULT_CONFIG));
  });

  it('validates challenge families and freezes defensive config copies', () => {
    const family = DEFAULT_CONFIG.challenges!.families.find(item => item.id === 'pressure-rise')!;
    expect(() => validateConfig({ ...DEFAULT_CONFIG, challenges: {
      ...DEFAULT_CONFIG.challenges!, families: DEFAULT_CONFIG.challenges!.families.map(item =>
        item.id === family.id ? { ...item, gapCenters: [100000, 100000, 100000, 100000] } : item,
      ),
    } })).toThrow(/challenge/i);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, challenges: {
      ...DEFAULT_CONFIG.challenges!, families: DEFAULT_CONFIG.challenges!.families.map(item =>
        item.id === 'intro-steady' ? { ...item, id: '   ' } : item,
      ),
    } })).toThrow(/challenge/i);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, challenges: {
      ...DEFAULT_CONFIG.challenges!, families: DEFAULT_CONFIG.challenges!.families.map(item =>
        item.id === 'intro-steady' ? { ...item, gapCenters: [320000, 280000, 280000, 280000] } : item,
      ),
    } })).toThrow(/intro/i);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, challenges: {
      ...DEFAULT_CONFIG.challenges!, families: DEFAULT_CONFIG.challenges!.families.map(item =>
        item.id === 'recovery-steady' ? { ...item, gapCenters: [280000, 240000, 200000, 190000] } : item,
      ),
    } })).toThrow(/boundary/i);
    const input = { ...DEFAULT_CONFIG, challenges: {
      ...DEFAULT_CONFIG.challenges!, families: DEFAULT_CONFIG.challenges!.families.map(item => ({ ...item, gapCenters: [...item.gapCenters] })),
    } };
    const run = createRun(createRunDescriptor({ runId: 'copy-check', seed: 2 }, input), input);
    input.challenges!.families[0]!.gapCenters[0] = 1;
    expect(run.config.challenges!.families[0]!.gapCenters[0]).toBe(280000);
  });

  it('requires pressure families to leave no single safe duck lane for the whole tier', () => {
    const pressure = DEFAULT_CONFIG.challenges!.families.filter(family => family.band === 'pressure');
    const centers = pressure.flatMap(family => family.gapCenters);
    const safeMargin = DEFAULT_CONFIG.pipes.gapHeight / 2 - DEFAULT_CONFIG.flight.duckHalfHeight;
    expect(Math.min(...centers) + safeMargin).toBeLessThan(Math.max(...centers) - safeMargin);
  });

  it('traverses every selectable family transition from a bounded boundary-state envelope', () => {
    const observationX = 360000;
    const collisionEntryX = 138000;
    const speedCap = 4800;
    const heldLaneTicks = 18;
    expect(worldSpeedAt(DEFAULT_CONFIG, 2701)).toBe(speedCap);
    expect((observationX - collisionEntryX) / speedCap).toBe(46.25);
    expect(heldLaneTicks).toBeLessThan((observationX - collisionEntryX) / speedCap);
    const set = DEFAULT_CONFIG.challenges!;
    const families = new Map(set.families.map(family => [family.id, family]));
    const cruise = set.cruiseFamilyIds;
    const edges: [string, string][] = [];
    for (const id of cruise) edges.push([set.introFamilyId, id]);
    for (let i = 0; i < cruise.length; i++) {
      edges.push([cruise[i]!, cruise[(i + 1) % cruise.length]!]);
      for (const pressure of set.pressureFamilyIds) edges.push([cruise[i]!, pressure]);
    }
    for (const pressure of set.pressureFamilyIds) edges.push([pressure, set.recoveryFamilyId]);
    for (const pressure of set.pressureFamilyIds) edges.push([set.recoveryFamilyId, pressure]);
    expect(edges).toHaveLength(26);

    for (const [fromId, toId] of edges) for (const offset of [-5000, 0, 5000]) for (const vy of [-500, 0, 500]) {
      const initial = createRun(descriptor);
      const target = families.get(toId)!;
      let state: RunState = {
        ...initial,
        phase: 'RUNNING', tick: 2700,
        duck: { ...initial.duck, y: families.get(fromId)!.gapCenters[3]! + offset, vy },
        pipes: Array.from({ length: 8 }, (_, i) => ({
          id: `witness-${i}`, index: i, x: 360000 + i * DEFAULT_CONFIG.pipes.spacing,
          gapCenter: i < 4 ? target.gapCenters[i]! : 280000, scored: false,
        })),
        nextPipeIndex: 8, lastGapCenter: 280000, nextSpawnPipeIndex: 8,
      };
      let sequence = 0;
      for (let tick = 0; tick < 1000 && state.score < 4 && state.phase !== 'DEAD'; tick++) {
        const nextTick = state.tick + 1;
        const activePipe = state.pipes.find(pipe => pipe.x >= state.duck.x) ?? state.pipes.at(-1)!;
        const targetY = nextTick <= 2718 ? families.get(fromId)!.gapCenters[3]! : activePipe.gapCenter;
        const frames = state.duck.y > targetY + 24000 ? [makeInput(sequence++, 'FLAP')] : [];
        state = step(state, frames).state;
      }
      expect(state.score, `${fromId} -> ${toId}, yOffset=${offset}, vy=${vy}, phase=${state.phase}`).toBe(4);
    }
  });

  it('covers default challenge transitions in a 64-seed, 5000-tick physics corpus', () => {
    const transitions = new Set<string>();
    let survived = 0;
    for (let seed = 0; seed < 64; seed++) {
      let state = createRun(createRunDescriptor({ runId: `challenge-corpus-${seed}`, seed }));
      let sequence = 0;
      let previousFamily = '';
      let observedTarget = 280000;
      const runTransitions = new Set<string>();
      for (let tick = 0; tick < 5000 && state.phase !== 'DEAD'; tick++) {
        const pipe = state.pipes.find(item => item.x >= state.duck.x) ?? state.pipes.at(-1)!;
        if (pipe.x <= 360000) observedTarget = pipe.gapCenter;
        if (pipe.challengeId && pipe.challengeId !== previousFamily) {
          if (previousFamily) runTransitions.add(`${previousFamily}>${pipe.challengeId}`);
          previousFamily = pipe.challengeId;
        }
        const frames = state.phase === 'READY' || state.duck.y > observedTarget + 24000
          ? [makeInput(sequence++, 'FLAP')] : [];
        state = step(state, frames).state;
      }
      if (state.phase !== 'DEAD') {
        survived++;
        for (const transition of runTransitions) transitions.add(transition);
      }
    }
    expect(survived).toBe(64);
    expect(transitions.size).toBe(26);
  });
});
