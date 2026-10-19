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
    const family = wetland ? encounter(s.descriptor.seed, Math.floor(index / 4), wetland.introFamilies, wetland.pressureFamilies) : undefined;
    const familySpec = family === undefined ? undefined : wetland!.families.find(item => item.id === family)!;
    const stationSpacing = familySpec === undefined ? undefined : family === "steady" && Math.floor(index / 4) >= wetland!.introFamilies.length
      ? wetland!.recoverySpacing : familySpec.stationSpacing[stationStep]!;
    let raw = p.gapMinCenter + sample % (p.gapMaxCenter - p.gapMinCenter + 1);
    if (familySpec) raw = familySpec.gapCenters[stationStep]!;
    const wetlandBlock = Math.floor(index / 4);
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
