import { describe, expect, it } from "vitest";
import {
  BONUS_SEGMENTS_DEFAULT_CONFIG,
  COIN_COURSE_DEFAULT_CONFIG,
  CURRENCY_FORMATIONS_DEFAULT_CONFIG,
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_ID,
  BONUS_SEGMENTS_CONFIG_ID,
  BONUS_SEGMENTS_GENERATOR_VERSION,
  BONUS_SEGMENTS_SIMULATION_VERSION,
  BONUS_SEGMENTS_V2_DEFAULT_CONFIG,
  VARIED_PIPES_DEFAULT_CONFIG,
  PRESSURE_PIPES_DEFAULT_CONFIG,
  DENSE_PIPES_DEFAULT_CONFIG,
  BASE_BONUS_DEFAULT_CONFIG,
  BONUS_SEGMENTS_V2_CONFIG_ID,
  BONUS_SEGMENTS_V2_GENERATOR_VERSION,
  BONUS_SEGMENTS_V2_SIMULATION_VERSION,
  GENERATOR_VERSION,
  SIMULATION_VERSION,
  configIdFor,
  createRun,
  createRunDescriptor,
  makeInput,
  pauseRun,
  resumeRun,
  validateConfig,
  type GameConfig,
  type Pipe,
  type RunState,
} from "../src/index.js";
import {
  bonusSegmentRecipe,
  bonusSegmentV2Recipe,
  currencyFormationPoints,
  generateNext,
  isBonusSegmentBlock,
  isScheduledBonusBlock,
} from "../src/generation.js";
import { step } from "../src/simulation.js";

function firstHardBlock(seed: number): number {
  return [2, 3].find(block => isBonusSegmentBlock(seed, block))!;
}

function preparedBlock(seed: number, block: number, config: GameConfig = BONUS_SEGMENTS_DEFAULT_CONFIG, lastGapCenter?: number): RunState {
  const state = createRun(createRunDescriptor({ runId: `bonus-${seed}-${block}`, seed }, config), config);
  return generateNext({
    ...state,
    pipes: [],
    nextPipeIndex: block * 4,
    nextPipeX: 100_000,
    lastGapCenter: lastGapCenter ?? Math.floor((config.pipes.gapMinCenter + config.pipes.gapMaxCenter) / 2),
  }).state;
}

function expectedBaseSpacing(config: GameConfig, pipe: Pipe, block: number): number {
  const wetland = config.wetland!;
  const family = wetland.families.find(item => item.id === pipe.encounterFamily)!;
  return family.id === "steady" && block >= wetland.introFamilies.length
    ? wetland.recoverySpacing
    : family.stationSpacing[pipe.stationStep!]!;
}

function witnessAtMaxSpeed(seed: number, block: number, entryY: number, entryVy: number,
  config: GameConfig = BONUS_SEGMENTS_DEFAULT_CONFIG, includeApproach = false): boolean {
  const state = preparedBlock(seed, block, config, includeApproach ? entryY : undefined);
  const offset = includeApproach ? 400_000 : 150_000;
  const coursePipes = state.pipes.slice(0, 4).map(pipe => ({ ...pipe, x: pipe.x + offset }));
  const runConfig = state.config;
  const baseApproachSpacing = runConfig.pipes.width + Math.floor((240_000 - runConfig.pipes.width) * 50 / 100);
  const approachSpacing = (runConfig.wetland?.catalogVersion ?? 0) >= 11 ? 126_400 : runConfig.wetland?.catalogVersion === 10
    ? runConfig.pipes.width + Math.floor((baseApproachSpacing - runConfig.pipes.width) * 60 / 100) : baseApproachSpacing;
  const openingTop = entryY - Math.floor(runConfig.pipes.gapHeight / 2);
  const openingBottom = entryY + Math.floor(runConfig.pipes.gapHeight / 2);
  const approach = {
    ...coursePipes[0]!,
    id: "approach-pipe",
    index: block * 4 - 1,
    x: coursePipes[0]!.x - approachSpacing,
    gapCenter: entryY,
    obstacles: [
      { typeId: "pipes" as const, xOffset: 0, y: runConfig.pipes.ceilingY, width: runConfig.pipes.width, height: openingTop - runConfig.pipes.ceilingY },
      { typeId: "pipes" as const, xOffset: 0, y: openingBottom, width: runConfig.pipes.width, height: runConfig.pipes.floorY - openingBottom },
    ],
  };
  const pipes = includeApproach ? [approach, ...coursePipes] : coursePipes;
  let beam = [{ y: entryY, vy: entryVy }];
  let traveled = 0;
  for (let tick = 1; tick < 300; tick++) {
    traveled += runConfig.pipes.maxSpeed;
    const unique = new Map<string, { y: number; vy: number }>();
    for (const node of beam) for (const flap of [false, true]) {
      const vy = Math.min(config.flight.maxFallSpeed,
        (flap ? runConfig.flight.flapVelocity : node.vy) + runConfig.flight.gravity);
      const y = node.y + vy;
      if (y - runConfig.flight.duckHalfHeight <= runConfig.pipes.ceilingY ||
          y + runConfig.flight.duckHalfHeight >= runConfig.pipes.floorY) continue;
      const dead = pipes.some(pipe => (pipe.obstacles ?? []).some(obstacle => {
        const x = pipe.x - traveled;
        const left = x + obstacle.xOffset - Math.floor(obstacle.width / 2);
        const right = x + obstacle.xOffset + Math.floor(obstacle.width / 2);
        return right >= runConfig.flight.duckX - runConfig.flight.duckHalfWidth &&
          left <= runConfig.flight.duckX + runConfig.flight.duckHalfWidth &&
          y + runConfig.flight.duckHalfHeight >= obstacle.y &&
          y - runConfig.flight.duckHalfHeight <= obstacle.y + obstacle.height;
      }));
      if (!dead) unique.set(`${y}:${vy}`, { y, vy });
    }
    if (pipes.every(pipe => pipe.x + runConfig.pipes.width / 2 - traveled < runConfig.flight.duckX - runConfig.flight.duckHalfWidth))
      return true;
    beam = [...unique.values()];
    if (beam.length === 0) return false;
    if (beam.length > 1200) {
      const target = pipes.find(pipe => pipe.x - traveled >= runConfig.flight.duckX)?.gapCenter ?? 280_000;
      beam = beam.sort((a, b) => Math.abs(a.y - target) + Math.abs(a.vy) * 4 -
        Math.abs(b.y - target) - Math.abs(b.vy) * 4).slice(0, 1200);
    }
  }
  return false;
}

describe("catalog-6 bonus segments", () => {
  it("retains the 2.5 identity while catalog-7 becomes the default", () => {
    expect([BONUS_SEGMENTS_SIMULATION_VERSION, BONUS_SEGMENTS_GENERATOR_VERSION, BONUS_SEGMENTS_CONFIG_ID])
      .toEqual(["2.5.0", "2.5.0", "dd-v2-bonus-segments-v1"]);
    expect(BONUS_SEGMENTS_DEFAULT_CONFIG.wetland?.catalogVersion).toBe(6);
    expect(BONUS_SEGMENTS_DEFAULT_CONFIG.wetland?.starFormations).toBe(false);
    const descriptor = createRunDescriptor({ runId: "bonus-default", seed: 17 });
    expect([SIMULATION_VERSION, GENERATOR_VERSION, DEFAULT_CONFIG_ID]).toEqual(["3.1.0", "3.1.0", "dd-v3-varied-base-v1"]);
    expect(BONUS_SEGMENTS_V2_DEFAULT_CONFIG.wetland?.catalogVersion).toBe(7);
    expect(createRunDescriptor({ runId: "bonus-v2-frozen", seed: 17 }, BONUS_SEGMENTS_V2_DEFAULT_CONFIG)).toMatchObject({
      simulationVersion: BONUS_SEGMENTS_V2_SIMULATION_VERSION, generatorVersion: BONUS_SEGMENTS_V2_GENERATOR_VERSION,
      configId: BONUS_SEGMENTS_V2_CONFIG_ID,
    });
    expect(DEFAULT_CONFIG.wetland?.catalogVersion).toBe(12);
    expect(descriptor).toMatchObject({ simulationVersion: "3.1.0", generatorVersion: "3.1.0", configId: DEFAULT_CONFIG_ID });
    expect(createRun(descriptor).config.wetland?.catalogVersion).toBe(12);
    const oldBonusDescriptor = createRunDescriptor({ runId: "bonus-v1-frozen", seed: 17 }, BONUS_SEGMENTS_DEFAULT_CONFIG);
    expect(oldBonusDescriptor).toMatchObject({ simulationVersion: BONUS_SEGMENTS_SIMULATION_VERSION,
      generatorVersion: BONUS_SEGMENTS_GENERATOR_VERSION, configId: BONUS_SEGMENTS_CONFIG_ID });
    expect(createRun(oldBonusDescriptor).config.wetland?.catalogVersion).toBe(6);
    const oldDescriptor = createRunDescriptor({ runId: "coin-course-v2.4", seed: 17 }, COIN_COURSE_DEFAULT_CONFIG);
    expect(oldDescriptor).toMatchObject({ simulationVersion: "2.4.0", generatorVersion: "2.4.0", configId: "dd-v2-coin-course-v1" });
    expect(createRun(oldDescriptor).config.wetland?.catalogVersion).toBe(5);
    expect(createRunDescriptor({ runId: "catalog4", seed: 1 }, CURRENCY_FORMATIONS_DEFAULT_CONFIG).simulationVersion).toBe("2.3.0");
  });

  it("schedules one seeded hard block in each three-block slot after the two intro blocks", () => {
    const recipes = new Set<string>();
    for (let seed = 0; seed < 512; seed++) {
      expect(isBonusSegmentBlock(seed, 0)).toBe(false);
      expect(isBonusSegmentBlock(seed, 1)).toBe(false);
      const first = firstHardBlock(seed);
      expect([2, 3]).toContain(first);
      for (let slot = 0; slot < 6; slot++) {
        const firstOption = 2 + slot * 3;
        const selected = [firstOption, firstOption + 1].filter(block => isBonusSegmentBlock(seed, block));
        expect(selected).toHaveLength(1);
      }
      expect(isBonusSegmentBlock(seed, first + 1)).toBe(false);
      recipes.add(bonusSegmentRecipe(seed, first));
    }
    expect(recipes).toEqual(new Set(["shallow-ascent", "shallow-descent", "shallow-slalom"]));
  });

  it("scales ordinary clearances to 70%, compact gates to 20%, and leaves a 360px reward interval", () => {
    const seed = Array.from({ length: 128 }, (_, index) => index).find(value => isBonusSegmentBlock(value, 2))!;
    const block = firstHardBlock(seed);
    const course = preparedBlock(seed, block).pipes.slice(0, 4);
    expect(course.map(pipe => pipe.stationStep)).toEqual([0, 1, 2, 3]);
    for (let stepIndex = 0; stepIndex < 2; stepIndex++) {
      const original = expectedBaseSpacing(BONUS_SEGMENTS_DEFAULT_CONFIG, course[stepIndex]!, block);
      expect(course[stepIndex]!.stationSpacing).toBe(
        BONUS_SEGMENTS_DEFAULT_CONFIG.pipes.width + Math.floor((original - BONUS_SEGMENTS_DEFAULT_CONFIG.pipes.width) * 20 / 100),
      );
      expect(course[stepIndex + 1]!.x - course[stepIndex]!.x).toBe(course[stepIndex]!.stationSpacing);
    }
    expect(course[2]!.stationSpacing).toBe(BONUS_SEGMENTS_DEFAULT_CONFIG.pipes.width + 360_000);
    expect(course[3]!.x - course[2]!.x - BONUS_SEGMENTS_DEFAULT_CONFIG.pipes.width).toBe(360_000);
    const recipe = bonusSegmentRecipe(seed, block);
    const deltas = [course[1]!.gapCenter - course[0]!.gapCenter, course[2]!.gapCenter - course[1]!.gapCenter];
    if (recipe === "shallow-ascent") expect(deltas).toEqual([-2_500, -2_500]);
    if (recipe === "shallow-descent") expect(deltas).toEqual([2_500, 2_500]);
    if (recipe === "shallow-slalom") expect(deltas).toEqual([5_000, -10_000]);

    const ordinaryBlock = block === 2 ? 4 : 2;
    const ordinary = preparedBlock(seed, ordinaryBlock).pipes.slice(0, 4);
    for (const pipe of ordinary) {
      const original = expectedBaseSpacing(BONUS_SEGMENTS_DEFAULT_CONFIG, pipe, ordinaryBlock);
      expect(pipe.stationSpacing).toBe(
        BONUS_SEGMENTS_DEFAULT_CONFIG.pipes.width + Math.floor((original - BONUS_SEGMENTS_DEFAULT_CONFIG.pipes.width) * 70 / 100),
      );
    }
    const featherRadius = BONUS_SEGMENTS_DEFAULT_CONFIG.collectibles.find(item => item.typeId === "FEATHER")!.radius;
    expect(currencyFormationPoints(BONUS_SEGMENTS_DEFAULT_CONFIG, seed, ordinary[2]!, featherRadius)).toHaveLength(1);
  });

  it("spawns one ordinary pickup, reserves figures for the hard-segment exit, and keeps Stars single by default", () => {
    const seed = Array.from({ length: 2048 }, (_, index) => index).find(value => {
      const state = preparedBlock(value, 0);
      const pipe = state.pipes.find(item => item.index === 1)!;
      const prepared: RunState = { ...state, phase: "RUNNING", collectibles: [], pipes: [{ ...pipe, x: 500_000 }],
        nextSpawnPipeIndex: pipe.index, nextPipeX: 10_000_000,
        duck: { ...state.duck, y: 280_000, vy: 0 } };
      const result = step(prepared, [makeInput(prepared.nextInputSequence, "FLAP")]);
      return result.state.collectibles.some(item => item.typeId === "FEATHER");
    })!;
    const state = preparedBlock(seed, 0);
    const pipe = state.pipes.find(item => item.index === 1)!;
    const prepared: RunState = { ...state, phase: "RUNNING", collectibles: [], pipes: [{ ...pipe, x: 500_000 }],
      nextSpawnPipeIndex: pipe.index, nextPipeX: 10_000_000,
      duck: { ...state.duck, y: 280_000, vy: 0 } };
    const spawned = step(prepared, [makeInput(prepared.nextInputSequence, "FLAP")]).state.collectibles;
    expect(spawned.filter(item => item.typeId === "FEATHER")).toHaveLength(1);

    const hardBlock = firstHardBlock(seed);
    const hardPipes = preparedBlock(seed, hardBlock).pipes.slice(0, 4);
    const featherRadius = BONUS_SEGMENTS_DEFAULT_CONFIG.collectibles.find(item => item.typeId === "FEATHER")!.radius;
    const starRadius = BONUS_SEGMENTS_DEFAULT_CONFIG.collectibles.find(item => item.typeId === "GAME_STAR")!.radius;
    expect(currencyFormationPoints(BONUS_SEGMENTS_DEFAULT_CONFIG, seed, hardPipes[0]!, featherRadius)).toHaveLength(1);
    expect(currencyFormationPoints(BONUS_SEGMENTS_DEFAULT_CONFIG, seed, hardPipes[1]!, featherRadius)).toHaveLength(1);
    const figure = currencyFormationPoints(BONUS_SEGMENTS_DEFAULT_CONFIG, seed, hardPipes[2]!, featherRadius);
    expect(figure).toHaveLength(3);
    const figureCenter = Math.floor(figure.reduce((sum, point) => sum + point.x, 0) / figure.length);
    expect(figureCenter).toBe(hardPipes[2]!.x + Math.floor(hardPipes[2]!.stationSpacing! / 2));
    expect(currencyFormationPoints(BONUS_SEGMENTS_DEFAULT_CONFIG, seed, hardPipes[3]!, featherRadius)).toHaveLength(1);
    expect(currencyFormationPoints(BONUS_SEGMENTS_DEFAULT_CONFIG, seed, hardPipes[0]!, starRadius, true)).toHaveLength(1);
  });

  it("allows catalog-6 custom Star formations, rejects the option in older catalogs, and counts overlap capacity", () => {
    const baseWetland = BONUS_SEGMENTS_DEFAULT_CONFIG.wetland!;
    const withoutSchedule: GameConfig = { ...BONUS_SEGMENTS_DEFAULT_CONFIG, starSchedule: null };
    const explicitStarOptOut: GameConfig = {
      ...withoutSchedule,
      wetland: { ...baseWetland, starFormations: false },
    };
    expect(validateConfig(explicitStarOptOut)).toBe(explicitStarOptOut);
    expect(() => validateConfig({
      ...withoutSchedule,
      wetland: { ...baseWetland, starFormations: true },
    })).toThrow(/currency formation clearance/);

    const formed: GameConfig = { ...BONUS_SEGMENTS_DEFAULT_CONFIG, wetland: { ...baseWetland, starFormations: true } };
    expect(validateConfig(formed)).toBe(formed);
    expect(configIdFor(formed)).not.toBe(BONUS_SEGMENTS_CONFIG_ID);
    const hardBlock = firstHardBlock(19);
    const pipe = preparedBlock(19, hardBlock).pipes[2]!;
    const starRadius = BONUS_SEGMENTS_DEFAULT_CONFIG.collectibles.find(item => item.typeId === "GAME_STAR")!.radius;
    expect(currencyFormationPoints(formed, 19, pipe, starRadius, true)).toHaveLength(5);
    expect(() => validateConfig({ ...formed,
      limits: { ...formed.limits, maxActiveCollectibles: 15 },
    })).toThrow(/wetland family boundary/);
    expect(validateConfig(CURRENCY_FORMATIONS_DEFAULT_CONFIG)).toBe(CURRENCY_FORMATIONS_DEFAULT_CONFIG);
    expect(() => validateConfig({ ...BONUS_SEGMENTS_DEFAULT_CONFIG,
      wetland: { ...baseWetland, catalogVersion: 5, starFormations: false } })).toThrow(/wetland encounter catalog/);
  });

  it("keeps hard segments reachable at maximum speed across all seeded recipes and entry variants", () => {
    const seeds = new Map<string, number>();
    for (let seed = 0; seed < 2048 && seeds.size < 3; seed++) {
      const block = firstHardBlock(seed);
      seeds.set(bonusSegmentRecipe(seed, block), seeds.get(bonusSegmentRecipe(seed, block)) ?? seed);
    }
    expect(seeds.size).toBe(3);
    for (const [recipe, seed] of seeds) {
      const block = firstHardBlock(seed);
      for (const [y, vy] of [[275_000, -500], [280_000, 0], [285_000, 500]] as const) {
        expect(witnessAtMaxSpeed(seed, block, y, vy), `recipe=${recipe} seed=${seed} entry=${y}/${vy}`).toBe(true);
      }
    }
  }, 30_000);

  it("requires seeded intervals to keep scheduled Stars from overlapping the hard course and reward figure", () => {
    const invalid = { ...BONUS_SEGMENTS_DEFAULT_CONFIG, starSchedule: { minIntervalPipes: 8, maxIntervalPipes: 16 } };
    expect(() => validateConfig(invalid)).toThrow(/scheduled Star capacity or interval geometry/);
    const state = preparedBlock(31, firstHardBlock(31));
    const pipe = state.pipes[2]!;
    const scheduled: RunState = { ...state, phase: "RUNNING", pipes: [{ ...pipe, x: 500_000 }],
      nextSpawnPipeIndex: pipe.index, nextStarPipeIndex: pipe.index, starScheduleOrdinal: 0,
      nextPipeX: state.config.pipes.horizon + 1, duck: { ...state.duck, y: 280_000, vy: 0 } };
    const result = step(scheduled, [makeInput(scheduled.nextInputSequence, "FLAP")]);
    expect(result.state.collectibles.filter(item => item.typeId === "FEATHER")).toHaveLength(3);
    expect(result.state.collectibles.filter(item => item.typeId === "GAME_STAR")).toHaveLength(1);
    expect(result.state.collectibles.length).toBeLessThan(BONUS_SEGMENTS_DEFAULT_CONFIG.limits.maxActiveCollectibles);
  });
});

describe("catalog-7 bonus segments v2", () => {
  it("issues the 2.6 default and preserves the catalog-6 config identity", () => {
    expect([SIMULATION_VERSION, GENERATOR_VERSION, DEFAULT_CONFIG_ID]).toEqual([
      "3.1.0",
      "3.1.0",
      "dd-v3-varied-base-v1",
    ]);
    expect(DEFAULT_CONFIG.wetland?.catalogVersion).toBe(12);
    const descriptor = createRunDescriptor({ runId: "bonus-v2-default", seed: 29 });
    expect(descriptor).toMatchObject({
      simulationVersion: "3.1.0",
      generatorVersion: "3.1.0",
      configId: "dd-v3-varied-base-v1",
    });
    expect(createRun(descriptor).config.wetland?.catalogVersion).toBe(12);
    const oldDescriptor = createRunDescriptor({ runId: "bonus-v1-still-supported", seed: 29 }, BONUS_SEGMENTS_DEFAULT_CONFIG);
    expect(oldDescriptor).toMatchObject({ simulationVersion: "2.5.0", generatorVersion: "2.5.0", configId: BONUS_SEGMENTS_CONFIG_ID });
    expect(createRun(oldDescriptor).config.wetland?.catalogVersion).toBe(6);
  });

  it("requires catalog-7 bounds that preserve the full 80k recipe span", () => {
    const base = BONUS_SEGMENTS_V2_DEFAULT_CONFIG;
    const minimumRange: GameConfig = {
      ...base,
      pipes: { ...base.pipes, gapMinCenter: 240_000, gapMaxCenter: 320_000, maxGapDelta: 80_000 },
      wetland: { ...base.wetland!, families: base.wetland!.families.map(family => ({
        ...family, gapCenters: [280_000, 280_000, 280_000, 280_000],
      })) },
    };
    expect(validateConfig(minimumRange)).toBe(minimumRange);
    const boundaryRoute = preparedBlock(0, firstHardBlock(0), minimumRange, 280_000).pipes.slice(0, 3);
    expect(Math.max(...boundaryRoute.map(pipe => pipe.gapCenter)) - Math.min(...boundaryRoute.map(pipe => pipe.gapCenter))).toBe(80_000);
    expect(Math.abs(boundaryRoute[2]!.gapCenter - boundaryRoute[1]!.gapCenter)).toBe(80_000);
    expect(() => validateConfig({
      ...minimumRange,
      pipes: { ...minimumRange.pipes, maxGapDelta: 70_000 },
    })).toThrow(/80,000-unit/);
    expect(() => validateConfig({
      ...minimumRange,
      pipes: { ...minimumRange.pipes, gapMaxCenter: 319_999 },
    })).toThrow(/80,000-unit/);
  });

  it("uses 50% normal spacing, 10% hard spacing, and seeded legal 80px-plus routes", () => {
    const config = BONUS_SEGMENTS_V2_DEFAULT_CONFIG;
    const profiles = new Map<string, { seed: number; block: number }>();
    const directions = new Map<string, Set<string>>();
    const ordinaryCenters = new Set<number>();
    for (let seed = 0; seed < 512; seed++) {
      const block = firstHardBlock(seed);
      const route = preparedBlock(seed, block, config).pipes.slice(0, 4);
      const key = bonusSegmentV2Recipe(seed, block);
      profiles.set(key, profiles.get(key) ?? { seed, block });
      const deltas = [route[1]!.gapCenter - route[0]!.gapCenter, route[2]!.gapCenter - route[1]!.gapCenter];
      const routeDirections = directions.get(key) ?? new Set<string>();
      routeDirections.add(deltas.map(delta => Math.sign(delta)).join(","));
      directions.set(key, routeDirections);
      const centers = route.slice(0, 3).map(pipe => pipe.gapCenter);
      expect(centers.every(center => center >= config.pipes.gapMinCenter && center <= config.pipes.gapMaxCenter)).toBe(true);
      expect(Math.max(...centers) - Math.min(...centers)).toBeGreaterThanOrEqual(80_000);
      expect(Math.abs(deltas[0]!)).toBe(40_000);
      expect(Math.abs(deltas[1]!)).toBe(key === "slalom" ? 80_000 : 40_000);
      expect(route.slice(1).every((pipe, index) => Math.abs(pipe.gapCenter - route[index]!.gapCenter) <= config.pipes.maxGapDelta)).toBe(true);
      expect(Math.abs(route[3]!.gapCenter - route[2]!.gapCenter)).toBeLessThanOrEqual(45_000);
      expect(route[3]!.gapCenter).toBe(preparedBlock(seed, block, config).pipes[3]!.gapCenter);
      for (const pipe of route) {
        if (pipe.stationStep === 2) {
          expect(pipe.stationSpacing).toBe(config.pipes.width + 360_000);
        } else {
          const original = expectedBaseSpacing(config, pipe, block);
          const percent = isBonusSegmentBlock(seed, block) && pipe.stationStep! < 2 ? 10 : 50;
          expect(pipe.stationSpacing).toBe(config.pipes.width + Math.floor((original - config.pipes.width) * percent / 100));
        }
      }
      const ordinaryBlock = [block + 1, block + 2, block + 3].find(candidate => !isBonusSegmentBlock(seed, candidate))!;
      const ordinary = preparedBlock(seed, ordinaryBlock, config).pipes.slice(0, 4);
      for (const pipe of ordinary) {
        const original = expectedBaseSpacing(config, pipe, ordinaryBlock);
        expect(pipe.stationSpacing).toBe(config.pipes.width + Math.floor((original - config.pipes.width) * 50 / 100));
      }
      const same = preparedBlock(seed, ordinaryBlock, config).pipes;
      expect(route).toEqual(preparedBlock(seed, block, config).pipes.slice(0, 4));
      expect(ordinary).toEqual(same.slice(0, 4));
      ordinaryCenters.add(ordinary[0]!.gapCenter);
    }
    expect(profiles.size).toBe(3);
    expect([...directions.values()].every(samples => samples.size === 2)).toBe(true);
    expect(ordinaryCenters.size).toBeGreaterThan(1);

    for (const { seed, block } of profiles.values()) {
      for (const entryCenter of [config.pipes.gapMinCenter, 280_000, config.pipes.gapMaxCenter]) {
        const route = preparedBlock(seed, block, config, entryCenter).pipes.slice(0, 4);
        expect(route[0]!.gapCenter - entryCenter).toBeLessThanOrEqual(config.pipes.maxGapDelta);
        expect(Math.abs(route[0]!.gapCenter - entryCenter)).toBeLessThanOrEqual(config.pipes.maxGapDelta);
        expect(route.every(pipe => pipe.gapCenter >= config.pipes.gapMinCenter && pipe.gapCenter <= config.pipes.gapMaxCenter)).toBe(true);
        expect(Math.abs(route[3]!.gapCenter - route[2]!.gapCenter)).toBeLessThanOrEqual(45_000);
      }
    }
  });

  it("keeps approach, three gates, reward interval, and recovery pipe reachable at maximum speed", () => {
    const config = BONUS_SEGMENTS_V2_DEFAULT_CONFIG;
    const byRecipe = new Map<string, { seed: number; block: number }>();
    for (let seed = 0; seed < 4096 && byRecipe.size < 3; seed++) {
      const block = firstHardBlock(seed);
      const recipe = bonusSegmentV2Recipe(seed, block);
      byRecipe.set(recipe, byRecipe.get(recipe) ?? { seed, block });
    }
    expect(byRecipe.size).toBe(3);
    for (const [recipe, { seed, block }] of byRecipe) {
      for (const entryY of [240_000, 280_000, 320_000]) {
        for (const entryVy of [-500, 0, 500]) {
          expect(witnessAtMaxSpeed(seed, block, entryY, entryVy, config, true),
            `recipe=${recipe} seed=${seed} entry=${entryY}/${entryVy}`).toBe(true);
        }
      }
    }
  }, 30_000);

  it("places the coin figure after the third gate and retains single Stars by default", () => {
    const config = BONUS_SEGMENTS_V2_DEFAULT_CONFIG;
    const seed = Array.from({ length: 512 }, (_, index) => index).find(value => isBonusSegmentBlock(value, 2))!;
    const block = firstHardBlock(seed);
    const pipes = preparedBlock(seed, block, config).pipes.slice(0, 4);
    const featherRadius = config.collectibles.find(item => item.typeId === "FEATHER")!.radius;
    const starRadius = config.collectibles.find(item => item.typeId === "GAME_STAR")!.radius;
    expect(currencyFormationPoints(config, seed, pipes[0]!, featherRadius)).toHaveLength(1);
    expect(currencyFormationPoints(config, seed, pipes[1]!, featherRadius)).toHaveLength(1);
    const figure = currencyFormationPoints(config, seed, pipes[2]!, featherRadius);
    expect(figure).toHaveLength(3);
    expect(figure.every(point => point.x > pipes[2]!.x + config.pipes.width)).toBe(true);
    expect(figure.every(point => point.x < pipes[3]!.x - Math.floor(config.pipes.width / 2))).toBe(true);
    expect(currencyFormationPoints(config, seed, pipes[3]!, featherRadius)).toHaveLength(1);
    expect(currencyFormationPoints(config, seed, pipes[0]!, starRadius, true)).toHaveLength(1);

    const baseWetland = config.wetland!;
    const withoutSchedule: GameConfig = { ...config, starSchedule: null };
    const explicitStarOptOut: GameConfig = { ...withoutSchedule, wetland: { ...baseWetland, starFormations: false } };
    expect(validateConfig(explicitStarOptOut)).toBe(explicitStarOptOut);
    expect(() => validateConfig({ ...withoutSchedule, wetland: { ...baseWetland, starFormations: true } }))
      .toThrow(/currency formation clearance/);
    const starFormations: GameConfig = { ...config, wetland: { ...baseWetland, starFormations: true } };
    expect(validateConfig(starFormations)).toBe(starFormations);
    expect(configIdFor(starFormations)).not.toBe(BONUS_SEGMENTS_V2_CONFIG_ID);
    expect(currencyFormationPoints(starFormations, seed, pipes[0]!, starRadius, true)).toHaveLength(5);
  });
});

describe("catalog-8 varied pipes", () => {
  it("matches shared seeded vectors and preserves legal transitions", async () => {
    const { readFileSync } = await import("node:fs");
    const fixture = JSON.parse(readFileSync("contracts/simulation/varied-pipes-v1.json", "utf8")) as {
      cases: { seed: number; block: number; centers: number[]; spacings: number[] }[];
    };
    for (const example of fixture.cases) {
      const pipes = preparedBlock(example.seed, example.block, VARIED_PIPES_DEFAULT_CONFIG).pipes.slice(0, 4);
      expect(pipes.map(pipe => pipe.gapCenter)).toEqual(example.centers);
      expect(pipes.map(pipe => pipe.stationSpacing)).toEqual(example.spacings);
      let previous = 280_000;
      for (const pipe of pipes) {
        expect(pipe.gapCenter).toBeGreaterThanOrEqual(DEFAULT_CONFIG.pipes.gapMinCenter);
        expect(pipe.gapCenter).toBeLessThanOrEqual(DEFAULT_CONFIG.pipes.gapMaxCenter);
        expect(Math.abs(pipe.gapCenter - previous)).toBeLessThanOrEqual(DEFAULT_CONFIG.pipes.maxGapDelta);
        previous = pipe.gapCenter;
      }
    }
    expect(new Set(fixture.cases.filter(example => example.block === 4).map(example => example.centers.join(","))).size).toBe(4);
  });
  it("keeps representative pressure and recovery routes flyable at maximum speed", () => {
    for (const seed of [0, 1, 42, 99]) for (const block of [4, 5]) {
      expect(witnessAtMaxSpeed(seed, block, 280_000, 0, VARIED_PIPES_DEFAULT_CONFIG, true)).toBe(true);
    }
  });
});

describe("catalog-9 pressure pipes", () => {
  it("matches shared vectors and keeps catalog-8 replay available", async () => {
    const { readFileSync } = await import("node:fs");
    const fixture = JSON.parse(readFileSync("contracts/simulation/pressure-pipes-v1.json", "utf8")) as {
      cases: { seed: number; block: number; centers: number[]; spacings: number[] }[];
    };
    for (const example of fixture.cases) {
      const pipes = preparedBlock(example.seed, example.block, PRESSURE_PIPES_DEFAULT_CONFIG).pipes.slice(0, 4);
      expect(pipes.map(pipe => pipe.gapCenter)).toEqual(example.centers);
      expect(pipes.map(pipe => pipe.stationSpacing)).toEqual(example.spacings);
      let previous = 280_000;
      for (const pipe of pipes) {
        expect(pipe.gapCenter).toBeGreaterThanOrEqual(PRESSURE_PIPES_DEFAULT_CONFIG.pipes.gapMinCenter);
        expect(pipe.gapCenter).toBeLessThanOrEqual(PRESSURE_PIPES_DEFAULT_CONFIG.pipes.gapMaxCenter);
        expect(Math.abs(pipe.gapCenter - previous)).toBeLessThanOrEqual(PRESSURE_PIPES_DEFAULT_CONFIG.pipes.maxGapDelta);
        previous = pipe.gapCenter;
      }
    }
    const old = createRunDescriptor({ runId: "catalog-eight-replay", seed: 42 }, VARIED_PIPES_DEFAULT_CONFIG);
    expect(old).toMatchObject({ simulationVersion: "2.7.0", generatorVersion: "2.7.0", configId: "dd-v2-varied-pipes-v1" });
    expect(createRun(old).config).toEqual(VARIED_PIPES_DEFAULT_CONFIG);
  });
  it("preserves introduction and recovery, and bounds pressure for edge entries", () => {
    for (let seed = 0; seed < 64; seed++) {
      for (const block of [0, 1, 5]) {
        if (isBonusSegmentBlock(seed, block)) continue;
        expect(preparedBlock(seed, block, PRESSURE_PIPES_DEFAULT_CONFIG).pipes.slice(0, 4).map(pipe => pipe.gapCenter))
          .toEqual(preparedBlock(seed, block, VARIED_PIPES_DEFAULT_CONFIG).pipes.slice(0, 4).map(pipe => pipe.gapCenter));
      }
      for (const entry of [160_000, 280_000, 400_000]) {
        const generated = preparedBlock(seed, 4, PRESSURE_PIPES_DEFAULT_CONFIG, entry).pipes;
        expect(generated).toEqual(preparedBlock(seed, 4, PRESSURE_PIPES_DEFAULT_CONFIG, entry).pipes);
        let previous = entry;
        for (const pipe of generated) {
          expect(pipe.gapCenter).toBeGreaterThanOrEqual(PRESSURE_PIPES_DEFAULT_CONFIG.pipes.gapMinCenter);
          expect(pipe.gapCenter).toBeLessThanOrEqual(PRESSURE_PIPES_DEFAULT_CONFIG.pipes.gapMaxCenter);
          expect(Math.abs(pipe.gapCenter - previous)).toBeLessThanOrEqual(PRESSURE_PIPES_DEFAULT_CONFIG.pipes.maxGapDelta);
          previous = pipe.gapCenter;
        }
      }
    }
  });
  it("raises typical pressure movement and directional reversals against catalog 8", () => {
    let oldMovement = 0, newMovement = 0, oldReversals = 0, newReversals = 0, count = 0;
    for (let seed = 0; seed < 128; seed++) for (const block of [2, 4, 6, 8]) {
      if (isBonusSegmentBlock(seed, block)) continue;
      const measure = (config: GameConfig) => {
        const centers = [280_000, ...preparedBlock(seed, block, config).pipes.slice(0, 4).map(pipe => pipe.gapCenter)];
        const deltas = centers.slice(1).map((center, i) => center - centers[i]!);
        return { movement: deltas.reduce((sum, delta) => sum + Math.abs(delta), 0),
          reversals: deltas.slice(1).filter((delta, i) => delta * deltas[i]! < 0).length };
      };
      const old = measure(VARIED_PIPES_DEFAULT_CONFIG), current = measure(PRESSURE_PIPES_DEFAULT_CONFIG);
      oldMovement += old.movement; newMovement += current.movement;
      oldReversals += old.reversals; newReversals += current.reversals; count++;
    }
    expect(count).toBeGreaterThan(100);
    expect(newMovement / oldMovement).toBeGreaterThan(1.5);
    expect(newReversals / oldReversals).toBeGreaterThan(1.3);
  });
  it("has max-speed witnesses from varied entry positions and velocities", () => {
    for (const [seed, block, y, vy] of [[0, 4, 200_000, -2_000], [1, 4, 280_000, 0], [42, 4, 360_000, 2_000],
      [99, 6, 200_000, 2_000], [7, 6, 280_000, -2_000], [17, 6, 360_000, 0]] as const) {
      expect(witnessAtMaxSpeed(seed, block, y, vy, PRESSURE_PIPES_DEFAULT_CONFIG, true)).toBe(true);
    }
  });
});

describe("catalog-10 dense pipes", () => {
  it("scales every clearance, keeps catalog-9 identity, and matches shared vectors", async () => {
    const { readFileSync } = await import("node:fs");
    const fixture = JSON.parse(readFileSync("contracts/simulation/dense-pipes-v1.json", "utf8")) as {
      cases: { seed: number; block: number; centers: number[]; spacings: number[] }[];
    };
    const seen = new Set<number>();
    for (const example of fixture.cases) {
      const dense = preparedBlock(example.seed, example.block, DENSE_PIPES_DEFAULT_CONFIG).pipes.slice(0, 4);
      const prior = preparedBlock(example.seed, example.block, PRESSURE_PIPES_DEFAULT_CONFIG).pipes.slice(0, 4);
      expect(dense.map(pipe => pipe.gapCenter)).toEqual(example.centers);
      expect(dense.map(pipe => pipe.stationSpacing)).toEqual(example.spacings);
      for (let i = 0; i < 4; i++) {
        expect(dense[i]!.stationSpacing).toBe(52_000 + Math.floor((prior[i]!.stationSpacing! - 52_000) * 0.6));
        expect(dense[i]!.gapCenter).toBe(prior[i]!.gapCenter);
        seen.add(dense[i]!.stationSpacing!);
      }
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([63_280, 66_880, 70_480, 108_400, 126_400, 144_400, 268_000]);
    const old = createRunDescriptor({ runId: "catalog-nine", seed: 42 }, PRESSURE_PIPES_DEFAULT_CONFIG);
    expect(old).toMatchObject({ simulationVersion: "2.8.0", generatorVersion: "2.8.0", configId: "dd-v2-pressure-pipes-v1" });
    expect(createRun(old).config).toEqual(PRESSURE_PIPES_DEFAULT_CONFIG);
  });
  it("reserves enough horizon and pickup capacity for dense spacing", () => {
    expect(DENSE_PIPES_DEFAULT_CONFIG.limits.maxActivePipes).toBe(18);
    expect(DENSE_PIPES_DEFAULT_CONFIG.starSchedule).toEqual({ minIntervalPipes: 16, maxIntervalPipes: 16 });
    expect(() => validateConfig({ ...DENSE_PIPES_DEFAULT_CONFIG, limits: { ...DENSE_PIPES_DEFAULT_CONFIG.limits, maxActivePipes: 17 } })).toThrow(/horizon/);
    expect(() => validateConfig({ ...DENSE_PIPES_DEFAULT_CONFIG, starSchedule: { minIntervalPipes: 15, maxIntervalPipes: 16 } })).toThrow(/Star capacity/);
    expect(() => validateConfig({ ...DENSE_PIPES_DEFAULT_CONFIG, limits: { ...DENSE_PIPES_DEFAULT_CONFIG.limits, maxActiveCollectibles: 21 } })).toThrow();
  });
  it("keeps scheduled Stars clear of neighboring obstacles", () => {
    for (let seed = 0; seed < 128; seed++) for (const block of [4, 8, 12, 16, 20, 24, 28]) {
      const pipes = preparedBlock(seed, block, DENSE_PIPES_DEFAULT_CONFIG).pipes;
      const owner = pipes[0]!;
      const star = currencyFormationPoints(DENSE_PIPES_DEFAULT_CONFIG, seed, owner, 7_000, true)[0]!;
      for (const pipe of pipes.slice(1)) for (const obstacle of pipe.obstacles ?? []) {
        const overlapsX = Math.abs(star.x - (pipe.x + obstacle.xOffset)) <= obstacle.width / 2 + DENSE_PIPES_DEFAULT_CONFIG.flight.duckHalfWidth;
        const overlapsY = star.y + DENSE_PIPES_DEFAULT_CONFIG.flight.duckHalfHeight >= obstacle.y &&
          star.y - DENSE_PIPES_DEFAULT_CONFIG.flight.duckHalfHeight <= obstacle.y + obstacle.height;
        expect(overlapsX && overlapsY, `seed ${seed}, station ${pipe.index}`).toBe(false);
      }
    }
  });
  it("keeps every mirrored bonus recipe flyable at maximum speed", () => {
    const routes = new Map<string, { seed: number; block: number }>();
    for (let seed = 0; seed < 512 && routes.size < 6; seed++) {
      const block = firstHardBlock(seed);
      const pipes = preparedBlock(seed, block, DENSE_PIPES_DEFAULT_CONFIG).pipes;
      const key = `${bonusSegmentV2Recipe(seed, block)}:${Math.sign(pipes[1]!.gapCenter - pipes[0]!.gapCenter)}`;
      if (!routes.has(key)) routes.set(key, { seed, block });
    }
    expect(routes.size).toBe(6);
    for (const [key, { seed, block }] of routes) for (const entry of [240_000, 280_000, 320_000])
      expect(witnessAtMaxSpeed(seed, block, entry, 0, DENSE_PIPES_DEFAULT_CONFIG, true), `${key} entry ${entry}`).toBe(true);
  }, 30_000);
  it("keeps pressure and bonus routes flyable at maximum speed", () => {
    for (const [seed, block, y, vy] of [[0, 4, 200_000, -2_000], [1, 4, 280_000, 0], [42, 4, 360_000, 2_000],
      [99, 6, 200_000, 2_000], [7, 6, 280_000, -2_000], [17, 6, 360_000, 0]] as const) {
      expect(witnessAtMaxSpeed(seed, block, y, vy, DENSE_PIPES_DEFAULT_CONFIG, true), `${seed}/${block}`).toBe(true);
    }
  });
});

describe("catalog-11 base and bonus generation", () => {
  it("uses seeded first and base gaps, fixed spacing, and rare scheduled bonus blocks", async () => {
    const { readFileSync } = await import("node:fs");
    const fixture = JSON.parse(readFileSync("contracts/simulation/base-bonus-v1.json", "utf8")) as {
      cases: { seed: number; block: number; centers: number[]; spacings: number[] }[];
    };
    for (const example of fixture.cases) {
      const pipes = preparedBlock(example.seed, example.block, BASE_BONUS_DEFAULT_CONFIG).pipes.slice(0, 4);
      expect(pipes.map(pipe => pipe.gapCenter)).toEqual(example.centers);
      expect(pipes.map(pipe => pipe.stationSpacing)).toEqual(example.spacings);
    }
    const firstCenters = new Set<number>();
    for (let seed = 0; seed < 64; seed++) {
      const first = createRun(createRunDescriptor({ runId: `base-${seed}`, seed }, BASE_BONUS_DEFAULT_CONFIG));
      expect(first.pipes[0]!.x).toBe(BASE_BONUS_DEFAULT_CONFIG.pipes.safeLeadIn);
      firstCenters.add(first.pipes[0]!.gapCenter);
      const bonuses: number[] = [];
      for (let block = 0; block < 40; block++) {
        const bonus = isScheduledBonusBlock(BASE_BONUS_DEFAULT_CONFIG, seed, block);
        if (bonus) bonuses.push(block * 4);
        const pipes = preparedBlock(seed, block, BASE_BONUS_DEFAULT_CONFIG).pipes.slice(0, 4);
        expect(pipes.every(pipe => pipe.encounterFamily === "steady")).toBe(true);
        expect(pipes.map(pipe => pipe.stationSpacing)).toEqual(bonus ? [66_880, 66_880, 268_000, 126_400] : [126_400, 126_400, 126_400, 126_400]);
        expect(pipes).toEqual(preparedBlock(seed, block, BASE_BONUS_DEFAULT_CONFIG).pipes.slice(0, 4));
        for (let i = 1; i < pipes.length; i++) expect(pipes[i]!.x - pipes[i - 1]!.x).toBe(pipes[i - 1]!.stationSpacing);
      }
      expect(bonuses[0]).toBeGreaterThanOrEqual(24);
      expect(bonuses[0]).toBeLessThanOrEqual(32);
      for (let i = 1; i < bonuses.length; i++) expect(bonuses[i]! - bonuses[i - 1]!).toBe(28);
    }
    expect(firstCenters.size).toBeGreaterThan(20);
    const old = createRunDescriptor({ runId: "catalog-ten", seed: 42 }, DENSE_PIPES_DEFAULT_CONFIG);
    expect(old).toMatchObject({ simulationVersion: "2.9.0", generatorVersion: "2.9.0", configId: "dd-v2-dense-pipes-v1" });
    expect(createRun(old).config).toEqual(DENSE_PIPES_DEFAULT_CONFIG);
  });
  it("produces the same route across partial refills and respects pickup capacity", () => {
    const initial = createRun(createRunDescriptor({ runId: "refill", seed: 42 }, BASE_BONUS_DEFAULT_CONFIG));
    const base = { ...initial, pipes: [], nextPipeIndex: 24, nextPipeX: 100_000, lastGapCenter: 280_000 };
    const all = generateNext(base).state;
    let partial: RunState = { ...base, config: { ...base.config, limits: { ...base.config.limits, maxActivePipes: 3 } } };
    const gathered: Pipe[] = [];
    for (let attempt = 0; attempt < 10 && partial.nextPipeX! <= partial.config.pipes.horizon; attempt++) {
      partial = generateNext(partial).state;
      gathered.push(...partial.pipes);
      partial = { ...partial, pipes: [] };
    }
    expect(gathered).toEqual(all.pipes);
    let running: RunState = { ...initial, phase: "RUNNING", config: { ...initial.config,
      flight: { ...initial.config.flight, duckX: -1_000_000 } }, duck: { ...initial.duck, x: -1_000_000 } };
    for (let tick = 0; tick < 3_000; tick++) {
      running = step({ ...running, duck: { ...running.duck, y: 280_000, vy: 0 } }, []).state;
      expect(running.phase).toBe("RUNNING");
      expect(running.pipes.length).toBeLessThanOrEqual(BASE_BONUS_DEFAULT_CONFIG.limits.maxActivePipes);
      expect(running.collectibles.length).toBeLessThanOrEqual(BASE_BONUS_DEFAULT_CONFIG.limits.maxActiveCollectibles);
      expect(running.collectibles.filter(item => item.typeId === "GAME_STAR").length).toBeLessThanOrEqual(1);
    }
    expect(running.nextPipeIndex).toBeGreaterThan(60);
  });
  it("scores each pipe once and resumes deterministically after pause", () => {
    const state = preparedBlock(42, 2, BASE_BONUS_DEFAULT_CONFIG);
    const pipe = { ...state.pipes[0]!, x: 40_000 };
    const start = { ...state, phase: "RUNNING" as const, pipes: [pipe], nextPipeX: 2_000_000,
      nextSpawnPipeIndex: pipe.index + 1, duck: { ...state.duck, y: pipe.gapCenter, vy: 0 } };
    const paused = pauseRun(start);
    expect(step(paused, []).state).toEqual(paused);
    const direct = step(start, []);
    const resumed = step(resumeRun(paused), []);
    expect(resumed).toEqual(direct);
    expect(direct.events.filter(event => event.type === "ObstaclePassed")).toHaveLength(1);
    expect(direct.state.score).toBe(start.score + 1);
    expect(step(direct.state, []).state.score).toBe(start.score + 1);
  });
  it("flies representative base and bonus patterns at maximum speed", () => {
    for (const seed of [0, 1, 42, 99]) {
      const bonus = [6, 7, 8].find(block => isScheduledBonusBlock(BASE_BONUS_DEFAULT_CONFIG, seed, block))!;
      for (const y of [240_000, 280_000, 320_000]) {
        expect(witnessAtMaxSpeed(seed, 2, y, 0, BASE_BONUS_DEFAULT_CONFIG, true), `base ${seed}/${y}`).toBe(true);
        expect(witnessAtMaxSpeed(seed, bonus, y, 0, BASE_BONUS_DEFAULT_CONFIG, true), `bonus ${seed}/${y}`).toBe(true);
      }
    }
  }, 30_000);
});

function collectBonusAtMaxSpeed(seed: number, block: number, entryY: number, config = BASE_BONUS_DEFAULT_CONFIG, bonus = true, entryVy = 0): boolean {
  const state = preparedBlock(seed, block, config, entryY);
  const pipes = state.pipes.slice(0, 4).map(pipe => ({ ...pipe, x: pipe.x + 400_000 }));
  const half = Math.floor(config.pipes.gapHeight / 2);
  const approach: Pipe = { ...pipes[0]!, id: "approach", index: pipes[0]!.index - 1,
    x: pipes[0]!.x - 126_400, gapCenter: entryY, obstacles: [
      { typeId: "pipes", xOffset: 0, y: config.pipes.ceilingY, width: config.pipes.width, height: entryY - half - config.pipes.ceilingY },
      { typeId: "pipes", xOffset: 0, y: entryY + half, width: config.pipes.width, height: config.pipes.floorY - entryY - half },
    ] };
  const course = [approach, ...pipes];
  const points = bonus ? currencyFormationPoints(config, seed, pipes[2]!, 7_000) : [];
  if (bonus && points.length !== 3) return false;
  const clearance = config.pipes.width / 2 + config.flight.duckHalfWidth + 7_000;
  if (points.some(point => pipes.some(pipe => Math.abs(point.x - pipe.x) <= clearance))) return false;
  let beam: { y: number; vy: number; mask: number; flaps: boolean[] }[] = [{ y: entryY, vy: entryVy, mask: 0, flaps: [] }];
  let traveled = 0;
  for (let tick = 0; tick < 300; tick++) {
    traveled += config.pipes.maxSpeed;
    const next = new Map<string, { y: number; vy: number; mask: number; flaps: boolean[] }>();
    for (const node of beam) for (const flap of [false, true]) {
      const vy = Math.min(config.flight.maxFallSpeed, (flap ? config.flight.flapVelocity : node.vy) + config.flight.gravity);
      const y = node.y + vy;
      if (y - config.flight.duckHalfHeight <= config.pipes.ceilingY || y + config.flight.duckHalfHeight >= config.pipes.floorY) continue;
      if (course.some(pipe => (pipe.obstacles ?? []).some(obstacle => {
        const x = pipe.x - traveled + obstacle.xOffset;
        return Math.abs(x - config.flight.duckX) <= obstacle.width / 2 + config.flight.duckHalfWidth &&
          y + config.flight.duckHalfHeight >= obstacle.y && y - config.flight.duckHalfHeight <= obstacle.y + obstacle.height;
      }))) continue;
      let mask = node.mask;
      points.forEach((point, index) => {
        if (Math.abs(point.x - traveled - config.flight.duckX) <= 7_000 + config.flight.duckHalfWidth &&
            Math.abs(point.y - y) <= 7_000 + config.flight.duckHalfHeight) mask |= 1 << index;
      });
      const flaps = [...node.flaps, flap];
      if (mask === (bonus ? 7 : 0) && pipes[3]!.x + config.pipes.width / 2 - traveled < config.flight.duckX - config.flight.duckHalfWidth) {
        let replay: RunState = { ...state, phase: "RUNNING", tick: 2_700, score: 100, pipes: course, nextPipeX: 2_000_000,
          nextSpawnPipeIndex: pipes[3]!.index + 1, nextStarPipeIndex: 10_000,
          duck: { ...state.duck, y: entryY, vy: entryVy }, collectibles: points.map((point, index) => ({
            id: `figure-${index}`, typeId: "FEATHER", ...point, radius: 7_000, amount: 1, collected: false,
          })) };
        let collected = 0;
        for (const action of flaps) {
          const result = step(replay, action ? [makeInput(replay.nextInputSequence, "FLAP")] : []);
          collected += result.events.filter(event => event.type === "CurrencyCollected").length;
          replay = result.state;
          if (replay.phase === "DEAD") return false;
        }
        return collected === points.length;
      }
      next.set(`${y}:${vy}:${mask}`, { y, vy, mask, flaps });
    }
    beam = [...next.values()];
    if (beam.length === 0) return false;
    if (beam.length > 1_200) {
      const target = bonus && pipes[2]!.x - traveled < config.flight.duckX && points[0]!.x - traveled > config.flight.duckX - 20_000
        ? points[0]!.y : course.find(pipe => pipe.x - traveled >= config.flight.duckX)?.gapCenter ?? pipes[3]!.gapCenter;
      beam = beam.sort((a, b) => (Math.abs(a.y - target) + Math.abs(a.vy) * 4 - a.mask * 100_000) -
        (Math.abs(b.y - target) + Math.abs(b.vy) * 4 - b.mask * 100_000)).slice(0, 1_200);
    }
  }
  return false;
}

describe("catalog-11 bonus coin figure", () => {
  it("keeps every figure clear of pipes and collectible while flying through", () => {
    for (const seed of [0, 2, 5, 18]) {
      const block = [6, 7, 8].find(value => isScheduledBonusBlock(BASE_BONUS_DEFAULT_CONFIG, seed, value))!;
      expect(collectBonusAtMaxSpeed(seed, block, 280_000), `seed ${seed}`).toBe(true);
    }
  }, 30_000);
});

describe("catalog-12 varied base", () => {
  it("matches shared vectors and retains catalog-11 replay", async () => {
    const { readFileSync } = await import("node:fs");
    const fixture = JSON.parse(readFileSync("contracts/simulation/varied-base-v1.json", "utf8")) as {
      cases: { seed: number; block: number; centers: number[]; spacings: number[] }[];
    };
    for (const example of fixture.cases) {
      const pipes = preparedBlock(example.seed, example.block, DEFAULT_CONFIG).pipes.slice(0, 4);
      expect(pipes.map(pipe => pipe.gapCenter)).toEqual(example.centers);
      expect(pipes.map(pipe => pipe.stationSpacing)).toEqual(example.spacings);
    }
    const old = createRunDescriptor({ runId: "catalog-eleven", seed: 42 }, BASE_BONUS_DEFAULT_CONFIG);
    expect(old).toMatchObject({ simulationVersion: "3.0.0", generatorVersion: "3.0.0", configId: "dd-v3-base-bonus-v1" });
    expect(createRun(old).config).toEqual(BASE_BONUS_DEFAULT_CONFIG);
  });
  it("moves base openings visibly in both directions without forced alternation", () => {
    let positive = 0, negative = 0, repeatedDirection = 0;
    for (let seed = 0; seed < 128; seed++) for (const entry of [160_000, 280_000, 400_000]) {
      const pipes = preparedBlock(seed, 2, DEFAULT_CONFIG, entry).pipes.slice(0, 4);
      const centers = [entry, ...pipes.map(pipe => pipe.gapCenter)];
      const deltas = centers.slice(1).map((value, index) => value - centers[index]!);
      for (const delta of deltas) {
        expect(Math.abs(delta)).toBeGreaterThanOrEqual(30_000);
        expect(Math.abs(delta)).toBeLessThanOrEqual(70_000);
        if (delta > 0) positive++; else negative++;
      }
      repeatedDirection += deltas.slice(1).filter((delta, index) => delta * deltas[index]! > 0).length;
      expect(pipes.map(pipe => pipe.stationSpacing)).toEqual([126_400, 126_400, 126_400, 126_400]);
      expect(pipes.every(pipe => pipe.gapCenter >= DEFAULT_CONFIG.pipes.gapMinCenter && pipe.gapCenter <= DEFAULT_CONFIG.pipes.gapMaxCenter)).toBe(true);
    }
    expect(positive).toBeGreaterThan(100);
    expect(negative).toBeGreaterThan(100);
    expect(repeatedDirection).toBeGreaterThan(100);
  });
  it("keeps custom narrow bounds and the first-pipe lead-in safe", () => {
    const config: GameConfig = { ...DEFAULT_CONFIG, pipes: { ...DEFAULT_CONFIG.pipes,
      gapMinCenter: 240_000, gapMaxCenter: 320_000, maxGapDelta: 80_000 },
      wetland: { ...DEFAULT_CONFIG.wetland!, families: DEFAULT_CONFIG.wetland!.families.map(family => ({ ...family,
        gapCenters: [280_000, 280_000, 280_000, 280_000] })) } };
    expect(validateConfig(config)).toBe(config);
    for (let seed = 0; seed < 64; seed++) for (const entry of [240_000, 280_000, 320_000]) {
      const pipes = preparedBlock(seed, 2, config, entry).pipes.slice(0, 4);
      let previous = entry;
      for (const pipe of pipes) {
        expect(pipe.gapCenter).toBeGreaterThanOrEqual(config.pipes.gapMinCenter);
        expect(pipe.gapCenter).toBeLessThanOrEqual(config.pipes.gapMaxCenter);
        expect(Math.abs(pipe.gapCenter - previous)).toBeGreaterThanOrEqual(30_000);
        expect(Math.abs(pipe.gapCenter - previous)).toBeLessThanOrEqual(config.pipes.maxGapDelta);
        previous = pipe.gapCenter;
      }
      const first = createRun(createRunDescriptor({ runId: `first-${seed}`, seed }));
      expect(first.pipes[0]!.x).toBe(DEFAULT_CONFIG.pipes.safeLeadIn);
      expect(Math.abs(first.pipes[0]!.gapCenter - 280_000)).toBeLessThanOrEqual(35_000);
    }
  });
  it("collects all four mirrored hard patterns under the varied-base rules", () => {
    for (const seed of [0, 2, 5, 18]) {
      const block = [6, 7, 8].find(value => isScheduledBonusBlock(DEFAULT_CONFIG, seed, value))!;
      expect(collectBonusAtMaxSpeed(seed, block, 280_000, DEFAULT_CONFIG, true), `bonus ${seed}`).toBe(true);
    }
  }, 30_000);
  it("replays max-speed base changes and collects bonus figures", () => {
    for (const [seed, y, vy] of [[0, 240_000, -2_000], [1, 280_000, 0], [42, 320_000, 2_000], [99, 280_000, -2_000]] as const) {
      expect(collectBonusAtMaxSpeed(seed, 2, y, DEFAULT_CONFIG, false, vy), `base ${seed}/${y}/${vy}`).toBe(true);
      const block = [6, 7, 8].find(value => isScheduledBonusBlock(DEFAULT_CONFIG, seed, value))!;
      expect(collectBonusAtMaxSpeed(seed, block, y, DEFAULT_CONFIG, true, vy), `bonus ${seed}/${y}/${vy}`).toBe(true);
    }
  }, 30_000);
});
