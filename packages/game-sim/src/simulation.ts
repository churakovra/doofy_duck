import { configIdFor } from "./canonical.js";
import { bonusY, currencyFormationPoints, generateNext, isBonusSegmentBlock, isScheduledBonusBlock, isCoinCourseBlock, worldSpeedAt } from "./generation.js";
import { deepFreeze, incrementCounter } from "./internal.js";
import { VARIED_BASE_DEFAULT_CONFIG, BONUS_SEGMENTS_DEFAULT_CONFIG, BONUS_SEGMENTS_V2_DEFAULT_CONFIG, VARIED_PIPES_DEFAULT_CONFIG, PRESSURE_PIPES_DEFAULT_CONFIG, DENSE_PIPES_DEFAULT_CONFIG, BASE_BONUS_DEFAULT_CONFIG, COIN_COURSE_DEFAULT_CONFIG, CURRENCY_FORMATIONS_DEFAULT_CONFIG, DEFAULT_CONFIG, LEGACY_DEFAULT_CONFIG, PAIRED_ROUTES_DEFAULT_CONFIG, PRIOR_DEFAULT_CONFIG, VARIED_OBSTACLE_DEFAULT_CONFIG, WETLAND_DEFAULT_CONFIG, validateConfig, validateDescriptor } from "./config.js";
import { VARIED_BASE_CONFIG_ID, VARIED_BASE_GENERATOR_VERSION, VARIED_BASE_SIMULATION_VERSION, mix32, BONUS_SEGMENTS_CONFIG_ID, BONUS_SEGMENTS_V2_CONFIG_ID, VARIED_PIPES_CONFIG_ID, PRESSURE_PIPES_CONFIG_ID, DENSE_PIPES_CONFIG_ID, BASE_BONUS_CONFIG_ID, BASE_BONUS_SIMULATION_VERSION, BASE_BONUS_GENERATOR_VERSION, DENSE_PIPES_SIMULATION_VERSION, DENSE_PIPES_GENERATOR_VERSION, PRESSURE_PIPES_SIMULATION_VERSION, PRESSURE_PIPES_GENERATOR_VERSION, VARIED_PIPES_SIMULATION_VERSION, VARIED_PIPES_GENERATOR_VERSION, BONUS_SEGMENTS_V2_SIMULATION_VERSION, BONUS_SEGMENTS_V2_GENERATOR_VERSION, BONUS_SEGMENTS_GENERATOR_VERSION, BONUS_SEGMENTS_SIMULATION_VERSION, COIN_COURSE_CONFIG_ID, COIN_COURSE_GENERATOR_VERSION, COIN_COURSE_SIMULATION_VERSION, CURRENCY_FORMATIONS_CONFIG_ID, CURRENCY_FORMATIONS_GENERATOR_VERSION, CURRENCY_FORMATIONS_SIMULATION_VERSION, SIMULATION_VERSION, GENERATOR_VERSION, PAIRED_ROUTES_CONFIG_ID, PAIRED_ROUTES_GENERATOR_VERSION, PAIRED_ROUTES_SIMULATION_VERSION, LEGACY_DEFAULT_CONFIG_ID, LEGACY_SIMULATION_VERSION, LEGACY_GENERATOR_VERSION, PRIOR_DEFAULT_CONFIG_ID, PRIOR_SIMULATION_VERSION, PRIOR_GENERATOR_VERSION, VARIED_OBSTACLE_DEFAULT_CONFIG_ID, VARIED_OBSTACLE_GENERATOR_VERSION, VARIED_OBSTACLE_SIMULATION_VERSION, WETLAND_DEFAULT_CONFIG_ID, WETLAND_GENERATOR_VERSION, WETLAND_SIMULATION_VERSION, type Collectible, type GameConfig, type InputFrame, type Phase, type RunDescriptor, type RunDescriptorIdentity, type RunState, type StepResult, type GameEvent } from "./types.js";

export function createRunDescriptor(
  identity: RunDescriptorIdentity,
  config: GameConfig = DEFAULT_CONFIG,
): RunDescriptor {
  const configId = configIdFor(config);
  const legacy = configId === LEGACY_DEFAULT_CONFIG_ID;
  const prior = configId === PRIOR_DEFAULT_CONFIG_ID;
  const wetland = configId === WETLAND_DEFAULT_CONFIG_ID;
  const coinCourse = config.wetland?.catalogVersion === 5;
  const bonusSegments = config.wetland?.catalogVersion === 6;
  const variedBase = config.wetland?.catalogVersion === 12;
  const baseBonus = config.wetland?.catalogVersion === 11;
  const densePipes = config.wetland?.catalogVersion === 10;
  const pressurePipes = config.wetland?.catalogVersion === 9;
  const variedPipes = config.wetland?.catalogVersion === 8;
  const bonusSegmentsV2 = config.wetland?.catalogVersion === 7;
  const currencyFormations = config.wetland?.catalogVersion === 4;
  const paired = config.wetland?.catalogVersion === 3;
  const varied = config.wetland?.catalogVersion === 2;
  return {
    ...identity,
    simulationVersion: variedBase ? VARIED_BASE_SIMULATION_VERSION : baseBonus ? BASE_BONUS_SIMULATION_VERSION : densePipes ? DENSE_PIPES_SIMULATION_VERSION : pressurePipes ? PRESSURE_PIPES_SIMULATION_VERSION : variedPipes ? VARIED_PIPES_SIMULATION_VERSION : bonusSegmentsV2 ? BONUS_SEGMENTS_V2_SIMULATION_VERSION : bonusSegments ? BONUS_SEGMENTS_SIMULATION_VERSION : coinCourse ? COIN_COURSE_SIMULATION_VERSION : currencyFormations ? CURRENCY_FORMATIONS_SIMULATION_VERSION : legacy ? LEGACY_SIMULATION_VERSION : prior ? PRIOR_SIMULATION_VERSION : wetland ? WETLAND_SIMULATION_VERSION : varied ? VARIED_OBSTACLE_SIMULATION_VERSION : paired ? PAIRED_ROUTES_SIMULATION_VERSION : SIMULATION_VERSION,
    generatorVersion: variedBase ? VARIED_BASE_GENERATOR_VERSION : baseBonus ? BASE_BONUS_GENERATOR_VERSION : densePipes ? DENSE_PIPES_GENERATOR_VERSION : pressurePipes ? PRESSURE_PIPES_GENERATOR_VERSION : variedPipes ? VARIED_PIPES_GENERATOR_VERSION : bonusSegmentsV2 ? BONUS_SEGMENTS_V2_GENERATOR_VERSION : bonusSegments ? BONUS_SEGMENTS_GENERATOR_VERSION : coinCourse ? COIN_COURSE_GENERATOR_VERSION : currencyFormations ? CURRENCY_FORMATIONS_GENERATOR_VERSION : legacy ? LEGACY_GENERATOR_VERSION : prior ? PRIOR_GENERATOR_VERSION : wetland ? WETLAND_GENERATOR_VERSION : varied ? VARIED_OBSTACLE_GENERATOR_VERSION : paired ? PAIRED_ROUTES_GENERATOR_VERSION : GENERATOR_VERSION,
    configId,
  };
}

export function createRun(
  descriptor: RunDescriptor,
  config?: GameConfig,
): RunState {
  validateDescriptor(descriptor);
  const resolvedConfig = config ?? (descriptor.configId === VARIED_BASE_CONFIG_ID ? VARIED_BASE_DEFAULT_CONFIG : descriptor.configId === BASE_BONUS_CONFIG_ID ? BASE_BONUS_DEFAULT_CONFIG : descriptor.configId === DENSE_PIPES_CONFIG_ID ? DENSE_PIPES_DEFAULT_CONFIG : descriptor.configId === PRESSURE_PIPES_CONFIG_ID ? PRESSURE_PIPES_DEFAULT_CONFIG : descriptor.configId === VARIED_PIPES_CONFIG_ID ? VARIED_PIPES_DEFAULT_CONFIG : descriptor.configId === BONUS_SEGMENTS_V2_CONFIG_ID ? BONUS_SEGMENTS_V2_DEFAULT_CONFIG : descriptor.configId === BONUS_SEGMENTS_CONFIG_ID ? BONUS_SEGMENTS_DEFAULT_CONFIG : descriptor.configId === COIN_COURSE_CONFIG_ID ? COIN_COURSE_DEFAULT_CONFIG : descriptor.configId === CURRENCY_FORMATIONS_CONFIG_ID ? CURRENCY_FORMATIONS_DEFAULT_CONFIG : descriptor.configId === LEGACY_DEFAULT_CONFIG_ID ? LEGACY_DEFAULT_CONFIG : descriptor.configId === PRIOR_DEFAULT_CONFIG_ID ? PRIOR_DEFAULT_CONFIG : descriptor.configId === WETLAND_DEFAULT_CONFIG_ID ? WETLAND_DEFAULT_CONFIG : descriptor.configId === VARIED_OBSTACLE_DEFAULT_CONFIG_ID ? VARIED_OBSTACLE_DEFAULT_CONFIG : descriptor.configId === PAIRED_ROUTES_CONFIG_ID ? PAIRED_ROUTES_DEFAULT_CONFIG : DEFAULT_CONFIG);
  validateConfig(resolvedConfig);
  if (descriptor.configId !== configIdFor(resolvedConfig))
    throw Error("configId does not identify supplied config");
  if (resolvedConfig.wetland?.catalogVersion === 2 &&
      (descriptor.simulationVersion !== VARIED_OBSTACLE_SIMULATION_VERSION || descriptor.generatorVersion !== VARIED_OBSTACLE_GENERATOR_VERSION))
    throw Error("catalog-2 wetland config requires the frozen varied-obstacle simulation and generator versions");
  if (resolvedConfig.wetland?.catalogVersion === 3 &&
      (descriptor.simulationVersion !== PAIRED_ROUTES_SIMULATION_VERSION || descriptor.generatorVersion !== PAIRED_ROUTES_GENERATOR_VERSION))
    throw Error("catalog-3 wetland config requires the current simulation and generator versions");
  if (resolvedConfig.wetland?.catalogVersion === 4 &&
      (descriptor.simulationVersion !== CURRENCY_FORMATIONS_SIMULATION_VERSION || descriptor.generatorVersion !== CURRENCY_FORMATIONS_GENERATOR_VERSION))
    throw Error("catalog-4 wetland config requires the currency-formation simulation and generator versions");
  if (resolvedConfig.wetland?.catalogVersion === 5 &&
      (descriptor.simulationVersion !== COIN_COURSE_SIMULATION_VERSION || descriptor.generatorVersion !== COIN_COURSE_GENERATOR_VERSION))
    throw Error("catalog-5 wetland config requires the coin-course simulation and generator versions");
  if (resolvedConfig.wetland?.catalogVersion === 6 &&
      (descriptor.simulationVersion !== BONUS_SEGMENTS_SIMULATION_VERSION || descriptor.generatorVersion !== BONUS_SEGMENTS_GENERATOR_VERSION))
    throw Error("catalog-6 wetland config requires the bonus-segments simulation and generator versions");
  if (resolvedConfig.wetland?.catalogVersion === 7 &&
      (descriptor.simulationVersion !== BONUS_SEGMENTS_V2_SIMULATION_VERSION || descriptor.generatorVersion !== BONUS_SEGMENTS_V2_GENERATOR_VERSION))
    throw Error("catalog-7 wetland config requires the bonus-segments-v2 simulation and generator versions");
  if (resolvedConfig.wetland?.catalogVersion === 8 &&
      (descriptor.simulationVersion !== VARIED_PIPES_SIMULATION_VERSION || descriptor.generatorVersion !== VARIED_PIPES_GENERATOR_VERSION))
    throw Error("catalog-8 wetland config requires varied-pipes versions");
  if (resolvedConfig.wetland?.catalogVersion === 9 &&
      (descriptor.simulationVersion !== PRESSURE_PIPES_SIMULATION_VERSION || descriptor.generatorVersion !== PRESSURE_PIPES_GENERATOR_VERSION))
    throw Error("catalog-9 wetland config requires pressure-pipes versions");
  if (resolvedConfig.wetland?.catalogVersion === 10 &&
      (descriptor.simulationVersion !== DENSE_PIPES_SIMULATION_VERSION || descriptor.generatorVersion !== DENSE_PIPES_GENERATOR_VERSION))
    throw Error("catalog-10 wetland config requires dense-pipes versions");
  if (resolvedConfig.wetland?.catalogVersion === 11 &&
      (descriptor.simulationVersion !== BASE_BONUS_SIMULATION_VERSION || descriptor.generatorVersion !== BASE_BONUS_GENERATOR_VERSION))
    throw Error("catalog-11 wetland config requires base-bonus versions");
  if (resolvedConfig.wetland?.catalogVersion === 12 &&
      (descriptor.simulationVersion !== VARIED_BASE_SIMULATION_VERSION || descriptor.generatorVersion !== VARIED_BASE_GENERATOR_VERSION))
    throw Error("catalog-12 wetland config requires varied-base versions");
  if (resolvedConfig.wetland?.catalogVersion === 13 &&
      (descriptor.simulationVersion !== SIMULATION_VERSION || descriptor.generatorVersion !== GENERATOR_VERSION))
    throw Error("catalog-13 requires curved-pipes versions");
  const ownedConfig = cloneConfig(resolvedConfig);
  const starSchedule = ownedConfig.starSchedule;
  const starInterval = starSchedule ? seededStarInterval(descriptor.seed, 0, starSchedule.minIntervalPipes, starSchedule.maxIntervalPipes) : undefined;
  const s: RunState = {
    descriptor: deepFreeze({ ...descriptor }),
    config: deepFreeze(ownedConfig),
    phase: "READY",
    tick: 0,
    duck: {
      x: ownedConfig.flight.duckX,
      y: Math.floor((ownedConfig.pipes.floorY + ownedConfig.pipes.ceilingY) / 2),
      vy: 0,
    },
    pipes: [],
    collectibles: [],
    score: 0,
    totals: {},
    rngState: descriptor.seed >>> 0,
    nextPipeIndex: 0,
    lastGapCenter: Math.floor((ownedConfig.pipes.gapMinCenter + ownedConfig.pipes.gapMaxCenter) / 2),
    nextInputSequence: 0,
    lastCollectiblePipe: -1000000,
    nextSpawnPipeIndex: 0,
    ...(starInterval === undefined ? {} : { nextStarPipeIndex: starInterval, starScheduleOrdinal: 0 }),
    inputHistory: [],
    finalizationCount: 0,
  };
  return generateNext(s).state;
}
function stationRightEdge(pipe: RunState["pipes"][number], config: GameConfig): number {
  if (config.wetland && pipe.obstacles?.length)
    return Math.max(...pipe.obstacles.map(obstacle => pipe.x + obstacle.xOffset + Math.floor(obstacle.width / 2)));
  return pipe.x + Math.floor(config.pipes.width / 2);
}
function stationRenderRightEdge(pipe: RunState["pipes"][number], config: GameConfig): number {
  return stationRightEdge(pipe, config) + config.pipes.width;
}
function cloneConfig(config: GameConfig): GameConfig {
  const { starSchedule, ...base } = config;
  return {
    ...base,
    flight: { ...config.flight },
    pipes: { ...config.pipes },
    limits: { ...config.limits },
    collectibles: config.collectibles.map((definition) => ({ ...definition })),
    challenges: config.challenges == null ? null : {
      ...config.challenges,
      cruiseFamilyIds: [...config.challenges.cruiseFamilyIds],
      pressureFamilyIds: [...config.challenges.pressureFamilyIds],
      families: config.challenges.families.map(family => ({ ...family, gapCenters: [...family.gapCenters] })),
    },
    ...(config.wetland == null ? {} : { wetland: { ...config.wetland, stationSpacing: [...config.wetland.stationSpacing], introFamilies: [...config.wetland.introFamilies], pressureFamilies: [...config.wetland.pressureFamilies], ...(config.wetland.introLaneCenters === undefined ? {} : { introLaneCenters: [...config.wetland.introLaneCenters] }), ...(config.wetland.geometry === undefined ? {} : { geometry: { ...config.wetland.geometry } }), starRoute: { ...config.wetland.starRoute }, families: config.wetland.families.map(family => ({ ...family, gapCenters: [...family.gapCenters], obstacleTypes: [...family.obstacleTypes], stationSpacing: [...family.stationSpacing], rewardRoute: family.rewardRoute.map(point => ({ ...point })) })) } }),
    ...(starSchedule == null ? {} : { starSchedule: { ...starSchedule } }),
  };
}
function seededStarInterval(seed: number, ordinal: number, minimum: number, maximum: number): number {
  const sample = mix32((seed ^ Math.imul(ordinal + 1, 0x27d4eb2d)) >>> 0);
  return minimum + sample % (maximum - minimum + 1);
}
export function step(
  input: RunState,
  frames: readonly InputFrame[],
): StepResult {
  if (input.phase === "DEAD" || input.phase === "PAUSED")
    return { state: input, events: [] };
  for (const counter of [input.tick, input.score, input.nextInputSequence, input.nextPipeIndex, input.nextSpawnPipeIndex]) incrementCounter(counter);
  if (input.nextStarPipeIndex !== undefined) incrementCounter(input.nextStarPipeIndex);
  if (input.starScheduleOrdinal !== undefined) incrementCounter(input.starScheduleOrdinal);
  if (!Array.isArray(frames) || frames.length > 64) throw Error("input batch limit exceeded");
  let expected = input.nextInputSequence;
  for (const f of frames) {
    if (!Number.isSafeInteger(f.sequence) || f.sequence !== expected || f.action !== "FLAP")
      throw Error("input sequence must be contiguous");
    expected = incrementCounter(expected);
  }
  const events: GameEvent[] = [];
  let phase: Phase = input.phase,
    y = input.duck.y,
    vy = input.duck.vy;
  if (phase === "READY") {
    if (!frames.length)
      return {
        state: deepFreeze({ ...input, nextInputSequence: expected }),
        events,
      };
    phase = "RUNNING";
    events.push({
      type: "RunStarted",
      runId: input.descriptor.runId,
      tick: input.tick + 1,
    });
  }
  if (frames.length) vy = input.config.flight.flapVelocity;
  vy = Math.min(
    input.config.flight.maxFallSpeed,
    vy + input.config.flight.gravity,
  );
  y += vy;
  const pc = input.config.pipes,
    f = input.config.flight,
    speed = worldSpeedAt(input.config, input.tick + 1, input.score),
    pipes = input.pipes.map((p) => ({ ...p, x: p.x - speed })),
    duck = { x: f.duckX, y, vy };
  const dead =
    y - f.duckHalfHeight <= pc.ceilingY ||
    y + f.duckHalfHeight >= pc.floorY ||
    pipes.some((p) => {
      const l = p.x - Math.floor(pc.width / 2),
        r = p.x + Math.floor(pc.width / 2),
        dl = duck.x - f.duckHalfWidth,
        dr = duck.x + f.duckHalfWidth;
      if (input.config.wetland && p.obstacles?.length) return p.obstacles.some(obstacle =>
        dr >= obstacle.xOffset + p.x - Math.floor(obstacle.width / 2) &&
        dl <= obstacle.xOffset + p.x + Math.floor(obstacle.width / 2) &&
        y + f.duckHalfHeight >= obstacle.y && y - f.duckHalfHeight <= obstacle.y + obstacle.height,
      );
      return (
        dr >= l &&
        dl <= r &&
        (y - f.duckHalfHeight <= p.gapCenter - Math.floor(pc.gapHeight / 2) ||
          y + f.duckHalfHeight >= p.gapCenter + Math.floor(pc.gapHeight / 2))
      );
    });
  let score = input.score,
    outPipes = pipes;
  if (dead) {
    phase = "DEAD";
    events.push({
      type: "RunEnded",
      runId: input.descriptor.runId,
      score,
      totals: input.totals,
      tick: input.tick + 1,
    });
  } else
    outPipes = pipes.map((p) => {
      if (
        !p.scored &&
        stationRightEdge(p, input.config) < duck.x - f.duckHalfWidth
      ) {
        score = incrementCounter(score);
        events.push(input.config.wetland
          ? { type: "ObstaclePassed", runId: input.descriptor.runId, stationId: p.stationId ?? p.id, score, tick: input.tick + 1 }
          : { type: "PipePassed", runId: input.descriptor.runId, pipeId: p.id, score, tick: input.tick + 1 });
        return { ...p, scored: true };
      }
      return p;
    });
  let next: RunState = {
    ...input,
    phase,
    tick: input.tick + 1,
    duck,
    pipes: outPipes.filter((p) => input.config.wetland
      ? input.config.wetland.catalogVersion >= 2
        ? stationRenderRightEdge(p, input.config) >= 0
        : stationRightEdge(p, input.config) >= duck.x - f.duckHalfWidth
      : p.x + pc.width >= -pc.width),
    ...(input.config.wetland && input.nextPipeX !== undefined
      ? { nextPipeX: input.nextPipeX - speed }
      : {}),
    score,
    nextInputSequence: expected,
    inputHistory: [],
    finalizationCount: dead
      ? input.finalizationCount + 1
      : input.finalizationCount,
  };
  if (phase === "RUNNING") {
    next = generateNext(next).state;
    let nextSpawnPipeIndex = next.nextSpawnPipeIndex;
    let nextStarPipeIndex = next.nextStarPipeIndex;
    let starScheduleOrdinal = next.starScheduleOrdinal;
    let rngState = next.rngState;
    const spawnedThisTick = new Set<string>();
    for (const pipe of next.pipes) {
      if (pipe.index < nextSpawnPipeIndex) continue;
      nextSpawnPipeIndex = incrementCounter(pipe.index);


      const definitions = next.config.collectibles.filter(
        (definition) =>
          pipe.index >= definition.minPipeIndex &&
          pipe.index - next.lastCollectiblePipe >= definition.minSpacingPipes,
      );
      const totalWeight =
        next.config.spawnNoneWeight +
        definitions.reduce((total, definition) => total + definition.weight, 0);
      if (!Number.isSafeInteger(totalWeight) || totalWeight < 0)
        throw Error("spawn table weight must have a nonnegative safe-integer total");
      const sample = mix32(rngState);
      rngState = (rngState + 0x9e3779b9) >>> 0;
      const roll = totalWeight === 0 ? 0 : sample % totalWeight;
      let cumulative = next.config.spawnNoneWeight;
      const chosen = totalWeight === 0 || roll < next.config.spawnNoneWeight ? undefined : definitions.find((definition) => {
        cumulative += definition.weight;
        return definition.weight > 0 && roll < cumulative;
      });
      const scheduledStar = next.config.starSchedule != null && pipe.index === nextStarPipeIndex;
      const block = Math.floor(pipe.index / 4);
      const coinCourse = next.config.wetland?.catalogVersion === 5 && isCoinCourseBlock(input.descriptor.seed, block);
      const bonusSegment = next.config.wetland?.catalogVersion === 6 && isBonusSegmentBlock(input.descriptor.seed, block);
      const bonusSegmentV2 = (next.config.wetland?.catalogVersion ?? 0) >= 7 && isScheduledBonusBlock(next.config, input.descriptor.seed, block);
      const wetlandRecovery = pipe.encounterFamily === "steady" && block >= 2 && block % 2 === 1;
      const wetlandSmallTrail = pipe.encounterFamily === "steady" && (block === 0 || wetlandRecovery);
      const wetlandTrail = next.config.wetland != null && next.config.wetland.catalogVersion <= 5 && (coinCourse
        ? pipe.stationStep === 2
        : wetlandSmallTrail ? pipe.stationStep === 1 || pipe.stationStep === 3 : true);
      const bonusSegmentReward = (bonusSegment || bonusSegmentV2) && pipe.stationStep === 2;
      const featherPoints = wetlandTrail || bonusSegmentReward
        ? currencyFormationPoints(next.config, input.descriptor.seed, pipe, next.config.collectibles.find(item => item.typeId === "FEATHER")!.radius)
        : [];
      if ((wetlandTrail || bonusSegmentReward) && next.collectibles.length + featherPoints.length > next.config.limits.maxActiveCollectibles)
        throw Error("wetland reward capacity invariant violated");
      if (wetlandTrail || bonusSegmentReward) {
        const definition = next.config.collectibles.find(item => item.typeId === "FEATHER")!;
        next = { ...next, collectibles: [...next.collectibles, ...featherPoints.map((point, member) => {
          const collectibleId = bonusSegmentReward
            ? `bonus-segment-${block}-${member}`
            : `feather-trail-${block}-${pipe.stationStep}${(next.config.wetland?.catalogVersion ?? 0) >= 4 ? `-${member}` : ""}`;
          spawnedThisTick.add(collectibleId);
          return { id: collectibleId, typeId: "FEATHER", ...point, amount: 1, radius: definition.radius, collected: false };
        })] };
      }
      if (scheduledStar) {
        const activeStars = next.collectibles.filter(collectible => collectible.typeId === "GAME_STAR").length;
        const definition = next.config.collectibles.find(item => item.typeId === "GAME_STAR")!;
        const starPoints = next.config.wetland
          ? currencyFormationPoints(next.config, input.descriptor.seed, pipe, definition.radius, true, starScheduleOrdinal ?? 0)
          : [{ x: pipe.x, y: bonusY(next.config, input.descriptor.seed, pipe, definition.radius) }];
        if (activeStars > 0 || next.collectibles.length + starPoints.length > next.config.limits.maxActiveCollectibles)
          throw Error("scheduled Star capacity invariant violated");
        const schedule = next.config.starSchedule!;
        next = { ...next, collectibles: [...next.collectibles, ...starPoints.map((point, member) => {
          const collectibleId = `star-${pipe.index}${(next.config.wetland?.catalogVersion ?? 0) >= 4 ? `-${member}` : ""}`;
          spawnedThisTick.add(collectibleId);
          return { id: collectibleId, typeId: "GAME_STAR", ...point, amount: 1, radius: definition.radius, collected: false };
        })] };
        const ordinal = incrementCounter(starScheduleOrdinal ?? 0);
        const gap = seededStarInterval(input.descriptor.seed, ordinal, schedule.minIntervalPipes, schedule.maxIntervalPipes);
        nextStarPipeIndex = incrementCounter(nextStarPipeIndex ?? pipe.index, gap);
        starScheduleOrdinal = ordinal;
      }
      const regularCount = next.config.starSchedule == null
        ? next.collectibles.length
        : next.collectibles.filter(collectible => collectible.typeId !== "GAME_STAR").length;
      const ordinaryPickupAllowed = next.config.wetland == null ||
        (next.config.wetland.catalogVersion === 6 && (!bonusSegment || pipe.stationStep === 3)) ||
        (next.config.wetland.catalogVersion >= 7 && (!bonusSegmentV2 || pipe.stationStep === 3));
      if (ordinaryPickupAllowed && chosen && !scheduledStar && regularCount < next.config.limits.maxActiveCollectibles - (next.config.starSchedule == null ? 0 : 1)) {
        const collectibleId = `collectible-${pipe.index}`;
        spawnedThisTick.add(collectibleId);
        next = {
          ...next,
          collectibles: [
            ...next.collectibles,
            {
              id: `collectible-${pipe.index}`,
              typeId: chosen.typeId,
              x: pipe.x,
              y: bonusY(next.config, input.descriptor.seed, pipe, chosen.radius),
              amount: chosen.amount,
              radius: chosen.radius,
              collected: false,
            },
          ],
          lastCollectiblePipe: pipe.index,
        };
      }
    }
    next = {
      ...next,
      rngState,
      nextSpawnPipeIndex,
      ...(nextStarPipeIndex === undefined ? {} : { nextStarPipeIndex }),
      ...(starScheduleOrdinal === undefined ? {} : { starScheduleOrdinal }),
    };
    const kept: Collectible[] = [];
    for (const c of next.collectibles) {
      const moved = spawnedThisTick.has(c.id) ? c : { ...c, x: c.x - speed },
        hit =
          Math.abs(moved.x - duck.x) <= moved.radius + f.duckHalfWidth &&
          Math.abs(moved.y - y) <= moved.radius + f.duckHalfHeight;
      if (hit) {
        events.push({
          type: "CurrencyCollected",
          runId: input.descriptor.runId,
          collectibleId: c.id,
          typeId: c.typeId,
          amount: c.amount,
          tick: input.tick + 1,
        });
        next = {
          ...next,
          totals: {
            ...next.totals,
            [c.typeId]: incrementCounter(Object.hasOwn(next.totals, c.typeId) ? next.totals[c.typeId]! : 0, c.amount),
          },
        };
      } else if (moved.x + moved.radius >= 0) kept.push(moved);
    }
    next = { ...next, collectibles: kept };
  }
  return { state: deepFreeze(next), events: Object.freeze(events) };
}
export function pauseRun(s: RunState): RunState {
  if (s.phase !== "RUNNING") throw Error("only running runs can pause");
  return deepFreeze({ ...s, phase: "PAUSED" });
}
export function resumeRun(s: RunState): RunState {
  if (s.phase !== "PAUSED") throw Error("only paused runs can resume");
  return deepFreeze({ ...s, phase: "RUNNING", inputHistory: [] });
}
export function restartRun(
  s: RunState,
  d: RunDescriptor,
  c: GameConfig = s.config,
): RunState {
  if (d.runId === s.descriptor.runId)
    throw Error("restart requires a new run ID");
  return createRun(d, c);
}
