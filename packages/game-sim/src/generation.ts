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

function authoredObstacles(typeId: "pipes" | "vine" | "rock" | "debris", gapCenter: number, config: GameConfig): readonly ObstacleDefinition[] {
  const p = config.pipes;
  const half = Math.floor(p.gapHeight / 2);
  const openingTop = gapCenter - half;
  const openingBottom = gapCenter + half;
  const width = p.width;
  if (typeId === "pipes") return [
    { typeId, xOffset: 0, y: p.ceilingY, width, height: openingTop - p.ceilingY },
    { typeId, xOffset: 0, y: openingBottom, width, height: p.floorY - openingBottom },
  ];
  if (typeId === "vine") return [{ typeId, xOffset: 0, y: p.ceilingY, width, height: openingTop - p.ceilingY }];
  if (typeId === "rock") return [{ typeId, xOffset: 0, y: openingBottom, width, height: p.floorY - openingBottom }];
  const height = 42000;
  return [{ typeId, xOffset: 0, y: gapCenter - Math.floor(height / 2), width, height }];
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
    const low = index === 0 ? Math.max(p.gapMinCenter, previousGap - 35000) : Math.max(p.gapMinCenter, previousGap - p.maxGapDelta);
    const high = index === 0 ? Math.min(p.gapMaxCenter, previousGap + 35000) : Math.min(p.gapMaxCenter, previousGap + p.maxGapDelta);
    const gapCenter = Math.max(low, Math.min(high, raw));
    previousGap = gapCenter;
    pipes.push({ id: `pipe-${index}`, index, x, gapCenter, scored: false,
      ...(challengeId === undefined ? {} : { challengeId, challengeStep: challengeStep! }),
      ...(family === undefined ? {} : { stationId: `station-${index}`, stationStep, encounterFamily: family, stationSpacing: stationSpacing!,
        obstacles: authoredObstacles(familySpec!.obstacleTypes[stationStep]!, gapCenter, s.config) }),
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
