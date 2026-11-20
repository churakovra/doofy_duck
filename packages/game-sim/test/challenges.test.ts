import { describe, expect, it } from 'vitest';
import {
  PRIOR_DEFAULT_CONFIG, configIdFor, createRun, createRunDescriptor, generateNext, makeInput, validateConfig,
  pauseRun, resumeRun, restartRun, step,
} from '../src/index.js';
import type { RunState } from '../src/index.js';

const descriptor = createRunDescriptor({ runId: 'challenge-test', seed: 0x12345678 }, PRIOR_DEFAULT_CONFIG);

function blockAt(block: number, seed = descriptor.seed): RunState {
  const base = createRun(createRunDescriptor({ runId: descriptor.runId, seed }, PRIOR_DEFAULT_CONFIG), PRIOR_DEFAULT_CONFIG);
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
    const restarted = restartRun(started, createRunDescriptor({ runId: 'challenge-restart', seed: descriptor.seed }, PRIOR_DEFAULT_CONFIG));
    expect(restarted.pipes.map(pipe => pipe.challengeId)).toEqual(initial.pipes.map(pipe => pipe.challengeId));
  });

  it('lets custom configurations explicitly retain legacy gap-only generation', () => {
    const config = { ...PRIOR_DEFAULT_CONFIG, challenges: null };
    const customDescriptor = createRunDescriptor({ runId: 'legacy-custom', seed: 8 }, config);
    const pipes = createRun(customDescriptor, config).pipes;
    expect(pipes.every(pipe => pipe.challengeId === undefined)).toBe(true);
    const withoutChallenges = Object.fromEntries(
      Object.entries(PRIOR_DEFAULT_CONFIG).filter(([key]) => key !== 'challenges'),
    ) as Omit<typeof PRIOR_DEFAULT_CONFIG, 'challenges'>;
    expect(configIdFor(withoutChallenges)).toBe(configIdFor(config));
    expect(configIdFor(config)).not.toBe(configIdFor(PRIOR_DEFAULT_CONFIG));
  });

  it('validates challenge families and freezes defensive config copies', () => {
    const family = PRIOR_DEFAULT_CONFIG.challenges!.families.find(item => item.id === 'pressure-rise')!;
    expect(() => validateConfig({ ...PRIOR_DEFAULT_CONFIG, challenges: {
      ...PRIOR_DEFAULT_CONFIG.challenges!, families: PRIOR_DEFAULT_CONFIG.challenges!.families.map(item =>
        item.id === family.id ? { ...item, gapCenters: [100000, 100000, 100000, 100000] } : item,
      ),
    } })).toThrow(/challenge/i);
    expect(() => validateConfig({ ...PRIOR_DEFAULT_CONFIG, challenges: {
      ...PRIOR_DEFAULT_CONFIG.challenges!, families: PRIOR_DEFAULT_CONFIG.challenges!.families.map(item =>
        item.id === 'intro-steady' ? { ...item, id: '   ' } : item,
      ),
    } })).toThrow(/challenge/i);
    expect(() => validateConfig({ ...PRIOR_DEFAULT_CONFIG, challenges: {
      ...PRIOR_DEFAULT_CONFIG.challenges!, families: PRIOR_DEFAULT_CONFIG.challenges!.families.map(item =>
        item.id === 'intro-steady' ? { ...item, gapCenters: [320000, 280000, 280000, 280000] } : item,
      ),
    } })).toThrow(/intro/i);
    expect(() => validateConfig({ ...PRIOR_DEFAULT_CONFIG, challenges: {
      ...PRIOR_DEFAULT_CONFIG.challenges!, families: PRIOR_DEFAULT_CONFIG.challenges!.families.map(item =>
        item.id === 'recovery-steady' ? { ...item, gapCenters: [280000, 240000, 200000, 190000] } : item,
      ),
    } })).toThrow(/boundary/i);
    const input = { ...PRIOR_DEFAULT_CONFIG, challenges: {
      ...PRIOR_DEFAULT_CONFIG.challenges!, families: PRIOR_DEFAULT_CONFIG.challenges!.families.map(item => ({ ...item, gapCenters: [...item.gapCenters] })),
    } };
    const run = createRun(createRunDescriptor({ runId: 'copy-check', seed: 2 }, input), input);
    input.challenges!.families[0]!.gapCenters[0] = 1;
    expect(run.config.challenges!.families[0]!.gapCenters[0]).toBe(280000);
  });

  it('requires pressure families to leave no single safe duck lane for the whole tier', () => {
    const pressure = PRIOR_DEFAULT_CONFIG.challenges!.families.filter(family => family.band === 'pressure');
    const centers = pressure.flatMap(family => family.gapCenters);
    const safeMargin = PRIOR_DEFAULT_CONFIG.pipes.gapHeight / 2 - PRIOR_DEFAULT_CONFIG.flight.duckHalfHeight;
    expect(Math.min(...centers) + safeMargin).toBeLessThan(Math.max(...centers) - safeMargin);
  });

});
