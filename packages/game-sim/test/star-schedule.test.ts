import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PRIOR_DEFAULT_CONFIG, LEGACY_DEFAULT_CONFIG, canonicalState, configIdFor, createRun, createRunDescriptor,
  makeInput, pauseRun, resumeRun, step,
} from '../src/index.js';
import type { RunState } from '../src/index.js';
import { bonusY } from '../src/generation.js';

const authoredSchedule = JSON.parse(readFileSync('contracts/simulation/star-schedule-v1.json', 'utf8')) as {
  schedule: { minIntervalPipes: number; maxIntervalPipes: number; amount: number };
  cases: { seed: number; firstStarPipeIndex: number; nextStarPipeIndex: number }[];
};
const legacyFixture = JSON.parse(readFileSync('contracts/simulation/golden-v1.json', 'utf8')) as {
  cases: { initialState: RunState }[];
};

describe('scheduled game Stars', () => {
  it('matches the independently authored TS/Go schedule vectors', () => {
    for (const example of authoredSchedule.cases) {
      const descriptor = createRunDescriptor({ runId: `star-vector-${example.seed}`, seed: example.seed }, PRIOR_DEFAULT_CONFIG);
      const initial = createRun(descriptor);
      expect(initial.nextStarPipeIndex).toBe(example.firstStarPipeIndex);
      const pipe = { id: `pipe-${example.firstStarPipeIndex}`, index: example.firstStarPipeIndex, x: 900_000, gapCenter: 280_000, scored: false };
      const state = step({ ...initial, phase: 'RUNNING', pipes: [pipe], nextSpawnPipeIndex: pipe.index }, []).state;
      expect(state.nextStarPipeIndex).toBe(example.nextStarPipeIndex);
      expect(state.collectibles.find(item => item.typeId === 'GAME_STAR')?.amount).toBe(authoredSchedule.schedule.amount);
    }
  });

  it('schedules the first and later Stars at seeded inclusive 8–16 pipe intervals', () => {
    const firstIntervals = new Set<number>();
    const laterIntervals = new Set<number>();
    for (let seed = 0; seed < 64; seed++) {
      const descriptor = createRunDescriptor({ runId: `star-${seed}`, seed }, PRIOR_DEFAULT_CONFIG);
      const initial = createRun(descriptor);
      const first = initial.nextStarPipeIndex!;
      firstIntervals.add(first);
      expect(first).toBeGreaterThanOrEqual(8);
      expect(first).toBeLessThanOrEqual(16);

      const targetPipe = {
        id: `pipe-${first}`, index: first, x: 900_000, gapCenter: 280_000, scored: false,
      };
      const scheduled = step({
        ...initial, phase: 'RUNNING', pipes: [targetPipe], nextSpawnPipeIndex: first,
      }, []).state;
      const gap = scheduled.nextStarPipeIndex! - first;
      laterIntervals.add(gap);
      expect(gap).toBeGreaterThanOrEqual(8);
      expect(gap).toBeLessThanOrEqual(16);
      expect(scheduled.collectibles.some(item => item.id === `star-${first}` && item.typeId === 'GAME_STAR')).toBe(true);
    }
    expect(firstIntervals).toContain(8);
    expect(firstIntervals).toContain(16);
    expect(laterIntervals).toContain(8);
    expect(laterIntervals).toContain(16);
  });

  it('keeps the seeded schedule across pause/resume and repeated replay', () => {
    const descriptor = createRunDescriptor({ runId: 'star-pause', seed: 981 }, PRIOR_DEFAULT_CONFIG);
    const initial = createRun(descriptor);
    const paused = pauseRun({ ...initial, phase: 'RUNNING' });
    const resumed = resumeRun(paused);
    expect(resumed.nextStarPipeIndex).toBe(initial.nextStarPipeIndex);
    expect(step(resumed, [makeInput(0, 'FLAP')])).toEqual(step(resumeRun(pauseRun({ ...createRun(descriptor), phase: 'RUNNING' })), [makeInput(0, 'FLAP')]));
  });

  it('reserves capacity for a scheduled Star while retaining two ordinary collectibles', () => {
    const descriptor = createRunDescriptor({ runId: 'star-capacity', seed: 21 }, PRIOR_DEFAULT_CONFIG);
    const initial = createRun(descriptor);
    const target = initial.nextStarPipeIndex!;
    const fullCoins = [0, 1].map(index => ({
      id: `coin-${index}`, typeId: 'FEATHER', x: 800_000 + index, y: 100_000,
      amount: 1, radius: 7_000, collected: false,
    }));
    const state = step({
      ...initial, phase: 'RUNNING', collectibles: fullCoins,
      pipes: [{ id: `pipe-${target}`, index: target, x: 900_000, gapCenter: 280_000, scored: false }],
      nextSpawnPipeIndex: target,
    }, []).state;
    expect(state.collectibles.filter(item => item.typeId === 'FEATHER')).toHaveLength(2);
    expect(state.collectibles.filter(item => item.typeId === 'GAME_STAR')).toHaveLength(1);
    expect(state.collectibles).toHaveLength(PRIOR_DEFAULT_CONFIG.limits.maxActiveCollectibles);
    expect(state.lastCollectiblePipe).toBe(initial.lastCollectiblePipe);
  });

  it('advances coin RNG but suppresses a same-pipe coin opportunity', () => {
    const config = {
      ...PRIOR_DEFAULT_CONFIG,
      spawnNoneWeight: 0,
      collectibles: PRIOR_DEFAULT_CONFIG.collectibles.map(definition => definition.typeId === 'FEATHER'
        ? { ...definition, weight: 1 }
        : definition),
    };
    const descriptor = createRunDescriptor({ runId: 'star-coin-collision', seed: 42 }, config);
    const initial = createRun(descriptor, config);
    const target = initial.nextStarPipeIndex!;
    const state = step({
      ...initial, phase: 'RUNNING',
      pipes: [{ id: `pipe-${target}`, index: target, x: 900_000, gapCenter: 280_000, scored: false }],
      nextSpawnPipeIndex: target,
    }, []).state;
    expect(state.collectibles.map(item => item.typeId)).toEqual(['GAME_STAR']);
    expect(state.lastCollectiblePipe).toBe(initial.lastCollectiblePipe);
    expect(state.rngState).toBe((initial.rngState + 0x9e3779b9) >>> 0);
  });

  it('rejects scheduled-Star configs without a reserved slot or enough travel distance', () => {
    expect(() => createRunDescriptor({ runId: 'star-no-slot', seed: 1 }, {
      ...PRIOR_DEFAULT_CONFIG, limits: { ...PRIOR_DEFAULT_CONFIG.limits, maxActiveCollectibles: 2 },
    })).toThrow(/Star capacity/i);
    expect(() => createRunDescriptor({ runId: 'star-short-world', seed: 1 }, {
      ...PRIOR_DEFAULT_CONFIG, pipes: { ...PRIOR_DEFAULT_CONFIG.pipes, spacing: 100_000 },
    })).toThrow(/Star capacity/i);
    expect(() => createRunDescriptor({ runId: 'star-prune-boundary', seed: 1 }, {
      ...PRIOR_DEFAULT_CONFIG, pipes: { ...PRIOR_DEFAULT_CONFIG.pipes, spacing: 121_000 },
    })).toThrow(/Star capacity/i);
  });

  it('runs at the minimum valid prune spacing without overlapping scheduled Stars', () => {
    const config = {
      ...PRIOR_DEFAULT_CONFIG,
      challenges: null,
      pipes: {
        ...PRIOR_DEFAULT_CONFIG.pipes, spacing: 121_251, maxSpeed: 3_000,
        gapMinCenter: 280_000, gapMaxCenter: 280_000,
      },
    };
    const descriptor = createRunDescriptor({ runId: 'star-prune-valid-boundary', seed: 0 }, config);
    let state: RunState = { ...createRun(descriptor, config), phase: 'RUNNING' };
    for (let tick = 0; tick < 1_000 && (state.starScheduleOrdinal ?? 0) < 2; tick++) {
      state = {
        ...state,
        duck: { ...state.duck, y: 280_500, vy: -config.flight.gravity },
      };
      state = step(state, []).state;
    }
    expect(state.starScheduleOrdinal).toBeGreaterThanOrEqual(2);
  });

  it('credits exactly one Star on an actual pickup', () => {
    const descriptor = createRunDescriptor({ runId: 'star-pickup', seed: 12 }, PRIOR_DEFAULT_CONFIG);
    const initial = createRun(descriptor);
    const index = initial.nextStarPipeIndex!;
    const speed = PRIOR_DEFAULT_CONFIG.pipes.speed;
    const pipe = { id: `pipe-${index}`, index, x: PRIOR_DEFAULT_CONFIG.flight.duckX + speed, gapCenter: 280_000, scored: false };
    const movedPipe = { ...pipe, x: pipe.x - speed };
    const y = bonusY(PRIOR_DEFAULT_CONFIG, descriptor.seed, movedPipe, PRIOR_DEFAULT_CONFIG.collectibles.find(item => item.typeId === 'GAME_STAR')!.radius);
    const result = step({
      ...initial, phase: 'RUNNING', duck: { ...initial.duck, y, vy: -PRIOR_DEFAULT_CONFIG.flight.gravity },
      pipes: [pipe], nextSpawnPipeIndex: index,
    }, []);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'CurrencyCollected', typeId: 'GAME_STAR', amount: 1 }));
    expect(result.state.totals.GAME_STAR).toBe(1);
    expect(result.state.collectibles).toEqual([]);
  });

  it('lets an uncollected Star expire offscreen without disturbing the next target', () => {
    const descriptor = createRunDescriptor({ runId: 'star-uncollected', seed: 12 }, PRIOR_DEFAULT_CONFIG);
    const initial = createRun(descriptor);
    const first = initial.nextStarPipeIndex!;
    const spawned = step({
      ...initial, phase: 'RUNNING',
      pipes: [{ id: `pipe-${first}`, index: first, x: 900_000, gapCenter: 280_000, scored: false }],
      nextSpawnPipeIndex: first,
    }, []).state;
    const star = spawned.collectibles.find(item => item.typeId === 'GAME_STAR')!;
    const expiring = {
      ...spawned,
      collectibles: spawned.collectibles.map(item => item.id === star.id
        ? { ...item, x: -item.radius + PRIOR_DEFAULT_CONFIG.pipes.speed - 1 }
        : item),
    };
    const expired = step(expiring, []).state;
    expect(expired.collectibles.some(item => item.typeId === 'GAME_STAR')).toBe(false);
    expect(expired.nextStarPipeIndex).toBe(spawned.nextStarPipeIndex);
  });

  it('keeps the legacy default configuration and its descriptor identity available', () => {
    expect(configIdFor(LEGACY_DEFAULT_CONFIG)).toBe('dd-v1-stepped-v1');
    const descriptor = createRunDescriptor({ runId: 'legacy-star-rules', seed: 7 }, LEGACY_DEFAULT_CONFIG);
    expect(descriptor).toMatchObject({ simulationVersion: '1.3.0', generatorVersion: '1.2.0', configId: 'dd-v1-stepped-v1' });
    expect(createRun(descriptor).config).toEqual(LEGACY_DEFAULT_CONFIG);
  });

  it('serializes explicit null Star config identically to the frozen legacy run', () => {
    const expected = legacyFixture.cases[0]!.initialState;
    const explicitNullConfig = { ...LEGACY_DEFAULT_CONFIG, starSchedule: null };
    const actual = createRun(expected.descriptor, explicitNullConfig);
    expect(canonicalState(actual)).toBe(canonicalState(expected));
  });
});
