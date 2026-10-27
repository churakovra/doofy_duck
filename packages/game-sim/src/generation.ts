import { deepFreeze, incrementCounter, MAX_COUNTER } from "./internal.js";
import { validateConfig } from "./config.js";
import { mix32, type EncounterFamilyId, type GameConfig, type ObstacleDefinition, type Pipe, type RunState, type StepResult } from "./types.js";

function encounter(seed: number, block: number, intro: readonly EncounterFamilyId[], pressure: readonly EncounterFamilyId[]): EncounterFamilyId {
  if (block < intro.length) return intro[block]!;
  const pressureIndex = Math.floor((block - intro.length) / 2);
  if ((block - intro.length) % 2 === 1) return "steady";
  const offset = mix32(seed ^ 0x85ebca6b) % pressure.length;
  return pressure[(offset + pressureIndex) % pressure.length]!;
}

const COIN_COURSE_SALT = 0x6d2b79f5;
const COIN_COURSE_GATE_SPACING = 180_000;
const BONUS_SEGMENT_SCHEDULE_SALT = 0x2c1b3c6d;
const BONUS_SEGMENT_RECIPE_SALT = 0x297a2d39;
const BONUS_SEGMENT_CENTER_SALT = 0x165667b1;
const BONUS_SEGMENT_RECOVERY_CLEARANCE = 360_000;
const BONUS_SEGMENT_V2_CENTER_SALT = 0x7f4a7c15;
const BONUS_SEGMENT_V2_RECIPE_SALT = 0x6a09e667;
const BONUS_SEGMENT_V2_MIRROR_SALT = 0x3c6ef372;
const BONUS_SEGMENT_V2_CLEARANCE_PERCENT = 10;

export type BonusSegmentRecipe = "shallow-ascent" | "shallow-descent" | "shallow-slalom";

export function bonusSegmentSlot(block: number): number {
  return Math.floor((block - 2) / 3);
}

export function isBonusSegmentBlock(seed: number, block: number): boolean {
  if (!Number.isSafeInteger(block) || block < 2) return false;
  const slot = bonusSegmentSlot(block);
  const selectedBlock = 2 + slot * 3 + (mix32((seed ^ BONUS_SEGMENT_SCHEDULE_SALT ^ Math.imul(slot + 1, BONUS_SEGMENT_RECIPE_SALT)) >>> 0) % 2);
  return block === selectedBlock;
}

export function isScheduledBonusBlock(config: GameConfig, seed: number, block: number): boolean {
  if ((config.wetland?.catalogVersion ?? 0) < 11) return isBonusSegmentBlock(seed, block);
  const first = 6 + mix32((seed ^ 0x243f6a88) >>> 0) % 3;
  return block >= first && (block - first) % 7 === 0;
}

export function bonusSegmentRecipe(seed: number, block: number): BonusSegmentRecipe {
  if (!isBonusSegmentBlock(seed, block)) throw Error("bonus segment recipe requested for an unscheduled block");
  const slot = bonusSegmentSlot(block);
  const sample = mix32((seed ^ Math.imul(slot + 1, BONUS_SEGMENT_CENTER_SALT) ^ BONUS_SEGMENT_RECIPE_SALT) >>> 0);
  return (["shallow-ascent", "shallow-descent", "shallow-slalom"] as const)[sample % 3]!;
}

function bonusSegmentGapCenter(seed: number, block: number, step: number, config: GameConfig): number {
  const slot = bonusSegmentSlot(block);
  const sample = mix32((seed ^ Math.imul(slot + 1, BONUS_SEGMENT_CENTER_SALT)) >>> 0);
  const center = Math.floor((config.pipes.gapMinCenter + config.pipes.gapMaxCenter) / 2) + (sample % 5_001) - 2_500;
  const recipe = bonusSegmentRecipe(seed, block);
  const offsets = recipe === "shallow-ascent" ? [0, -2_500, -5_000]
    : recipe === "shallow-descent" ? [0, 2_500, 5_000]
      : [0, 5_000, -5_000];
  return center + (offsets[step] ?? 0);
}

export type BonusSegmentV2Recipe = "ascent" | "descent" | "slalom";

export function bonusSegmentV2Recipe(seed: number, block: number): BonusSegmentV2Recipe {
  if (!isBonusSegmentBlock(seed, block)) throw Error("bonus segment recipe requested for an unscheduled block");
  return bonusSegmentV2RecipeUnchecked(seed, block);
}

function bonusSegmentV2RecipeUnchecked(seed: number, block: number): BonusSegmentV2Recipe {
  const slot = bonusSegmentSlot(block);
  const sample = mix32((seed ^ Math.imul(slot + 1, BONUS_SEGMENT_V2_RECIPE_SALT) ^ BONUS_SEGMENT_V2_CENTER_SALT) >>> 0);
  return (["ascent", "descent", "slalom"] as const)[sample % 3]!;
}

function bonusSegmentV2Offsets(seed: number, block: number): readonly number[] {
  const recipe = bonusSegmentV2RecipeUnchecked(seed, block);
  const base = recipe === "ascent" ? [0, -40_000, -80_000]
    : recipe === "descent" ? [0, 40_000, 80_000]
      : [0, 40_000, -40_000];
  const slot = bonusSegmentSlot(block);
  const mirror = (mix32((seed ^ Math.imul(slot + 1, BONUS_SEGMENT_V2_MIRROR_SALT)) >>> 0) & 1) !== 0;
  return mirror ? base.map(offset => -offset) : base;
}

function bonusSegmentV2GapCenter(seed: number, block: number, step: number, previous: number, config: GameConfig): number {
  const p = config.pipes;
  const offsets = bonusSegmentV2Offsets(seed, block);
  if (step > 0) return previous + offsets[step]! - offsets[step - 1]!;
  const entryCenter = previous;
  const minOffset = Math.min(...offsets);
  const maxOffset = Math.max(...offsets);
  const low = Math.max(p.gapMinCenter - minOffset, entryCenter - p.maxGapDelta);
  const high = Math.min(p.gapMaxCenter - maxOffset, entryCenter + p.maxGapDelta);
  if (low > high) throw Error("bonus segment route has no legal seeded anchor");
  const slot = bonusSegmentSlot(block);
  const approachLow = Math.max(low, entryCenter - 20_000);
  const approachHigh = Math.min(high, entryCenter + 20_000);
  const anchorLow = approachLow <= approachHigh ? approachLow : low;
  const anchorHigh = approachLow <= approachHigh ? approachHigh : high;
  const sample = mix32((seed ^ Math.imul(slot + 1, BONUS_SEGMENT_V2_CENTER_SALT) ^ BONUS_SEGMENT_V2_RECIPE_SALT) >>> 0);
  const anchor = anchorLow + sample % (anchorHigh - anchorLow + 1);
  return anchor + offsets[step]!;
}

function bonusSegmentV2OrdinaryCenter(seed: number, index: number, previous: number, config: GameConfig): number {
  const low = Math.max(config.pipes.gapMinCenter, previous - 45_000);
  const high = Math.min(config.pipes.gapMaxCenter, previous + 45_000);
  const sample = mix32((seed ^ Math.imul(index + 1, BONUS_SEGMENT_V2_CENTER_SALT)) >>> 0);
  return low + sample % (high - low + 1);
}

function irregularBaseCenter(seed: number, index: number, previous: number, config: GameConfig): number {
  const p = config.pipes;
  const sample = mix32((seed ^ Math.imul(index + 1, 0x4cf5ad43)) >>> 0);
  const magnitude = Math.min(p.maxGapDelta, 30_000 + sample % 40_001);
  const direction = (sample & 0x80000000) === 0 ? 1 : -1;
  let target = previous + direction * magnitude;
  if (target < p.gapMinCenter || target > p.gapMaxCenter) target = previous - direction * magnitude;
  if (target < p.gapMinCenter || target > p.gapMaxCenter)
    target = previous - p.gapMinCenter >= p.gapMaxCenter - previous ? p.gapMinCenter : p.gapMaxCenter;
  return target;
}

function variedPipeCenter(seed: number, index: number, previous: number, recovery: boolean, config: GameConfig): number {
  const delta = Math.min(config.pipes.maxGapDelta, recovery ? 35_000 : 75_000);
  const low = Math.max(config.pipes.gapMinCenter, previous - delta);
  const high = Math.min(config.pipes.gapMaxCenter, previous + delta);
  const sample = mix32((seed ^ Math.imul(index + 1, 0x51ed270b)) >>> 0);
  return low + sample % (high - low + 1);
}

function pressurePipeCenter(seed: number, index: number, previous: number, config: GameConfig): number {
  const sample = mix32((seed ^ Math.imul(index + 1, 0x68bc21eb)) >>> 0);
  const magnitude = Math.min(config.pipes.maxGapDelta, 60_000 + sample % 20_001);
  const polarity = mix32((seed ^ Math.imul(Math.floor(index / 4) + 1, 0x27d4eb2d)) >>> 0) & 1;
  const direction = ((index + polarity) & 1) === 0 ? 1 : -1;
  let target = previous + direction * magnitude;
  if (target < config.pipes.gapMinCenter || target > config.pipes.gapMaxCenter)
    target = previous - direction * magnitude;
  return Math.max(config.pipes.gapMinCenter, Math.min(config.pipes.gapMaxCenter, target));
}

function scaledClearanceSpacing(originalSpacing: number, pipeWidth: number, percent: number): number {
  return pipeWidth + Math.floor((originalSpacing - pipeWidth) * percent / 100);
}

export function isCoinCourseBlock(seed: number, block: number): boolean {
  const first = 2 + 2 * (mix32((seed ^ COIN_COURSE_SALT) >>> 0) % 3);
  return block >= first && (block - first) % 6 === 0;
}

function coinCourseGapCenter(seed: number, block: number, step: number): number {
  const courseOrdinal = Math.floor((block - (2 + 2 * (mix32((seed ^ COIN_COURSE_SALT) >>> 0) % 3))) / 6);
  const sample = mix32((seed ^ Math.imul(courseOrdinal + 1, 0x85ebca6b) ^ COIN_COURSE_SALT) >>> 0);
  const center = 280_000 + (sample % 30_001) - 15_000;
  const direction = (sample & 0x80000000) === 0 ? 1 : -1;
  return center + (step === 1 ? direction * 18_000 : step === 2 ? -direction * 9_000 : 0);
}

function pressureLaneCenter(seed: number, block: number, config: GameConfig): number {
  const pressureOrdinal = Math.floor((block - 2) / 2);
  const topLane = (mix32((seed ^ Math.imul(pressureOrdinal + 1, 0x4cf5ad43)) >>> 0) & 1) === 1;
  return topLane ? config.pipes.gapMinCenter : config.pipes.gapMaxCenter;
}

function variedWetlandGapCenter(seed: number, block: number, step: number, family: EncounterFamilyId, config: GameConfig): number | undefined {
  const wetland = config.wetland!;
  if (block === 0 && family === "steady") {
    const edgeLane = pressureLaneCenter(seed, 2, config);
    if (edgeLane === config.pipes.gapMinCenter)
      return step === 3 ? edgeLane : config.pipes.gapMinCenter + config.pipes.gapMaxCenter - wetland.introLaneCenters![step]!;
    if (step === 3) return edgeLane;
    return wetland.introLaneCenters![step]!;
  }
  if (block === 1 && family === "quick-pairs") {
    const target = pressureLaneCenter(seed, 2, config);
    return target;
  }
  if (block >= 2 && block % 2 === 0) return pressureLaneCenter(seed, block, config);
  if (block >= 3 && block % 2 === 1 && family === "steady") {
    const from = pressureLaneCenter(seed, block - 1, config);
    const to = pressureLaneCenter(seed, block + 1, config);
    if (from === to) return from;
    const worldOffset = config.pipes.gapMinCenter - 78_000;
    if (from === config.pipes.gapMinCenter && to === config.pipes.gapMaxCenter)
      return [100_000, 220_000, 340_000, 460_000][step]! + worldOffset;
    return [430_000, 310_000, 190_000, 78_000][step]! + worldOffset;
  }
  return undefined;
}

function authoredObstacles(typeId: "pipes" | "vine" | "rock" | "debris", gapCenter: number, config: GameConfig, seed: number, index: number): readonly ObstacleDefinition[] {
  const p = config.pipes;
  const half = Math.floor(p.gapHeight / 2);
  const openingTop = gapCenter - half;
  const openingBottom = gapCenter + half;
  const width = p.width;
  if (typeId === "pipes") return [
    { typeId, xOffset: 0, y: p.ceilingY, width, height: openingTop - p.ceilingY },
    { typeId, xOffset: 0, y: openingBottom, width, height: p.floorY - openingBottom },
  ];
  if (config.wetland?.catalogVersion !== 2) {
    if (typeId === "vine") return [{ typeId, xOffset: 0, y: p.ceilingY, width, height: openingTop - p.ceilingY }];
    if (typeId === "rock") return [{ typeId, xOffset: 0, y: openingBottom, width, height: p.floorY - openingBottom }];
    const height = 42000;
    return [{ typeId, xOffset: 0, y: gapCenter - Math.floor(height / 2), width, height }];
  }
  const geometry = config.wetland?.geometry;
  if (!geometry) throw Error("varied wetland geometry is required");
  const sample = (salt: number) => mix32((seed ^ Math.imul(index + 1, salt)) >>> 0);
  if (typeId === "vine" || typeId === "rock") {
    const maximumPercent = typeId === "vine" ? Math.min(88, geometry.halfPipeMaxPercent) : geometry.halfPipeMaxPercent;
    const effectiveMaximum = Math.min(geometry.halfPipeMaxPercent, maximumPercent);
    const effectiveMinimum = Math.min(geometry.halfPipeMinPercent, effectiveMaximum);
    const percent = effectiveMinimum + sample(0x27d4eb2d) % (effectiveMaximum - effectiveMinimum + 1);
    const playableHeight = p.floorY - p.ceilingY;
    const height = Math.floor(playableHeight * percent / 100);
    return [{ typeId, xOffset: 0, y: typeId === "vine" ? p.ceilingY : p.floorY - height, width, height }];
  }
  const widthSample = sample(0x165667b1);
  const widthBucket = widthSample % 64;
  const barWidth = widthBucket === 0 ? geometry.floatingBarMinWidth : widthBucket === 1 ? geometry.floatingBarMaxWidth :
    geometry.floatingBarMinWidth + widthSample % (geometry.floatingBarMaxWidth - geometry.floatingBarMinWidth + 1);
  const minCenter = p.ceilingY + 90_000;
  const maxCenter = p.floorY - 90_000;
  const center = minCenter + sample(0xd3a2646c) % (maxCenter - minCenter + 1);
  return [{ typeId, xOffset: 0, y: center - Math.floor(geometry.floatingBarHeight / 2), width: barWidth, height: geometry.floatingBarHeight }];
}

export function generateNext(s: RunState): StepResult {
  const pipes = [...s.pipes];
  let rng = s.rngState,
    index = s.nextPipeIndex;
  const spacing = s.config.pipes.spacing;
  const challenge = s.config.challenges;
  const challengeFamilies = challenge ? new Map(challenge.families.map(family => [family.id, family])) : undefined;
  let previousGap = s.lastGapCenter;
  let x = s.config.wetland && s.nextPipeX !== undefined
    ? s.nextPipeX
    : pipes.length
      ? pipes[pipes.length - 1]!.x + (pipes[pipes.length - 1]!.stationSpacing ?? spacing)
      : s.nextPipeX ?? s.config.pipes.safeLeadIn;
  while (
    pipes.length < s.config.limits.maxActivePipes &&
    x <= s.config.pipes.horizon
  ) {
    rng = (rng + 0x9e3779b9) >>> 0;
    const p = s.config.pipes;
    const sample = mix32((s.descriptor.seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0);
    const challengeStep = challenge ? index % challenge.pipesPerFamily : undefined;
    const challengeBlock = challenge ? Math.floor(index / challenge.pipesPerFamily) : 0;
    let challengeId: string | undefined;
    const wetland = s.config.wetland;
    const stationStep = index % 4;
    const wetlandBlock = Math.floor(index / 4);
    const coinCourse = wetland?.catalogVersion === 5 && isCoinCourseBlock(s.descriptor.seed, wetlandBlock);
    const bonusSegment = wetland?.catalogVersion === 6 && isBonusSegmentBlock(s.descriptor.seed, wetlandBlock);
    const bonusSegmentV2 = (wetland?.catalogVersion ?? 0) >= 7 && isScheduledBonusBlock(s.config, s.descriptor.seed, wetlandBlock);
    const family = wetland ? wetland.catalogVersion >= 11 ? "steady" : encounter(s.descriptor.seed, Math.floor(index / 4), wetland.introFamilies, wetland.pressureFamilies) : undefined;
    const familySpec = family === undefined ? undefined : wetland!.families.find(item => item.id === family)!;
    const originalStationSpacing = familySpec === undefined ? undefined :
      family === "steady" && wetlandBlock >= wetland!.introFamilies.length
        ? wetland!.recoverySpacing : familySpec.stationSpacing[stationStep]!;
    const baseStationSpacing = originalStationSpacing === undefined ? undefined : coinCourse && stationStep < 2
      ? COIN_COURSE_GATE_SPACING
      : coinCourse && stationStep === 2
        ? wetland!.recoverySpacing
        : bonusSegment && stationStep < 2
          ? scaledClearanceSpacing(originalStationSpacing, p.width, 20)
          : bonusSegment && stationStep === 2
            ? p.width + BONUS_SEGMENT_RECOVERY_CLEARANCE
        : bonusSegmentV2 && stationStep < 2
          ? scaledClearanceSpacing(originalStationSpacing, p.width, BONUS_SEGMENT_V2_CLEARANCE_PERCENT)
          : bonusSegmentV2 && stationStep === 2
            ? p.width + BONUS_SEGMENT_RECOVERY_CLEARANCE
            : wetland?.catalogVersion === 6
              ? scaledClearanceSpacing(originalStationSpacing, p.width, 70)
          : (wetland?.catalogVersion ?? 0) >= 7
            ? scaledClearanceSpacing(originalStationSpacing, p.width, 50)
              : originalStationSpacing;
    const stationSpacing = (wetland?.catalogVersion ?? 0) >= 11
      ? bonusSegmentV2 && stationStep < 2 ? 66_880 : bonusSegmentV2 && stationStep === 2 ? 268_000 : 126_400
      : baseStationSpacing !== undefined && wetland?.catalogVersion === 10
        ? scaledClearanceSpacing(baseStationSpacing, p.width, 60) : baseStationSpacing;
    let raw = p.gapMinCenter + sample % (p.gapMaxCenter - p.gapMinCenter + 1);
    if (familySpec) raw = familySpec.gapCenters[stationStep]!;
    if ((wetland?.catalogVersion ?? 0) >= 11) raw = wetland!.catalogVersion === 12 && index > 0
      ? irregularBaseCenter(s.descriptor.seed, index, previousGap, s.config)
      : bonusSegmentV2OrdinaryCenter(s.descriptor.seed, index, previousGap, s.config);
    if (coinCourse && stationStep < 3) raw = coinCourseGapCenter(s.descriptor.seed, wetlandBlock, stationStep);
    if (bonusSegment && stationStep < 3) raw = bonusSegmentGapCenter(s.descriptor.seed, wetlandBlock, stationStep, s.config);
    if (bonusSegmentV2 && stationStep < 3)
      raw = bonusSegmentV2GapCenter(s.descriptor.seed, wetlandBlock, stationStep, previousGap, s.config);
    else if ((wetland?.catalogVersion ?? 0) >= 7 && (wetland?.catalogVersion ?? 0) < 11 && wetlandBlock >= wetland!.introFamilies.length)
      raw = wetland!.catalogVersion >= 9 && family !== "steady"
        ? pressurePipeCenter(s.descriptor.seed, index, previousGap, s.config)
        : wetland!.catalogVersion >= 8
        ? variedPipeCenter(s.descriptor.seed, index, previousGap, family === "steady", s.config)
        : bonusSegmentV2OrdinaryCenter(s.descriptor.seed, index, previousGap, s.config);
    const variedGapCenter = wetland?.catalogVersion === 2 && family !== undefined
      ? variedWetlandGapCenter(s.descriptor.seed, wetlandBlock, stationStep, family, s.config)
      : undefined;
    if (variedGapCenter !== undefined) raw = variedGapCenter;
    if (challenge) {
      if (challengeBlock === 0) challengeId = challenge.introFamilyId;
      else if (challengeBlock <= 2) {
        const scheduled = challengeBlock - 1;
        if (scheduled < 2) {
          const offset = mix32((s.descriptor.seed ^ 0x9e3779b9) >>> 0) % challenge.cruiseFamilyIds.length;
          challengeId = challenge.cruiseFamilyIds[(offset + scheduled) % challenge.cruiseFamilyIds.length];
        }
      } else if ((challengeBlock - 3) % 2 === 0) {
          const cycle = Math.floor((challengeBlock - 3) / 2);
          const offset = mix32((s.descriptor.seed ^ Math.imul(cycle + 1, 0x85ebca6b)) >>> 0) % challenge.pressureFamilyIds.length;
          challengeId = challenge.pressureFamilyIds[offset];
      } else challengeId = challenge.recoveryFamilyId;
      raw = challengeFamilies!.get(challengeId!)!.gapCenters[challengeStep!]!;
    }
    const authoredWetlandStation = wetland?.catalogVersion === 2 && variedGapCenter !== undefined;
    const low = index === 0 ? Math.max(p.gapMinCenter, previousGap - 35000) : Math.max(p.gapMinCenter, previousGap - p.maxGapDelta);
    const high = index === 0 ? Math.min(p.gapMaxCenter, previousGap + 35000) : Math.min(p.gapMaxCenter, previousGap + p.maxGapDelta);
    const gapCenter = authoredWetlandStation ? raw : Math.max(low, Math.min(high, raw));
    previousGap = gapCenter;
    const authoredType = familySpec?.obstacleTypes[stationStep];
    const polarityBlock = wetland?.catalogVersion !== 2 ? undefined : wetlandBlock === 1 ? 2 :
      wetlandBlock >= 3 && wetlandBlock % 2 === 1 ? wetlandBlock + 1 : wetlandBlock;
    const laneCenter = polarityBlock === undefined ? undefined : pressureLaneCenter(s.descriptor.seed, polarityBlock, s.config);
    const realizedType = authoredType === "vine" || authoredType === "rock"
      ? laneCenter === p.gapMinCenter ? "rock" : laneCenter === p.gapMaxCenter ? "vine" : authoredType
      : authoredType;
    pipes.push({ id: `pipe-${index}`, index, x, gapCenter, scored: false,
      ...(challengeId === undefined ? {} : { challengeId, challengeStep: challengeStep! }),
      ...(family === undefined ? {} : { stationId: `station-${index}`, stationStep, encounterFamily: family, stationSpacing: stationSpacing!,
        obstacles: authoredObstacles(
          wetland?.catalogVersion === 2 ? realizedType! : authoredType!,
          gapCenter, s.config, s.descriptor.seed, index,
        ) }),
    });
    index = incrementCounter(index);
    x += stationSpacing ?? spacing;
  }
  return {
    state: deepFreeze({ ...s, pipes, rngState: rng, nextPipeIndex: index, lastGapCenter: previousGap,
      ...(s.config.wetland ? { nextPipeX: x } : {}) }),
    events: [],
  };
}
export function bonusY(config: GameConfig, seed: number, pipe: Pipe, radius: number): number {
  const p = config.pipes, f = config.flight;
  const half = Math.floor(p.gapHeight / 2);
  const safeLow = pipe.gapCenter - half + f.duckHalfHeight + radius + 2;
  const safeHigh = pipe.gapCenter + half - f.duckHalfHeight - radius - 2;
  const innerLow = Math.max(safeLow, pipe.gapCenter - Math.floor(half * 0.7));
  const innerHigh = Math.min(safeHigh, pipe.gapCenter + Math.floor(half * 0.7));
  if (innerLow >= innerHigh) return Math.floor((safeLow + safeHigh) / 2);
  const maxOffset = Math.min(42000, Math.floor((innerHigh - innerLow) / 2));
  const sample = mix32((seed ^ Math.imul(pipe.index + 1, 0x85ebca6b)) >>> 0);
  const magnitude = 16000 + sample % Math.max(1, maxOffset - 15999);
  const signed = (sample & 0x80000000) ? -magnitude : magnitude;
  return Math.max(innerLow, Math.min(innerHigh, pipe.gapCenter + signed));
}
export function wetlandRewardPoint(config: GameConfig, pipe: Pipe, radius: number, star = false): { x: number; y: number } {
  const catalog = config.wetland!;
  const family = catalog.families.find(item => item.id === pipe.encounterFamily)!;
  const authored = star ? catalog.starRoute : family.rewardRoute[pipe.stationStep!]!;
  if (catalog.catalogVersion === 2) {
    const obstacles = pipe.obstacles ?? [];
    const minY = config.pipes.ceilingY + config.flight.duckHalfHeight + radius + 2;
    const maxY = config.pipes.floorY - config.flight.duckHalfHeight - radius - 2;
    const sign = Math.sign(authored.yOffset) || (pipe.stationStep! % 2 === 0 ? -1 : 1);
    const routeSign = star ? -sign : sign;
    const maxObstacleWidth = Math.max(...obstacles.map(obstacle => obstacle.width), config.pipes.width);
    const xSign = star ? -1 : Math.sign(authored.xOffset) || (pipe.stationStep! % 2 === 0 ? -1 : 1);
    const xOffset = xSign * Math.min(120_000, Math.max(Math.abs(authored.xOffset), Math.floor(maxObstacleWidth / 2) + config.flight.duckHalfWidth + radius + 8_000));
    let y = Math.max(minY, Math.min(maxY, pipe.gapCenter + routeSign * Math.abs(authored.yOffset)));
    if (obstacles.some(obstacle => obstacle.typeId === "pipes")) {
      const top = obstacles.find(obstacle => obstacle.y === config.pipes.ceilingY);
      const bottom = obstacles.find(obstacle => obstacle.y + obstacle.height === config.pipes.floorY);
      if (top && bottom) {
        const openingTop = top.y + top.height;
        const openingBottom = bottom.y;
        const safeTop = openingTop + config.flight.duckHalfHeight + radius + 2;
        const safeBottom = openingBottom - config.flight.duckHalfHeight - radius - 2;
        y = Math.max(safeTop, Math.min(safeBottom, pipe.gapCenter + routeSign * (star ? 48_000 : 18_000)));
        return { x: pipe.x + (star ? xOffset : Math.sign(authored.xOffset || routeSign) * Math.abs(authored.xOffset)), y };
      }
    } else if (obstacles.some(obstacle => obstacle.typeId === "vine")) {
      const obstacle = obstacles.find(item => item.typeId === "vine")!;
      const freeLow = Math.min(maxY, obstacle.y + obstacle.height + config.flight.duckHalfHeight + radius + 2);
      const freeHigh = maxY;
      const coinY = Math.floor((freeLow + freeHigh) / 2);
      y = star ? Math.min(freeHigh, coinY + 30_000) : coinY;
    } else if (obstacles.some(obstacle => obstacle.typeId === "rock")) {
      const obstacle = obstacles.find(item => item.typeId === "rock")!;
      const freeLow = minY;
      const freeHigh = Math.max(minY, obstacle.y - config.flight.duckHalfHeight - radius - 2);
      const coinY = Math.floor((freeLow + freeHigh) / 2);
      y = star ? Math.max(freeLow, coinY - 30_000) : coinY;
    } else if (obstacles.some(obstacle => obstacle.typeId === "debris")) {
      const obstacle = obstacles.find(item => item.typeId === "debris")!;
      const barCenter = obstacle.y + Math.floor(obstacle.height / 2);
      const clearance = Math.floor(obstacle.height / 2) + config.flight.duckHalfHeight + radius + 18_000;
      y = star
        ? Math.max(minY, Math.min(maxY, barCenter + sign * (clearance + 70_000)))
        : Math.max(minY, Math.min(maxY, barCenter + routeSign * clearance));
    }
    return { x: pipe.x + xOffset, y };
  }
  const debris = pipe.obstacles?.some(obstacle => obstacle.typeId === "debris") ?? false;
  const half = Math.floor(config.pipes.gapHeight / 2);
  const safeOpeningOffset = half - config.flight.duckHalfHeight - radius - 2;
  let offset: number;
  if (debris) {
    const clearance = 21000 + config.flight.duckHalfHeight + 1;
    const minY = config.pipes.ceilingY + config.flight.duckHalfHeight;
    const maxY = config.pipes.floorY - config.flight.duckHalfHeight;
    const upperReach = pipe.gapCenter - minY;
    const lowerReach = maxY - pipe.gapCenter;
    let direction = Math.sign(authored.yOffset);
    if (direction > 0 && lowerReach < clearance) direction = -1;
    if (direction < 0 && upperReach < clearance) direction = 1;
    const reach = direction > 0 ? lowerReach : upperReach;
    offset = direction * Math.max(clearance, Math.min(Math.abs(authored.yOffset), reach));
  } else {
    offset = Math.sign(authored.yOffset) * Math.min(Math.abs(authored.yOffset), safeOpeningOffset);
  }
  return { x: pipe.x + authored.xOffset, y: pipe.gapCenter + offset };
}
/** Individual pickup positions for the v4 currency formations. */
export function currencyFormationPoints(config: GameConfig, seed: number, pipe: Pipe, radius: number, star = false, eventOrdinal = pipe.index): readonly { x: number; y: number }[] {
  const center = wetlandRewardPoint(config, pipe, radius, star);
  if (config.wetland?.catalogVersion === 5 && !star && pipe.stationStep === 2 && isCoinCourseBlock(seed, Math.floor(pipe.index / 4))) {
    const opening = Math.floor(config.pipes.gapHeight / 2) - config.flight.duckHalfHeight - radius - 2;
    const safeY = Math.max(1, Math.min(20_000, opening));
    return [
      { x: pipe.x + 70_000, y: center.y },
      { x: pipe.x + 100_000, y: center.y - safeY },
      { x: pipe.x + 130_000, y: center.y + safeY },
    ];
  }
  if (config.wetland?.catalogVersion === 6 && !star && pipe.stationStep === 2 && isBonusSegmentBlock(seed, Math.floor(pipe.index / 4))) {
    const intervalCenterX = pipe.x + Math.floor((pipe.stationSpacing ?? config.pipes.width + BONUS_SEGMENT_RECOVERY_CLEARANCE) / 2);
    return [
      { x: intervalCenterX - 18_000, y: center.y },
      { x: intervalCenterX + 9_000, y: center.y - 15_000 },
      { x: intervalCenterX + 9_000, y: center.y + 15_000 },
    ];
  }
  if ((config.wetland?.catalogVersion ?? 0) >= 7 && !star && pipe.stationStep === 2 && isScheduledBonusBlock(config, seed, Math.floor(pipe.index / 4))) {
    const intervalCenterX = pipe.x + Math.floor((pipe.stationSpacing ?? config.pipes.width + BONUS_SEGMENT_RECOVERY_CLEARANCE) / 2);
    return [
      { x: intervalCenterX - 18_000, y: center.y },
      { x: intervalCenterX + 9_000, y: center.y - 15_000 },
      { x: intervalCenterX + 9_000, y: center.y + 15_000 },
    ];
  }
  if (config.wetland && config.wetland.catalogVersion >= 6) {
    if (star && config.wetland.starFormations === true) {
      const variant = mix32((seed ^ Math.imul(pipe.index + 1, 0x9e3779b9) ^ Math.imul(eventOrdinal + 1, 0x85ebca6b) ^ 0x51ed270b) >>> 0);
      const offsets = [[0, -22000], [21000, -7000], [13000, 18000], [-13000, 18000], [-21000, -7000]] as const;
      const rotation = (variant >>> 1) & 3;
      const centerX = pipe.x + Math.floor(config.pipes.width / 2);
      const halfOpening = Math.floor(config.pipes.gapHeight / 2) - config.flight.duckHalfHeight - radius - 2;
      const centerY = Math.max(pipe.gapCenter - halfOpening + 22_000,
        Math.min(pipe.gapCenter + halfOpening - 22_000, center.y));
      return offsets.map(([dx, dy]) => {
        const rotated = rotateFormationOffset(dx, dy, rotation);
        return { x: centerX + rotated.x, y: centerY + rotated.y };
      });
    }
    if (star) return [{ x: pipe.x + Math.floor(config.pipes.width / 2), y: center.y }];
    return [{ x: center.x, y: center.y }];
  }
  if ((config.wetland?.catalogVersion ?? 0) < 4) return [center];
  const variant = mix32((seed ^ Math.imul(pipe.index + 1, 0x9e3779b9) ^ Math.imul(eventOrdinal + 1, 0x85ebca6b) ^ (star ? 0x51ed270b : 0)) >>> 0);
  const halfOpening = Math.floor(config.pipes.gapHeight / 2) - config.flight.duckHalfHeight - radius - 2;
  const yVariation = star ? 22_000 : 15_000;
  const centerY = Math.max(pipe.gapCenter - halfOpening + yVariation,
    Math.min(pipe.gapCenter + halfOpening - yVariation, center.y));
  if (star) {
    const offsets = [[0, -22000], [21000, -7000], [13000, 18000], [-13000, 18000], [-21000, -7000]] as const;
    const rotation = (variant >>> 1) & 3;
    // Keep the rotated group entirely outside one pipe while translating its authored center.
    const margin = 22_000 + config.flight.duckHalfWidth + radius + 2;
    const safeCenterX = (variant & 1) === 0
      ? pipe.x - margin
      : pipe.x + config.pipes.width + margin;
    const centerShiftX = safeCenterX - center.x;
    const formationCenterX = center.x + centerShiftX;
    return offsets.map(([dx, dy]) => {
      const rotated = rotateFormationOffset(dx, dy, rotation);
      return { x: formationCenterX + rotated.x, y: centerY + rotated.y };
    });
  }
  const outside = (variant & 1) === 1;
  const direction = (variant & 2) === 0 ? 1 : -1;
  // Three vertices form a fish: the nose and two vertically separated tail points.
  const xMargin = 18_000 + config.flight.duckHalfWidth + radius + 2;
  const centerX = outside
    ? direction < 0 ? pipe.x - xMargin : pipe.x + config.pipes.width + xMargin
    : pipe.x + Math.floor(config.pipes.width / 2);
  const yDirection = (variant & 4) === 0 ? 1 : -1;
  return [
    { x: centerX + direction * 18_000, y: centerY },
    { x: centerX - direction * 18_000, y: centerY - yDirection * 15_000 },
    { x: centerX - direction * 18_000, y: centerY + yDirection * 15_000 },
  ];
}

function rotateFormationOffset(x: number, y: number, quarterTurns: number): { x: number; y: number } {
  switch (quarterTurns) {
    case 1: return { x: -y, y: x };
    case 2: return { x: -x, y: -y };
    case 3: return { x: y, y: -x };
    default: return { x, y };
  }
}
/** Speed for a one-based active simulation tick; READY is still stationary. */
export function worldSpeedAt(config: GameConfig, tick: number, score = 0): number {
  validateConfig(config);
  if (!Number.isSafeInteger(tick) || tick > MAX_COUNTER || !Number.isSafeInteger(score) || score < 0 || score > MAX_COUNTER)
    throw Error("tick and score must be safe simulation counters");
  const elapsed = Math.min(Math.max(tick - 1, 0), config.pipes.rampTicks);
  const base = config.pipes.speed + Math.floor((config.pipes.maxSpeed - config.pipes.speed) * elapsed / config.pipes.rampTicks);
  const maxSteps = Math.ceil((config.pipes.maxSpeed - base) * 100 / (config.pipes.speed * config.pipes.speedStepPercent || 1));
  const steps = Math.min(Math.floor(score / config.pipes.speedEveryPipes), maxSteps);
  return Math.min(config.pipes.maxSpeed, base + Math.floor(config.pipes.speed * steps * config.pipes.speedStepPercent / 100));
}
