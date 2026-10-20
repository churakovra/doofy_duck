import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PRIOR_DEFAULT_CONFIG,
  WETLAND_DEFAULT_CONFIG,
  VARIED_OBSTACLE_DEFAULT_CONFIG,
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_ID,
  PAIRED_ROUTES_DEFAULT_CONFIG,
  PAIRED_ROUTES_CONFIG_ID,
  PAIRED_ROUTES_SIMULATION_VERSION,
  PAIRED_ROUTES_GENERATOR_VERSION,
  VARIED_OBSTACLE_DEFAULT_CONFIG_ID,
  VARIED_OBSTACLE_SIMULATION_VERSION,
  VARIED_OBSTACLE_GENERATOR_VERSION,
  SIMULATION_VERSION,
  GENERATOR_VERSION,
  LEGACY_DEFAULT_CONFIG,
  PRIOR_DEFAULT_CONFIG_ID,
  PRIOR_GENERATOR_VERSION,
  PRIOR_SIMULATION_VERSION,
  LEGACY_DEFAULT_CONFIG_ID,
  WETLAND_DEFAULT_CONFIG_ID,
  WETLAND_GENERATOR_VERSION,
  WETLAND_SIMULATION_VERSION,
  LEGACY_SIMULATION_VERSION,
  LEGACY_GENERATOR_VERSION,
  createRun,
  createRunDescriptor,
  step,
  makeInput,
  generateNext,
  canonicalState,
  worldSpeedAt,
  validateConfig,
} from "../src/index.js";
import { wetlandRewardPoint } from "../src/generation.js";
import type { EncounterFamilyId, GameConfig, GameEvent, InputFrame, RunState } from "../src/index.js";

type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

function safeIntervals(state: RunState, station: RunState["pipes"][number]): [number, number][] {
  return safeIntervalsForObstacles(state, station.obstacles ?? []);
}

function safeIntervalsForObstacles(state: RunState, obstacles: NonNullable<RunState["pipes"][number]["obstacles"]>): [number, number][] {
  const { flight, pipes } = state.config;
  const min = pipes.ceilingY + flight.duckHalfHeight + 1;
  const max = pipes.floorY - flight.duckHalfHeight - 1;
  const blocked = obstacles.map(obstacle => [
    Math.max(min, obstacle.y - flight.duckHalfHeight),
    Math.min(max, obstacle.y + obstacle.height + flight.duckHalfHeight),
  ] as [number, number]).filter(([a, b]) => a <= b).sort((a, b) => a[0] - b[0]);
  const safe: [number, number][] = [];
  let cursor = min;
  for (const [low, high] of blocked) {
    if (cursor < low) safe.push([cursor, low - 1]);
    cursor = Math.max(cursor, high + 1);
  }
  if (cursor <= max) safe.push([cursor, max]);
  return safe.map(([a, b]): [number, number] => state.config.wetland?.catalogVersion === 2
    ? [a, b]
    : [a + 25_000, b - 25_000]).filter(([a, b]) => a <= b);
}

function retainSafeDebrisReference(
  state: RunState,
  reference: number,
  snapshot: { type: string; obstacles: NonNullable<RunState["pipes"][number]["obstacles"]> },
): number | undefined {
  if (snapshot.type !== "debris") return undefined;
  return safeIntervalsForObstacles(state, snapshot.obstacles).some(([low, high]) => reference >= low && reference <= high)
    ? reference
    : undefined;
}

function emergencyObstacleNeedsFlap(
  state: RunState,
  observations: ReadonlyMap<string, RewardOwnerSnapshot & { y: number }>,
  observedXs: ReadonlyMap<string, number>,
  speed: number,
): boolean {
  const { flight } = state.config;
  const coastY = state.duck.y + Math.min(flight.maxFallSpeed, state.duck.vy + flight.gravity);
  const flapY = state.duck.y + Math.min(flight.maxFallSpeed, flight.flapVelocity + flight.gravity);
  for (const [stationId, observation] of observations) {
    if (state.tick < observation.readyAt) continue;
    const observedX = observedXs.get(stationId);
    if (observedX === undefined) continue;
    const nextX = observedX - speed;
    for (const obstacle of observation.obstacles) {
      const left = nextX + obstacle.xOffset - Math.floor(obstacle.width / 2);
      const right = nextX + obstacle.xOffset + Math.floor(obstacle.width / 2);
      if (right < flight.duckX - flight.duckHalfWidth || left > flight.duckX + flight.duckHalfWidth) continue;
      const coastHits = coastY + flight.duckHalfHeight >= obstacle.y && coastY - flight.duckHalfHeight <= obstacle.y + obstacle.height;
      const flapHits = flapY + flight.duckHalfHeight >= obstacle.y && flapY - flight.duckHalfHeight <= obstacle.y + obstacle.height;
      if (coastHits && !flapHits) return true;
    }
  }
  return false;
}

function nearestSafeY(state: RunState, station: RunState["pipes"][number]): number {
  const preferredY = 280_000;
  if (state.config.wetland?.catalogVersion !== 2) {
    const nearest = safeIntervals(state, station).map(([a, b]) => preferredY < a || preferredY > b ? Math.floor((a + b) / 2) : preferredY)
      .sort((a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY))[0];
    if (nearest === undefined) throw new Error(`no safe interval for ${station.stationId}`);
    return nearest;
  }
  const interval = safeIntervals(state, station).map(([a, b]) => {
    const inset = Math.min(25_000, Math.max(0, Math.floor((b - a) / 4)));
    return { a: a + inset, b: b - inset };
  })
    .sort((left, right) => {
      const toPreference = (range: { a: number; b: number }) => preferredY < range.a ? range.a - preferredY : preferredY > range.b ? preferredY - range.b : 0;
      return toPreference(left) - toPreference(right);
    })[0];
  const verticalType = station.obstacles?.[0]?.typeId;
  const midpoint = Math.floor((state.config.pipes.ceilingY + state.config.pipes.floorY) / 2);
  if (interval && verticalType === "vine") return interval.b;
  if (interval && verticalType === "rock") return interval.a;
  if (interval && verticalType === "pipes" && Math.abs(station.gapCenter - midpoint) > 20_000)
    return station.gapCenter > midpoint ? interval.b : interval.a;
  const nearest = safeIntervals(state, station).map(([a, b]) => preferredY < a || preferredY > b ? Math.floor((a + b) / 2) : preferredY)
    .sort((a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY))[0];
  if (nearest === undefined) throw new Error(`no safe interval for ${station.stationId}`);
  return nearest;
}

function projectedObstacleHit(state: RunState, station: RunState["pipes"][number], obstacle: NonNullable<RunState["pipes"][number]["obstacles"]>[number], firstFlap: boolean): boolean {
  const { flight } = state.config;
  const speed = worldSpeedAt(state.config, state.tick + 1, state.score);
  let y = state.duck.y;
  let vy = state.duck.vy;
  let stationX = station.x;
  for (let offset = 1; offset <= 200; offset += 1) {
    stationX -= speed;
    if (offset === 1 && firstFlap) vy = flight.flapVelocity;
    vy = Math.min(flight.maxFallSpeed, vy + flight.gravity);
    y += vy;
    const left = stationX + obstacle.xOffset - Math.floor(obstacle.width / 2);
    const right = stationX + obstacle.xOffset + Math.floor(obstacle.width / 2);
    const overlapsX = right >= flight.duckX - flight.duckHalfWidth && left <= flight.duckX + flight.duckHalfWidth;
    if (overlapsX && y + flight.duckHalfHeight >= obstacle.y && y - flight.duckHalfHeight <= obstacle.y + obstacle.height) return true;
    if (right < flight.duckX - flight.duckHalfWidth) return false;
  }
  return false;
}

type RewardOwnerSnapshot = {
  readyAt: number;
  observedAt: number;
  x: number;
  type: string;
  obstacleCenter?: number;
  gap?: number;
  obstacles: NonNullable<RunState["pipes"][number]["obstacles"]>;
};

// Frozen catalog-1 characterization policy. Keep its control choices unchanged;
// catalog-2 observation-delay witnesses use runRewardWitness below.
function runLegacyRewardWitness(seed: number, entryY: number, entryVy: number, scoreTarget: number, starIndex?: number) {
  const config = {
    ...WETLAND_DEFAULT_CONFIG,
    pipes: { ...WETLAND_DEFAULT_CONFIG.pipes, horizon: 1_700_000 },
    limits: { maxActivePipes: 24, maxActiveCollectibles: 25 },
    starSchedule: starIndex === undefined ? { minIntervalPipes: 8, maxIntervalPipes: 8 } : { minIntervalPipes: starIndex, maxIntervalPipes: starIndex },
  };
  let state = createRun(createRunDescriptor({ runId: `wetland-reward-witness-${seed}-${scoreTarget}`, seed }, config), config);
  state = { ...state, phase: "RUNNING", tick: config.pipes.rampTicks, duck: { ...state.duck, y: entryY, vy: entryVy },
    ...(starIndex === undefined ? { nextStarPipeIndex: 1, starScheduleOrdinal: 0 } : {}) };
  const observedStations = new Map<string, { readyAt: number; y: number; type: string; gap: number }>();
  const observedRewards = new Map<string, { readyAt: number; y: number; type: string; gap: number }>();
  const collected = new Set<string>();
  let currentTarget = "";
  let targetY = entryY;
  let targetType = "pipes";
  let targetGap = entryY;
  for (let frame = 0; frame < 6_000 && state.score < scoreTarget && state.phase !== "DEAD"; frame += 1) {
    for (const station of state.pipes) {
      if (station.stationId && station.x <= 360_000 && station.x >= state.duck.x - 40_000 && !observedStations.has(station.stationId)) {
        observedStations.set(station.stationId, { readyAt: state.tick + 18, y: nearestSafeY(state, station),
          type: station.obstacles?.[0]?.typeId ?? "pipes", gap: station.gapCenter });
      }
    }
    for (const item of state.collectibles) {
      if (!observedRewards.has(item.id) && item.x <= 360_000 && item.x >= state.duck.x - 40_000) {
        const stationIndex = item.id.startsWith("star-") ? Number(item.id.slice(5)) : Number(item.id.split("-")[2]) * 4 + Number(item.id.split("-")[3]);
        const owner = state.pipes.find(station => station.index === stationIndex);
        observedRewards.set(item.id, { readyAt: state.tick + 18, y: item.y,
          type: owner?.obstacles?.[0]?.typeId ?? "pipes", gap: owner?.gapCenter ?? item.y });
      }
    }
    const reward = state.collectibles.filter(item => !item.collected && observedRewards.has(item.id) && state.tick >= observedRewards.get(item.id)!.readyAt)
      .filter(item => item.x >= state.duck.x - 40_000).sort((a, b) => a.x - b.x)[0];
    const station = state.pipes.find(item => item.stationId && item.x >= state.duck.x - 40_000 && item.x <= 360_000 &&
      observedStations.has(item.stationId) && state.tick >= observedStations.get(item.stationId)!.readyAt);
    const target = reward?.id ?? station?.stationId ?? "";
    if (target && target !== currentTarget) {
      currentTarget = target;
      const observation = reward ? observedRewards.get(reward.id)! : observedStations.get(station!.stationId!)!;
      targetY = observation.y;
      targetType = observation.type;
      targetGap = observation.gap;
    }
    const flight = state.config.flight;
    const speed = worldSpeedAt(state.config, state.tick + 1, state.score);
    const coastY = state.duck.y + Math.min(flight.maxFallSpeed, state.duck.vy + flight.gravity);
    const flapY = state.duck.y + Math.min(flight.maxFallSpeed, flight.flapVelocity + flight.gravity);
    const threshold = targetType === "debris" && targetY < targetGap ? 18_000 : 23_000;
    let flap = state.duck.y > targetY + threshold && state.duck.vy > 0;
    if ((coastY - flight.duckHalfHeight <= state.config.pipes.ceilingY || coastY + flight.duckHalfHeight >= state.config.pipes.floorY) &&
      flapY - flight.duckHalfHeight > state.config.pipes.ceilingY && flapY + flight.duckHalfHeight < state.config.pipes.floorY) flap = true;
    for (const obstacleStation of state.pipes) {
      if (!obstacleStation.stationId || state.tick < (observedStations.get(obstacleStation.stationId)?.readyAt ?? Number.POSITIVE_INFINITY)) continue;
      for (const obstacle of obstacleStation.obstacles ?? []) {
        const left = obstacleStation.x - speed + obstacle.xOffset - Math.floor(obstacle.width / 2);
        const right = obstacleStation.x - speed + obstacle.xOffset + Math.floor(obstacle.width / 2);
        if (right < flight.duckX - flight.duckHalfWidth || left > flight.duckX + flight.duckHalfWidth) continue;
        const coastHits = coastY + flight.duckHalfHeight >= obstacle.y && coastY - flight.duckHalfHeight <= obstacle.y + obstacle.height;
        const flapHits = flapY + flight.duckHalfHeight >= obstacle.y && flapY - flight.duckHalfHeight <= obstacle.y + obstacle.height;
        if (coastHits && !flapHits) flap = true;
      }
    }
    const result = step(state, flap ? [makeInput(state.nextInputSequence, "FLAP")] : []);
    result.events.filter(event => event.type === "CurrencyCollected").forEach(event => collected.add(event.collectibleId));
    state = result.state;
  }
  return { state, collected };
}

function matureRewardOwner(rewardId: string, observedStations: ReadonlyMap<string, RewardOwnerSnapshot>, tick: number): RewardOwnerSnapshot | undefined {
  const stationIndex = rewardId.startsWith("star-")
    ? Number(rewardId.slice(5))
    : (() => {
      const match = /^feather-trail-(\d+)-(\d+)$/.exec(rewardId);
      return match ? Number(match[1]) * 4 + Number(match[2]) : Number.NaN;
    })();
  const owner = observedStations.get(`station-${stationIndex}`);
  return owner && tick >= owner.readyAt ? owner : undefined;
}

function runRewardWitness(seed: number, entryY: number, entryVy: number, scoreTarget: number, starIndex?: number, rules = WETLAND_DEFAULT_CONFIG, pursueRewards = true, forcedFlapRange?: [number, number], profile: "custom-cap" | "normal-default" = "custom-cap", rolloutRewardIds?: readonly string[], ownerApertureContinuation?: { stationId: string; fromTick: number; throughTick: number }) {
  const usesRewardRollout = rolloutRewardIds !== undefined;
  const config = profile === "normal-default" ? rules : {
    ...rules,
    pipes: { ...rules.pipes, horizon: 1_700_000 },
    limits: { maxActivePipes: 24, maxActiveCollectibles: 25 },
    starSchedule: starIndex === undefined
      ? rules.wetland?.catalogVersion === 2 ? null : { minIntervalPipes: 8, maxIntervalPipes: 8 }
      : { minIntervalPipes: 8, maxIntervalPipes: 8 },
  };
  let state = createRun(createRunDescriptor({ runId: `wetland-reward-witness-${seed}-${scoreTarget}`, seed }, config), config);
  if (profile === "custom-cap") state = { ...state, phase: "RUNNING", tick: config.pipes.rampTicks, duck: { ...state.duck, y: entryY, vy: entryVy },
    ...(starIndex === undefined ? { nextStarPipeIndex: 1, starScheduleOrdinal: 0 } : { nextStarPipeIndex: starIndex, starScheduleOrdinal: 0 }) };
  const initialState = state;
  const observedStations = new Map<string, RewardOwnerSnapshot & { y: number }>();
  const observedXs = new Map<string, number>();
  const observedRewards = new Map<string, { id: string; observedAt: number; readyAt: number; x: number; y: number; radius: number }>();
  const collected = new Set<string>();
  const collectedAt = new Map<string, number>();
  const collectionEvents = new Map<string, { count: number; amount: number }>();
  const displacements: { tick: number; stationId: string; actual: number; expected: number; score: number }[] = [];
  let terminal: { before: { tick: number; score: number; y: number; vy: number; flap: boolean; pipes: unknown[] };
    after: { tick: number; score: number; phase: string; y: number; vy: number }; events: readonly GameEvent[];
    lastInputs: typeof inputs; activeTarget: { id: string; y: number; type: string; gap?: number | undefined };
    matureStation: unknown; matureReward: unknown } | undefined;
  const passedTypes: { stationId: string; type: string; spanPercent: number }[] = [];
  let currentTarget = "";
  const targetChanges: { tick: number; readyAt: number; y: number; target: string; duckY: number; duckVy: number }[] = [];
  const inputs: { tick: number; flap: boolean }[] = [];
  const rewardRollouts: { tick: number; rewardId: string; horizon: number; firstFlap: boolean; y: number; vy: number }[] = [];
  const rewardRolloutDiagnostics: { tick: number; rewardId: string; reason: string; predictedPickupTick?: number;
    preferredAction: boolean; plannedAction?: boolean; executedAction?: boolean }[] = [];
  const starWitness: { observation?: unknown; owner?: unknown; firstEligible?: unknown;
    horizontalPickupWindow?: { firstTick: number; lastTick: number; firstX: number; lastX: number } } = {};
  const ownerContinuationInputs: { tick: number; preferredFlap: boolean; executedFlap?: boolean;
    y: number; vy: number; ownerX?: number; apertureCenter: number }[] = [];
  let branchCheckpoint: RunState | undefined;
  let targetY = entryY;
  let targetType = "pipes";
  let targetGap: number | undefined = entryY;
  for (let frame = 0; frame < 6_000 && state.score < scoreTarget && state.phase !== "DEAD"; frame += 1) {
    for (const station of state.pipes) {
      if (station.stationId && station.x <= 360_000 && station.x >= state.duck.x - 40_000 && !observedStations.has(station.stationId)) {
        expect(station.x, `${station.stationId} observation is screen-visible`).toBeLessThanOrEqual(360_000);
        const obstacle = station.obstacles?.[0];
        observedStations.set(station.stationId, {
          readyAt: state.tick + 18, observedAt: state.tick, x: station.x, y: nearestSafeY(state, station),
          type: obstacle?.typeId ?? "pipes", gap: station.gapCenter,
          obstacles: (station.obstacles ?? []).map(item => ({ ...item })),
          ...(obstacle?.typeId === "debris" ? { obstacleCenter: obstacle.y + Math.floor(obstacle.height / 2) } : {}),
        });
        if (station.stationId === "station-8") starWitness.owner = observedStations.get(station.stationId);
        observedXs.set(station.stationId, station.x);
      }
    }
    for (const item of state.collectibles) {
      if (!observedRewards.has(item.id) && item.x <= 360_000 && item.x >= state.duck.x - 40_000) {
        expect(item.x, `${item.id} observation is screen-visible`).toBeLessThanOrEqual(360_000);
        observedRewards.set(item.id, { id: item.id, observedAt: state.tick, readyAt: state.tick + 18, x: item.x, y: item.y, radius: item.radius });
        if (item.id === "star-8") starWitness.observation = observedRewards.get(item.id);
      }
    }
    const publicRewardX = (id: string) => {
      const observation = observedRewards.get(id)!;
      let distance = 0;
      for (let tick = observation.observedAt + 1; tick <= state.tick; tick += 1) distance += worldSpeedAt(config, tick, state.score);
      return observation.x - distance;
    };
    const reward = pursueRewards ? state.collectibles.filter(item => usesRewardRollout ? !collected.has(item.id) : !item.collected)
      .filter(item => observedRewards.has(item.id) && state.tick >= observedRewards.get(item.id)!.readyAt)
      .filter(item => !usesRewardRollout || rolloutRewardIds.includes(item.id))
      .filter(item => !usesRewardRollout || matureRewardOwner(item.id, observedStations, state.tick) !== undefined)
      .filter(item => (usesRewardRollout ? publicRewardX(item.id) : item.x) >= state.duck.x - 40_000)
      .sort((a, b) => (usesRewardRollout ? publicRewardX(a.id) - publicRewardX(b.id) : a.x - b.x))[0] : undefined;
    const star8 = state.collectibles.find(item => item.id === "star-8");
    const star8Observation = observedRewards.get("star-8");
    const star8Owner = matureRewardOwner("star-8", observedStations, state.tick);
    const star8PublicX = star8Observation ? publicRewardX("star-8") : undefined;
    const star8Eligible = Boolean(star8 && star8Observation && star8Owner && !collected.has("star-8") &&
      state.tick >= star8Observation.readyAt && star8PublicX! >= state.duck.x - 40_000);
    if (star8) {
      const withinHorizontalWindow = Math.abs(star8.x - state.config.flight.duckX) <= star8.radius + state.config.flight.duckHalfWidth;
      if (withinHorizontalWindow) {
        const window = starWitness.horizontalPickupWindow;
        if (!window) starWitness.horizontalPickupWindow = { firstTick: state.tick, lastTick: state.tick, firstX: star8.x, lastX: star8.x };
        else { window.lastTick = state.tick; window.lastX = star8.x; }
      }
      if (star8Eligible && starWitness.firstEligible === undefined) starWitness.firstEligible = {
        tick: state.tick, phase: state.phase, y: state.duck.y, vy: state.duck.vy,
        rewardReadyAt: star8Observation!.readyAt, ownerReadyAt: star8Owner!.readyAt,
        publicX: star8PublicX, liveX: star8.x, duckX: state.duck.x,
      };
    }
    const station = state.pipes.filter(item => item.stationId && item.x >= state.duck.x - 40_000 && item.x <= 360_000 &&
      observedStations.has(item.stationId) && state.tick >= observedStations.get(item.stationId)!.readyAt)
      .sort((a, b) => b.x - a.x)[0];
    const target = reward?.id ?? station?.stationId ?? "";
    if (reward) expect(state.tick, `${reward.id} 18-tick reaction`).toBeGreaterThanOrEqual(observedRewards.get(reward.id)!.readyAt);
    if (!reward && station) expect(state.tick, `${station.stationId} 18-tick reaction`).toBeGreaterThanOrEqual(observedStations.get(station.stationId!)!.readyAt);
    if (target && target !== currentTarget) {
      currentTarget = target;
      if (reward) {
        targetY = observedRewards.get(reward.id)!.y;
        const owner = matureRewardOwner(reward.id, observedStations, state.tick);
        targetType = owner?.type ?? "unknown";
        targetGap = owner?.obstacleCenter ?? owner?.gap;
      } else {
        const observation = observedStations.get(station!.stationId!)!;
        const retainedReference = !pursueRewards
          ? retainSafeDebrisReference(state, targetY, observation)
          : undefined;
        targetY = retainedReference ?? observation.y;
        targetType = observation.type;
        targetGap = observation.obstacleCenter ?? observation.gap;
      }
      targetChanges.push({ tick: state.tick, readyAt: reward ? observedRewards.get(reward.id)!.readyAt : observedStations.get(station!.stationId!)!.readyAt,
        y: targetY, target, duckY: state.duck.y, duckVy: state.duck.vy });
    }
    if (reward) {
      const owner = matureRewardOwner(reward.id, observedStations, state.tick);
      targetType = owner?.type ?? "unknown";
      targetGap = owner?.obstacleCenter ?? owner?.gap;
    }
    const flight = state.config.flight;
    const speed = worldSpeedAt(state.config, state.tick + 1, state.score);
    const coastY = state.duck.y + Math.min(flight.maxFallSpeed, state.duck.vy + flight.gravity);
    const flapY = state.duck.y + Math.min(flight.maxFallSpeed, flight.flapVelocity + flight.gravity);
    const threshold = targetType === "debris" && targetGap !== undefined && targetY < targetGap ? 18_000 : 23_000;
    let flap = state.duck.y > targetY + threshold && state.duck.vy > 0;
    if ((coastY - flight.duckHalfHeight <= state.config.pipes.ceilingY || coastY + flight.duckHalfHeight >= state.config.pipes.floorY) &&
      flapY - flight.duckHalfHeight > state.config.pipes.ceilingY && flapY + flight.duckHalfHeight < state.config.pipes.floorY) flap = true;
    let pendingRolloutDiagnostic: typeof rewardRolloutDiagnostics[number] | undefined;
    if (usesRewardRollout) {
      const nextPairedStation = state.pipes.filter(item => item.stationId && item.x >= state.duck.x - 40_000 &&
        observedStations.has(item.stationId) && state.tick >= observedStations.get(item.stationId)!.readyAt)
        .sort((a, b) => a.x - b.x)[0];
      const matureTarget = nextPairedStation?.stationId ? observedStations.get(nextPairedStation.stationId) : undefined;
      const gapCenter = matureTarget
        ? pairedPipeOpening(state, matureTarget.obstacles)?.center ?? targetY
        : targetY;
      flap = state.phase === "READY" || state.duck.y > gapCenter + 24_000;
      if (reward) {
        const rewardSnapshot = observedRewards.get(reward.id)!;
        pendingRolloutDiagnostic = { tick: state.tick, rewardId: reward.id, reason: "pending",
          preferredAction: flap };
        const matureGeometry: MatureGeometry[] = [...observedStations.entries()]
          .filter(([, observation]) => state.tick >= observation.readyAt)
          .map(([stationId, observation]) => ({ stationId, observedAt: observation.observedAt,
            x: observation.x, obstacles: observation.obstacles }));
        const rolloutResult: { reason?: string; predictedPickupTick?: number } = {};
        const route = planMatureRewardPickup(state, matureGeometry, rewardSnapshot, 1024, 60, rolloutResult);
        pendingRolloutDiagnostic.reason = rolloutResult.reason ?? "no-reason-recorded";
        if (rolloutResult.predictedPickupTick !== undefined)
          pendingRolloutDiagnostic.predictedPickupTick = rolloutResult.predictedPickupTick;
        if (route?.length) {
          flap = route[0]!;
          pendingRolloutDiagnostic.plannedAction = flap;
          rewardRollouts.push({ tick: state.tick, rewardId: reward.id, horizon: route.length,
            firstFlap: flap, y: state.duck.y, vy: state.duck.vy });
        }
      }
    } else if (emergencyObstacleNeedsFlap(state, observedStations, observedXs, speed)) flap = true;
    if (profile === "normal-default" && state.phase === "READY") flap = true;
    if (forcedFlapRange && state.tick >= forcedFlapRange[0] && state.tick <= forcedFlapRange[1]) flap = true;
    let continuationInput: typeof ownerContinuationInputs[number] | undefined;
    if (ownerApertureContinuation && state.tick >= ownerApertureContinuation.fromTick &&
      state.tick <= ownerApertureContinuation.throughTick) {
      const owner = observedStations.get(ownerApertureContinuation.stationId);
      if (!owner || state.tick < owner.readyAt) throw new Error(`owner aperture is not mature at tick=${state.tick}`);
      const opening = pairedPipeOpening(state, owner.obstacles);
      if (!opening) throw new Error(`mature owner has no paired aperture at tick=${state.tick}`);
      flap = state.duck.y > opening.center + 24_000;
      const ownerX = observedXs.get(ownerApertureContinuation.stationId);
      continuationInput = { tick: state.tick, preferredFlap: flap, y: state.duck.y, vy: state.duck.vy,
        ...(ownerX === undefined ? {} : { ownerX }), apertureCenter: opening.center };
    }
    flap = finalWorldSafeAction(state, flap);
    if (continuationInput) {
      continuationInput.executedFlap = flap;
      ownerContinuationInputs.push(continuationInput);
    }
    if (pendingRolloutDiagnostic) {
      pendingRolloutDiagnostic.executedAction = flap;
      rewardRolloutDiagnostics.push(pendingRolloutDiagnostic);
    }
    inputs.push({ tick: state.tick, flap });
    const worldAdvances = state.phase === "RUNNING" || (state.phase === "READY" && flap);
    const beforePipes = worldAdvances ? state.pipes.map(pipe => ({ id: pipe.id, stationId: pipe.stationId, x: pipe.x })) : [];
    const result = step(state, flap ? [makeInput(state.nextInputSequence, "FLAP")] : []);
    if (result.state.phase === "DEAD") {
      const rewardObservation = observedRewards.get(currentTarget);
      const stationObservation = observedStations.get(currentTarget) ??
        (rewardObservation ? matureRewardOwner(currentTarget, observedStations, state.tick) : undefined);
      terminal = { before: { tick: state.tick, score: state.score, y: state.duck.y, vy: state.duck.vy, flap,
        pipes: state.pipes.map(pipe => ({ stationId: pipe.stationId, x: pipe.x, gapCenter: pipe.gapCenter, obstacles: pipe.obstacles })) },
        after: { tick: result.state.tick, score: result.state.score, phase: result.state.phase, y: result.state.duck.y, vy: result.state.duck.vy },
        events: result.events, lastInputs: inputs.slice(-40), activeTarget: { id: currentTarget, y: targetY, type: targetType, gap: targetGap },
        matureStation: stationObservation && { ...stationObservation, maturityDelay: stationObservation.readyAt - stationObservation.observedAt },
        matureReward: rewardObservation && { ...rewardObservation, maturityDelay: rewardObservation.readyAt - rewardObservation.observedAt } };
    }
    result.events.filter(event => event.type === "CurrencyCollected").forEach(event => {
      collected.add(event.collectibleId);
      collectedAt.set(event.collectibleId, event.tick);
      const current = collectionEvents.get(event.collectibleId) ?? { count: 0, amount: 0 };
      collectionEvents.set(event.collectibleId, { count: current.count + 1, amount: current.amount + event.amount });
    });
    if (worldAdvances) {
      const expected = worldSpeedAt(config, state.tick + 1, state.score);
      for (const [stationId, x] of observedXs) observedXs.set(stationId, x - expected);
      for (const pipe of beforePipes) {
        const moved = result.state.pipes.find(item => item.id === pipe.id);
        if (moved) displacements.push({ tick: state.tick, stationId: pipe.stationId ?? pipe.id, actual: pipe.x - moved.x, expected, score: state.score });
      }
    }
    for (const event of result.events) if (event.type === "ObstaclePassed") {
      const passedStation = state.pipes.find(pipe => pipe.stationId === event.stationId);
      const obstacle = passedStation?.obstacles?.[0];
      if (obstacle) passedTypes.push({ stationId: event.stationId, type: obstacle.typeId,
        spanPercent: Math.round(obstacle.height * 100 / (state.config.pipes.floorY - state.config.pipes.ceilingY)) });
    }
    state = result.state;
    if (forcedFlapRange && state.tick === forcedFlapRange[1] + 1) branchCheckpoint = state;
  }
  return { state, initialState, profile, args: { seed, entryY, entryVy, scoreTarget, starIndex, pursueRewards, forcedFlapRange, profile, rolloutRewardIds,
    configIdentity: state.descriptor.configId, horizon: config.pipes.horizon, maxActivePipes: config.limits.maxActivePipes,
    maxActiveCollectibles: config.limits.maxActiveCollectibles, starSchedule: config.starSchedule },
    collected, collectedAt, collectionEvents, displacements, terminal, targetChanges, passedTypes, inputs, rewardRollouts,
    rewardRolloutDiagnostics, starWitness, ownerContinuationInputs, branchCheckpoint, observedStations, observedRewards };
}

type MatureGeometry = {
  stationId: string;
  observedAt: number;
  x: number;
  obstacles: NonNullable<RunState["pipes"][number]["obstacles"]>;
};

function planMatureRewardPickup(
  state: RunState,
  observed: MatureGeometry[],
  reward: { id: string; observedAt: number; readyAt: number; x: number; y: number; radius: number },
  width = 1024,
  maxHorizon = 60,
  diagnostics?: { reason?: string; predictedPickupTick?: number },
): boolean[] | undefined {
  const { flight, pipes } = state.config;
  if (state.tick < reward.readyAt) { if (diagnostics) diagnostics.reason = "reward-not-mature"; return undefined; }
  if (worldSpeedAt(state.config, state.tick + 1, state.score) !== pipes.maxSpeed) { if (diagnostics) diagnostics.reason = "speed-below-cap"; return undefined; }
  const displacementFrom = (fromTick: number, toTick: number) => {
    let distance = 0;
    for (let tick = fromTick + 1; tick <= toTick; tick += 1) distance += worldSpeedAt(state.config, tick, state.score);
    return distance;
  };
  const initialRewardX = reward.x - displacementFrom(reward.observedAt, state.tick);
  const observedX = new Map(observed.map(geometry => [geometry.stationId,
    geometry.x - displacementFrom(geometry.observedAt, state.tick)]));
  const futureDisplacements = [0];
  for (let offset = 1; offset <= maxHorizon; offset += 1)
    futureDisplacements.push(futureDisplacements[offset - 1]! + worldSpeedAt(state.config, state.tick + offset, state.score));
  const firstHorizontalOffset = Math.max(1, Math.ceil((initialRewardX - flight.duckX - reward.radius - flight.duckHalfWidth) / pipes.maxSpeed));
  if (firstHorizontalOffset > maxHorizon) { if (diagnostics) diagnostics.reason = "outside-rollout-horizon"; return undefined; }
  type Node = { y: number; vy: number; actions: boolean[] };
  let beam: Node[] = [{ y: state.duck.y, vy: state.duck.vy, actions: [] }];
  for (let offset = 1; offset <= maxHorizon; offset += 1) {
    const displacement = futureDisplacements[offset]!;
    const rewardX = initialRewardX - displacement;
    const dedup = new Map<string, Node>();
    for (const node of beam) for (const flap of [false, true]) {
      const vy = Math.min(flight.maxFallSpeed, (flap ? flight.flapVelocity : node.vy) + flight.gravity);
      const y = node.y + vy;
      if (y - flight.duckHalfHeight <= pipes.ceilingY || y + flight.duckHalfHeight >= pipes.floorY) continue;
      let dead = false;
      for (const geometry of observed) {
        const geometryX = observedX.get(geometry.stationId)! - displacement;
        for (const obstacle of geometry.obstacles) {
          const left = geometryX + obstacle.xOffset - Math.floor(obstacle.width / 2);
          const right = geometryX + obstacle.xOffset + Math.floor(obstacle.width / 2);
          if (right < flight.duckX - flight.duckHalfWidth || left > flight.duckX + flight.duckHalfWidth) continue;
          if (y + flight.duckHalfHeight >= obstacle.y && y - flight.duckHalfHeight <= obstacle.y + obstacle.height) {
            dead = true;
            break;
          }
        }
        if (dead) break;
      }
      if (dead) continue;
      const actions = [...node.actions, flap];
      if (Math.abs(rewardX - flight.duckX) <= reward.radius + flight.duckHalfWidth &&
        Math.abs(reward.y - y) <= reward.radius + flight.duckHalfHeight) {
        if (diagnostics) { diagnostics.reason = "pickup-predicted"; diagnostics.predictedPickupTick = state.tick + actions.length; }
        return actions;
      }
      const candidate: Node = { y, vy, actions };
      const key = `${y}:${vy}`;
      if (!dedup.has(key)) dedup.set(key, candidate);
    }
    beam = [...dedup.values()].sort((a, b) => {
      const verticalDistance = (y: number) => y < reward.y - reward.radius - flight.duckHalfHeight
        ? reward.y - reward.radius - flight.duckHalfHeight - y
        : y > reward.y + reward.radius + flight.duckHalfHeight
          ? y - reward.y - reward.radius - flight.duckHalfHeight : 0;
      return verticalDistance(a.y) * 4 + Math.abs(a.vy) - verticalDistance(b.y) * 4 - Math.abs(b.vy);
    }).slice(0, width);
    if (!beam.length) { if (diagnostics) diagnostics.reason = `no-survivor-at-offset-${offset}`; return undefined; }
  }
  if (diagnostics) diagnostics.reason = "no-pickup-within-rollout-horizon";
  return undefined;
}

function pairedPipeOpening(state: RunState, obstacles: MatureGeometry["obstacles"]): { top: number; bottom: number; center: number } | undefined {
  const { pipes } = state.config;
  const pair = obstacles.filter(obstacle => obstacle.typeId === "pipes");
  if (pair.length !== 2) return undefined;
  const top = pair.find(obstacle => obstacle.y === pipes.ceilingY);
  const bottom = pair.find(obstacle => obstacle.y + obstacle.height === pipes.floorY);
  if (!top || !bottom) return undefined;
  const openingTop = top.y + top.height;
  const openingBottom = bottom.y;
  if (openingBottom <= openingTop) return undefined;
  return { top: openingTop, bottom: openingBottom, center: Math.floor((openingTop + openingBottom) / 2) };
}

function preparedOuterBand(state: RunState, observed: MatureGeometry[]): [number, number] | undefined {
  const latestPipe = [...observed]
    .sort((a, b) => Number(a.stationId.slice(8)) - Number(b.stationId.slice(8)))
    .map(geometry => ({ geometry, opening: pairedPipeOpening(state, geometry.obstacles) }))
    .filter(item => item.opening !== undefined)
    .at(-1);
  if (!latestPipe?.opening) return undefined;
  const { pipes, flight } = state.config;
  const minY = pipes.ceilingY + flight.duckHalfHeight + 1;
  const maxY = pipes.floorY - flight.duckHalfHeight - 1;
  const depth88 = Math.floor((pipes.floorY - pipes.ceilingY) * 88 / 100);
  if (latestPipe.opening.bottom === pipes.floorY)
    return [pipes.ceilingY + depth88 + flight.duckHalfHeight + 1, maxY];
  if (latestPipe.opening.top === pipes.ceilingY)
    return [minY, pipes.floorY - depth88 - flight.duckHalfHeight - 1];
  return undefined;
}

function visiblePipeFlow(state: RunState, observed: MatureGeometry[]): { center: number; direction: -1 | 0 | 1 } | undefined {
  const openings = [...observed]
    .sort((a, b) => Number(a.stationId.slice(8)) - Number(b.stationId.slice(8)))
    .map(geometry => pairedPipeOpening(state, geometry.obstacles))
    .filter((opening): opening is NonNullable<typeof opening> => opening !== undefined);
  const current = openings.at(-1);
  const previous = openings.at(-2);
  if (!current) return undefined;
  const delta = previous ? current.center - previous.center : 0;
  return { center: current.center, direction: delta === 0 ? 0 : delta > 0 ? 1 : -1 };
}

function pipeFlowReference(flow: { center: number; direction: -1 | 0 | 1 } | undefined, fallback: number, offset: number, minY: number, maxY: number): number {
  return Math.max(minY, Math.min(maxY, (flow?.center ?? fallback) + (flow?.direction ?? 0) * 1_600 * offset));
}

function centerBand(state: RunState, obstacles: MatureGeometry["obstacles"]): [number, number] {
  const { flight, pipes } = state.config;
  const low = pipes.ceilingY + flight.duckHalfHeight + 1;
  const high = pipes.floorY - flight.duckHalfHeight - 1;
  const blocked = obstacles
    .filter(obstacle => Math.abs(obstacle.xOffset) <= flight.duckHalfWidth + Math.floor(obstacle.width / 2))
    .map(obstacle => [obstacle.y - flight.duckHalfHeight, obstacle.y + obstacle.height + flight.duckHalfHeight] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const free: [number, number][] = [];
  let cursor = low;
  for (const [a, b] of blocked) {
    if (cursor < a) free.push([cursor, a - 1]);
    cursor = Math.max(cursor, b + 1);
  }
  if (cursor <= high) free.push([cursor, high]);
  const interval = free.sort((a, b) =>
    (state.duck.y < a[0] ? a[0] - state.duck.y : state.duck.y > a[1] ? state.duck.y - a[1] : 0) -
    (state.duck.y < b[0] ? b[0] - state.duck.y : state.duck.y > b[1] ? state.duck.y - b[1] : 0))[0];
  if (!interval) throw new Error("visible geometry has no duck-center band");
  return interval;
}

function holdKernel(flight: RunState["config"]["flight"], band: [number, number]) {
  const firstVy = flight.flapVelocity + flight.gravity;
  const cycleTicks = 1 - 2 * firstVy / flight.gravity;
  let displacement = 0;
  let minimumDisplacement = 0;
  const positions: number[] = [];
  for (let tick = 1; tick <= cycleTicks; tick += 1) {
    displacement += firstVy + (tick - 1) * flight.gravity;
    positions.push(displacement);
    minimumDisplacement = Math.min(minimumDisplacement, displacement);
  }
  if (!Number.isInteger(cycleTicks) || displacement !== 0) throw new Error("flight physics has no integer zero-net hold cycle");
  const launchBand: [number, number] = [band[0] - minimumDisplacement, band[1]];
  const phaseAt = (y: number, vy: number): number | undefined => {
    for (let tick = 1; tick <= cycleTicks; tick += 1) {
      if (vy !== firstVy + (tick - 1) * flight.gravity) continue;
      const launchY = y - positions[tick - 1]!;
      if (launchY >= launchBand[0] && launchY <= launchBand[1]) return tick;
    }
    return undefined;
  };
  return { cycleTicks, minimumDisplacement, launchBand, phaseAt };
}

function planMatureGeometry(state: RunState, observed: MatureGeometry[], status: { reason: string; horizon: number; stationId: string; bandLow: number; bandHigh: number; targetY: number; preparedBand: string }, width = 1024, maxHorizon = 60): boolean[] | undefined {
  const { flight, pipes } = state.config;
  const speed = worldSpeedAt(state.config, state.tick + 1, state.score);
  if (speed !== pipes.maxSpeed) throw new Error("planned witness must start at maximum speed");
  const futureX = (geometry: MatureGeometry, offset: number) => geometry.x - speed * (state.tick + offset - geometry.observedAt);
  const overlaps = (geometry: MatureGeometry, obstacle: MatureGeometry["obstacles"][number], offset: number) => {
    const x = futureX(geometry, offset);
    const left = x + obstacle.xOffset - Math.floor(obstacle.width / 2);
    const right = x + obstacle.xOffset + Math.floor(obstacle.width / 2);
    return right >= flight.duckX - flight.duckHalfWidth && left <= flight.duckX + flight.duckHalfWidth;
  };
  const upcoming = observed.filter(geometry => geometry.obstacles.some(obstacle => {
    const x = futureX(geometry, 0);
    return x + obstacle.xOffset + Math.floor(obstacle.width / 2) >= flight.duckX - flight.duckHalfWidth;
  })).sort((a, b) => futureX(a, 0) - futureX(b, 0))[0];
  status.stationId = upcoming?.stationId ?? "open-world";
  const prepared = preparedOuterBand(state, observed);
  status.preparedBand = prepared?.join("..") ?? "none";
  const pipeFlow = visiblePipeFlow(state, observed);
  const laneGeometry = upcoming ?? observed.at(-1);
  const pipeOpening = laneGeometry ? pairedPipeOpening(state, laneGeometry.obstacles) : undefined;
  const [bandLow, bandHigh] = prepared ?? (laneGeometry ? centerBand(state, laneGeometry.obstacles) : [
    pipes.ceilingY + flight.duckHalfHeight + 1,
    pipes.floorY - flight.duckHalfHeight - 1,
  ]);
  const obstacleType = laneGeometry?.obstacles[0]?.typeId;
  const midpoint = Math.floor((bandLow + bandHigh) / 2);
  const kernel = prepared ? holdKernel(flight, prepared) : undefined;
  const margin = Math.min(18_000, Math.floor((bandHigh - bandLow) / 2));
  const targetY = kernel ? Math.floor((kernel.launchBand[0] + kernel.launchBand[1]) / 2) :
    obstacleType === "pipes" && pipeOpening ? pipeOpening.center :
      obstacleType === "vine" ? bandHigh - margin : obstacleType === "rock" ? bandLow + margin : midpoint;
  const flowDirection = kernel ? 0 : pipeFlow?.direction ?? 0;
  const flowReference = (offset: number) => pipeFlowReference(pipeFlow, targetY, offset,
    pipes.ceilingY + flight.duckHalfHeight + 1, pipes.floorY - flight.duckHalfHeight - 1);
  status.targetY = targetY;
  status.bandLow = bandLow;
  status.bandHigh = bandHigh;
  type Node = { y: number; vy: number; prepared: boolean; cycleStep: number; actions: boolean[] };
  const inPreparedBand = (y: number) => prepared !== undefined && y >= prepared[0] && y <= prepared[1];
  const initialCycleStep = kernel?.phaseAt(state.duck.y, state.duck.vy);
  let beam: Node[] = [{ y: state.duck.y, vy: state.duck.vy, prepared: initialCycleStep !== undefined, cycleStep: initialCycleStep ?? 0, actions: [] }];
  for (let offset = 1; offset <= maxHorizon; offset += 1) {
    const dedup = new Map<string, Node>();
    for (const node of beam) for (const flap of node.prepared ? [node.cycleStep === kernel!.cycleTicks] : [false, true]) {
      const vy = Math.min(flight.maxFallSpeed, (flap ? flight.flapVelocity : node.vy) + flight.gravity);
      const y = node.y + vy;
      if (y - flight.duckHalfHeight <= pipes.ceilingY || y + flight.duckHalfHeight >= pipes.floorY) continue;
      const startsHold = !node.prepared && flap && kernel !== undefined && node.y >= kernel.launchBand[0] && node.y <= kernel.launchBand[1];
      const preparedEntered = node.prepared || startsHold;
      if (node.prepared && !inPreparedBand(y)) continue;
      let dead = false;
      for (const geometry of observed) for (const obstacle of geometry.obstacles) {
        if (!overlaps(geometry, obstacle, offset)) continue;
        if (y + flight.duckHalfHeight >= obstacle.y && y - flight.duckHalfHeight <= obstacle.y + obstacle.height) { dead = true; break; }
      }
      if (dead) continue;
      const cycleStep = node.prepared ? node.cycleStep === kernel!.cycleTicks ? 1 : node.cycleStep + 1 : startsHold ? 1 : 0;
      const next: Node = { y, vy, prepared: preparedEntered, cycleStep, actions: [...node.actions, flap] };
      const key = `${y}:${vy}:${preparedEntered ? cycleStep : 0}`;
      const previous = dedup.get(key);
      if (!previous || next.actions.length < previous.actions.length) dedup.set(key, next);
    }
    beam = [...dedup.values()].sort((a, b) => {
      const bandDistance = (y: number) => y < bandLow ? bandLow - y : y > bandHigh ? y - bandHigh : 0;
      const launchDistance = (y: number) => kernel === undefined ? Math.abs(y - flowReference(offset)) : y < kernel.launchBand[0] ? kernel.launchBand[0] - y : y > kernel.launchBand[1] ? y - kernel.launchBand[1] : 0;
      const referenceVy = flowDirection * 1_600;
      return bandDistance(a.y) * 100 + launchDistance(a.y) + Math.abs(a.vy - referenceVy) * 2 -
        (bandDistance(b.y) * 100 + launchDistance(b.y) + Math.abs(b.vy - referenceVy) * 2);
    }).slice(0, width);
    if (!beam.length) { status.reason = `no-survivor-at-${offset}`; status.horizon = maxHorizon; return undefined; }
  }
  status.reason = "planned";
  status.horizon = maxHorizon;
  const winner = beam.sort((a, b) => {
    const launchDistance = (y: number) => kernel === undefined ? Math.abs(y - flowReference(maxHorizon)) : y < kernel.launchBand[0] ? kernel.launchBand[0] - y : y > kernel.launchBand[1] ? y - kernel.launchBand[1] : 0;
    const referenceVy = flowDirection * 1_600;
    return launchDistance(a.y) + Math.abs(a.vy - referenceVy) * 2 - (launchDistance(b.y) + Math.abs(b.vy - referenceVy) * 2);
  })[0];
  return winner?.actions;
}

function worldSafeBlindFlap(state: RunState): boolean {
  const { flight, pipes } = state.config;
  const coastVy = Math.min(flight.maxFallSpeed, state.duck.vy + flight.gravity);
  const coastY = state.duck.y + coastVy;
  const flapY = state.duck.y + Math.min(flight.maxFallSpeed, flight.flapVelocity + flight.gravity);
  const coastSafe = coastY - flight.duckHalfHeight > pipes.ceilingY && coastY + flight.duckHalfHeight < pipes.floorY;
  const flapSafe = flapY - flight.duckHalfHeight > pipes.ceilingY && flapY + flight.duckHalfHeight < pipes.floorY;
  if (!coastSafe && flapSafe) return true;
  if (!coastSafe) return false;
  const midpoint = Math.floor((pipes.ceilingY + pipes.floorY) / 2);
  return flapSafe && Math.abs(flapY - midpoint) < Math.abs(coastY - midpoint);
}

function minimumFlapCenter(state: RunState): number {
  const { flight } = state.config;
  let y = state.duck.y;
  let vy = flight.flapVelocity;
  let minimum = y;
  do {
    vy = Math.min(flight.maxFallSpeed, vy + flight.gravity);
    y += vy;
    minimum = Math.min(minimum, y);
  } while (vy < 0);
  return minimum;
}

function isFlapWorldSafe(state: RunState): boolean {
  return minimumFlapCenter(state) - state.config.flight.duckHalfHeight > state.config.pipes.ceilingY;
}

function isCoastWorldSafe(state: RunState): boolean {
  const { flight, pipes } = state.config;
  const nextY = state.duck.y + Math.min(flight.maxFallSpeed, state.duck.vy + flight.gravity);
  return nextY - flight.duckHalfHeight > pipes.ceilingY && nextY + flight.duckHalfHeight < pipes.floorY;
}

function finalWorldSafeAction(state: RunState, preferredFlap: boolean): boolean {
  const flapSafe = isFlapWorldSafe(state);
  const coastSafe = isCoastWorldSafe(state);
  if (preferredFlap && flapSafe) return true;
  if (!preferredFlap && coastSafe) return false;
  if (coastSafe) return false;
  if (flapSafe) return true;
  throw new Error(`no world-safe action at tick=${state.tick} y=${state.duck.y} vy=${state.duck.vy}`);
}

function runPlannedWitness(seed: number, entryY: number, entryVy: number, scoreTarget: number, rules: GameConfig,
  options: { forceCoastTicks?: readonly number[]; capturePlannerFailureAt?: number; captureTicks?: readonly number[] } = {}) {
  const config = { ...rules, pipes: { ...rules.pipes, horizon: 1_700_000 }, limits: { maxActivePipes: 24, maxActiveCollectibles: 25 }, starSchedule: null };
  let state = createRun(createRunDescriptor({ runId: `wetland-plan-${seed}-${scoreTarget}`, seed }, config), config);
  state = { ...state, phase: "RUNNING", tick: config.pipes.rampTicks, duck: { ...state.duck, y: entryY, vy: entryVy } };
  const initialState = state;
  const observations = new Map<string, MatureGeometry & { readyAt: number }>();
  const passed: { stationId: string; family: EncounterFamilyId | undefined; type: string; spanPercent: number; x: number; y: number; vy: number }[] = [];
  const entries = new Map<string, { x: number; y: number; vy: number; tick: number }>();
  const planning: { tick: number; mature: string[]; planned: number | null; y: number; vy: number; planner: { reason: string; horizon: number; stationId: string; bandLow: number; bandHigh: number; targetY: number; preparedBand: string } }[] = [];
  const inputs: { tick: number; flap: boolean }[] = [];
  const displacements: { tick: number; stationId: string; actual: number; expected: number }[] = [];
  const snapshots = new Map<number, RunState>();
  let plannerFailure: string | undefined;
  let plan: boolean[] = [];
  for (let frame = 0; frame < 6000 && state.score < scoreTarget && state.phase !== "DEAD"; frame += 1) {
    if (options.captureTicks?.includes(state.tick)) snapshots.set(state.tick, state);
    for (const station of state.pipes) if (station.stationId && station.x <= 360_000 && station.x >= state.duck.x - 40_000 && !observations.has(station.stationId))
      observations.set(station.stationId, { stationId: station.stationId, observedAt: state.tick, readyAt: state.tick + 18, x: station.x,
        obstacles: station.obstacles ?? [] });
    const mature = [...observations.values()].filter(item => state.tick >= item.readyAt);
    for (const geometry of mature) if (!entries.has(geometry.stationId)) {
      const currentX = geometry.x - worldSpeedAt(config, state.tick + 1, state.score) * (state.tick - geometry.observedAt);
      if (geometry.obstacles.some(obstacle => currentX + obstacle.xOffset + Math.floor(obstacle.width / 2) >= config.flight.duckX - config.flight.duckHalfWidth &&
          currentX + obstacle.xOffset - Math.floor(obstacle.width / 2) <= config.flight.duckX + config.flight.duckHalfWidth))
        entries.set(geometry.stationId, { x: currentX, y: state.duck.y, vy: state.duck.vy, tick: state.tick });
    }
    const newestMature = mature.some(item => item.readyAt === state.tick);
    if (newestMature || plan.length <= 18) {
      const status = { reason: "", horizon: 0, stationId: "", bandLow: entryY, bandHigh: entryY, targetY: entryY, preparedBand: "none" };
      const generated = planMatureGeometry(state, mature, status, 1024, 60);
      if (newestMature) planning.push({ tick: state.tick, mature: mature.map(item => item.stationId), planned: generated?.length ?? null, y: state.duck.y, vy: state.duck.vy, planner: status });
      if (mature.length && !generated) {
        const speed = worldSpeedAt(config, state.tick + 1, state.score);
        const relevant = mature.flatMap(geometry => {
          const x = geometry.x - speed * (state.tick - geometry.observedAt);
          return geometry.obstacles.filter(obstacle => x + obstacle.xOffset + Math.floor(obstacle.width / 2) >= state.duck.x - config.flight.duckHalfWidth &&
            x + obstacle.xOffset - Math.floor(obstacle.width / 2) <= state.duck.x + config.flight.duckHalfWidth + speed * 60)
            .map(obstacle => `${geometry.stationId}:${obstacle.typeId}@${x + obstacle.xOffset}/${obstacle.y}+${obstacle.height}x${obstacle.width}`);
        });
        const recentMature = mature.slice(-6).map(geometry => ({ stationId: geometry.stationId,
          observedAt: geometry.observedAt, readyAt: observations.get(geometry.stationId)?.readyAt,
          x: geometry.x - speed * (state.tick - geometry.observedAt), opening: pairedPipeOpening(state, geometry.obstacles),
          obstacles: geometry.obstacles.map(obstacle => `${obstacle.typeId}:${obstacle.y}+${obstacle.height}x${obstacle.width}`) }));
        const recentEntries = [...entries.entries()].filter(([id]) => Number(id.slice(8)) >= 16);
        plannerFailure = `bounded 60-tick planner failed at tick=${state.tick} score=${state.score} y=${state.duck.y} vy=${state.duck.vy} station=${status.stationId} target=${status.targetY} band=${status.bandLow}..${status.bandHigh} mature=${mature.length} recentPassed=${JSON.stringify(passed.slice(-5))} recentEntries=${JSON.stringify(recentEntries)} matureTrend=${JSON.stringify(recentMature)} actions=${JSON.stringify(inputs.slice(-36).map(input => Number(input.flap)))} relevant=${relevant.join(";")} reason=${status.reason}`;
        if (options.capturePlannerFailureAt !== state.tick) throw new Error(plannerFailure);
        break;
      }
      plan = generated ?? [];
    }
    const flap = options.forceCoastTicks?.includes(state.tick) ? false : plan.shift() ?? worldSafeBlindFlap(state);
    inputs.push({ tick: state.tick, flap });
    const advancesWorld = state.phase === "RUNNING" || (state.phase === "READY" && flap);
    const beforePipes = advancesWorld ? state.pipes.map(pipe => ({ id: pipe.id, stationId: pipe.stationId, x: pipe.x })) : [];
    const result = step(state, flap ? [makeInput(state.nextInputSequence, "FLAP")] : []);
    for (const event of result.events) if (event.type === "ObstaclePassed") {
      const station = state.pipes.find(pipe => pipe.stationId === event.stationId);
      const obstacle = station?.obstacles?.[0];
      if (obstacle) passed.push({ stationId: event.stationId, family: station?.encounterFamily, type: obstacle.typeId,
        spanPercent: Math.round(obstacle.height * 100 / (state.config.pipes.floorY - state.config.pipes.ceilingY)),
        x: result.state.pipes.find(pipe => pipe.stationId === event.stationId)?.x ?? 0, y: result.state.duck.y, vy: result.state.duck.vy });
    }
    if (advancesWorld) {
      const expected = worldSpeedAt(config, state.tick + 1, state.score);
      for (const pipe of beforePipes) {
        const moved = result.state.pipes.find(item => item.id === pipe.id);
        if (moved) displacements.push({ tick: state.tick, stationId: pipe.stationId ?? pipe.id,
          actual: pipe.x - moved.x, expected });
      }
    }
    state = result.state;
  }
  return { state, initialState, profile: "custom-cap" as const, passed, entries, inputs, displacements,
    observations: [...observations.values()], planning, snapshots, plannerFailure };
}

function runPairedGapPolicyWitness(seed: number, entryY: number, entryVy: number, normalDefault = false, scoreTarget = 33): { state: RunState; initialState: RunState;
  observations: { stationId: string; family: RunState["pipes"][number]["encounterFamily"]; observedAt: number; readyAt: number; x: number; gapCenter: number; obstacles: NonNullable<RunState["pipes"][number]["obstacles"]> }[];
  activations: { stationId: string; tick: number; gapCenter: number }[];
  passed: { stationId: string; family: RunState["pipes"][number]["encounterFamily"]; tick: number; score: number }[];
  collected: string[];
  inputs: { tick: number; flap: boolean }[];
  displacements: { tick: number; actual: number; expected: number }[] } {
  const config = normalDefault ? DEFAULT_CONFIG : { ...PAIRED_ROUTES_DEFAULT_CONFIG,
    pipes: { ...PAIRED_ROUTES_DEFAULT_CONFIG.pipes, horizon: 1_700_000 },
    limits: { maxActivePipes: 24, maxActiveCollectibles: 25 }, starSchedule: null };
  let state = createRun(createRunDescriptor({ runId: `paired-gap-policy-seed-${seed}`, seed }, config), config);
  if (!normalDefault) state = { ...state, phase: "RUNNING", tick: config.pipes.rampTicks,
    duck: { ...state.duck, y: entryY, vy: entryVy } };
  const initialState = state;
  const snapshots = new Map<string, { stationId: string; family: RunState["pipes"][number]["encounterFamily"]; observedAt: number; readyAt: number; x: number; gapCenter: number; obstacles: NonNullable<RunState["pipes"][number]["obstacles"]> }>();
  const observations: { stationId: string; family: RunState["pipes"][number]["encounterFamily"]; observedAt: number; readyAt: number; x: number; gapCenter: number; obstacles: NonNullable<RunState["pipes"][number]["obstacles"]> }[] = [];
  const activations: { stationId: string; tick: number; gapCenter: number }[] = [];
  const passed: { stationId: string; family: RunState["pipes"][number]["encounterFamily"]; tick: number; score: number }[] = [];
  const collected: string[] = [];
  const inputs: { tick: number; flap: boolean }[] = [];
  const displacements: { tick: number; actual: number; expected: number }[] = [];
  let targetIndex = -1;
  let observedTarget = state.duck.y;
  for (let frame = 0; frame < 6_000 && state.score < scoreTarget && state.phase !== "DEAD"; frame += 1) {
    for (const station of state.pipes) {
      if (!station.stationId || snapshots.has(station.stationId) || station.x > 360_000 || station.x < state.duck.x - 40_000) continue;
      const snapshot = { stationId: station.stationId, family: station.encounterFamily, observedAt: state.tick, readyAt: state.tick + 18,
        x: station.x, gapCenter: station.gapCenter, obstacles: (station.obstacles ?? []).map(obstacle => ({ ...obstacle })) };
      expect(snapshot.x, `${snapshot.stationId} center visibility`).toBeLessThanOrEqual(360_000);
      expect(snapshot.obstacles).toHaveLength(2);
      expect(snapshot.obstacles.every(obstacle => obstacle.typeId === "pipes" && obstacle.width > 0 && obstacle.height > 0)).toBe(true);
      snapshots.set(snapshot.stationId, snapshot);
      observations.push(snapshot);
    }
    const nextIndex = targetIndex + 1;
    const nextSnapshot = snapshots.get(`station-${nextIndex}`);
    if (nextSnapshot && state.tick >= nextSnapshot.readyAt) {
      expect(state.tick - nextSnapshot.observedAt).toBeGreaterThanOrEqual(18);
      targetIndex = nextIndex;
      observedTarget = nextSnapshot.gapCenter;
      activations.push({ stationId: nextSnapshot.stationId, tick: state.tick, gapCenter: observedTarget });
    }
    const flap = state.phase === "READY" || state.duck.y > observedTarget + 24_000;
    inputs.push({ tick: state.tick, flap });
    const expected = worldSpeedAt(config, state.tick + 1, state.score);
    const before = state.pipes.map(pipe => ({ id: pipe.id, x: pipe.x }));
    const result = step(state, flap ? [makeInput(state.nextInputSequence, "FLAP")] : []);
    for (const pipe of before) {
      const after = result.state.pipes.find(item => item.id === pipe.id);
      if (after) displacements.push({ tick: state.tick, actual: pipe.x - after.x, expected });
    }
    for (const event of result.events) if (event.type === "ObstaclePassed")
      passed.push({ stationId: event.stationId, family: snapshots.get(event.stationId)?.family, tick: event.tick, score: event.score });
    for (const event of result.events) if (event.type === "CurrencyCollected") collected.push(event.collectibleId);
    state = result.state;
  }
  return { state, initialState, observations, activations, passed, collected, inputs, displacements };
}

function runGeometryExitWitness(config: GameConfig, stations: RunState["pipes"]): { state: RunState; passed: string[]; inputs: { tick: number; flap: boolean }[]; displacements: { tick: number; stationId: string; actual: number; expected: number }[]; observations: { stationId: string; observedAt: number; readyAt: number }[]; activations: { tick: number; stations: string[] }[] } {
  let state = createRun(createRunDescriptor({ runId: "geometry-exit-witness", seed: 0 }, config), config);
  state = { ...state, phase: "RUNNING", tick: config.pipes.rampTicks,
    duck: { ...state.duck, y: 280_000, vy: 0 }, pipes: stations,
    nextPipeIndex: stations.length, nextPipeX: config.pipes.horizon + 1 };
  const observations = new Map<string, MatureGeometry & { readyAt: number }>();
  const passed: string[] = [];
  const inputs: { tick: number; flap: boolean }[] = [];
  const displacements: { tick: number; stationId: string; actual: number; expected: number }[] = [];
  const activations: { tick: number; stations: string[] }[] = [];
  let plan: boolean[] = [];
  for (let frame = 0; frame < 1_000 && state.phase === "RUNNING"; frame += 1) {
    for (const station of state.pipes) if (station.stationId && station.x <= 360_000 && station.x >= state.duck.x - 40_000 && !observations.has(station.stationId))
      observations.set(station.stationId, { stationId: station.stationId, observedAt: state.tick, readyAt: state.tick + 18,
        x: station.x, obstacles: station.obstacles ?? [] });
    const mature = [...observations.values()].filter(item => state.tick >= item.readyAt);
    const newMature = mature.some(item => item.readyAt === state.tick);
    if (newMature || plan.length <= 18) {
      const status = { reason: "", horizon: 0, stationId: "", bandLow: 0, bandHigh: 0, targetY: 0, preparedBand: "none" };
      const generated = planMatureGeometry(state, mature, status, 1024, 60);
      if (mature.length && !generated) throw new Error(`exit witness planner failed at tick=${state.tick} y=${state.duck.y} vy=${state.duck.vy} ${status.reason}`);
      if (newMature) activations.push({ tick: state.tick, stations: mature.filter(item => item.readyAt === state.tick).map(item => item.stationId) });
      plan = generated ?? [];
    }
    const flap = plan.shift() ?? worldSafeBlindFlap(state);
    inputs.push({ tick: state.tick, flap });
    const before = state.pipes.map(pipe => ({ id: pipe.id, stationId: pipe.stationId, x: pipe.x }));
    const result = step(state, flap ? [makeInput(state.nextInputSequence, "FLAP")] : []);
    const expected = worldSpeedAt(config, state.tick + 1, state.score);
    for (const pipe of before) {
      const moved = result.state.pipes.find(item => item.id === pipe.id);
      if (moved) displacements.push({ tick: state.tick, stationId: pipe.stationId ?? pipe.id, actual: pipe.x - moved.x, expected });
    }
    for (const event of result.events) if (event.type === "ObstaclePassed") passed.push(event.stationId);
    state = result.state;
    if (passed.includes(stations[1]?.stationId ?? "") && !state.pipes.some(pipe => pipe.stationId === stations[1]?.stationId)) break;
  }
  return { state, passed, inputs, displacements, activations, observations: [...observations.values()].map(({ stationId, observedAt, readyAt }) => ({ stationId, observedAt, readyAt })) };
}

function replayHalfPipeRoute(config: GameConfig, seed: number, obstacleHeight: number, stationX: number, initialTick: number, prelude: string, crossing: string) {
  let state = createRun(createRunDescriptor({ runId: `half-pipe-replay-${seed}-${obstacleHeight}`, seed }, config), config);
  const station = {
    ...state.pipes[0]!,
    x: stationX,
    index: 0,
    scored: false,
    stationId: "station-0",
    stationStep: 0,
    encounterFamily: "steady" as const,
    obstacles: [{ typeId: "vine" as const, xOffset: 0, y: config.pipes.ceilingY, width: config.pipes.width, height: obstacleHeight }],
  };
  state = { ...state, phase: "RUNNING", tick: initialTick, duck: { ...state.duck, y: 280_000, vy: 0 }, pipes: [station], nextPipeX: config.pipes.horizon + 1 };
  const events: GameEvent[] = [];
  const run = (actions: string) => {
    for (const action of actions) {
      const result = step(state, action === "1" ? [makeInput(state.nextInputSequence, "FLAP")] : []);
      events.push(...result.events);
      state = result.state;
      if (state.phase !== "RUNNING") break;
    }
  };
  run(prelude);
  const entry = { y: state.duck.y, vy: state.duck.vy };
  run(crossing);
  const crossingExit = { y: state.duck.y, vy: state.duck.vy };
  run("0");
  return { state, entry, crossingExit, events };
}

const wetlandFixture = JSON.parse(readFileSync("contracts/simulation/wetland-v1.json", "utf8")) as {
  fixtureRevision: string;
  simulationVersion: string;
  generatorVersion: string;
  configId: string;
  seed: number;
  familySequence: EncounterFamilyId[];
  catalog: { id: EncounterFamilyId; gapCenters: number[]; obstacleTypes: string[]; stationSpacing: number[]; rewardRoute: { xOffset: number; yOffset: number }[] }[];
  starRoute: { xOffset: number; yOffset: number };
  cases: { name: string; syntheticInitialState: boolean; initialState: RunState; operations: { kind: string; frames?: InputFrame[]; expectedState: RunState; expectedEvents: GameEvent[] }[] }[];
};
const validationFixture = JSON.parse(readFileSync("contracts/simulation/wetland-config-validation.json", "utf8")) as {
  cases: {
    name: string; accepted: boolean; varied?: boolean; noStars?: boolean; withChallenges?: boolean;
    removeFeather?: boolean; recoverySpacing?: number;
    removeGeometry?: boolean;
    geometry?: Partial<NonNullable<GameConfig["wetland"]>["geometry"]>;
    worldOffset?: number;
    introLaneCenter?: { index: number; value: number };
    limits?: Partial<GameConfig["limits"]>; flight?: Partial<GameConfig["flight"]>;
    pipes?: Partial<GameConfig["pipes"]>;
    coin?: { family: EncounterFamilyId; step: number; xOffset?: number; yOffset?: number };
    starRoute?: { xOffset?: number; yOffset?: number };
  }[];
};
const variedWetlandFixture = JSON.parse(readFileSync("contracts/simulation/wetland-v2.json", "utf8")) as typeof wetlandFixture;
const pairedWetlandFixture = JSON.parse(readFileSync("contracts/simulation/wetland-v3.json", "utf8")) as typeof wetlandFixture;
const currencyFormationsFixture = JSON.parse(readFileSync("contracts/simulation/currency-formations-v1.json", "utf8")) as typeof wetlandFixture;
const variedValidationFixture = JSON.parse(readFileSync("contracts/simulation/wetland-v2-config-validation.json", "utf8")) as typeof validationFixture;
const pairedValidationFixture = JSON.parse(readFileSync("contracts/simulation/wetland-v3-config-validation.json", "utf8")) as {
  cases: { name: string; accepted: boolean; paired: true; mutation?: "custom-center" | "mixed-obstacle" | "varied-geometry" | "zero-height-pipe" }[];
};

describe("wetland station contract", () => {
  it("checks the full discrete flap ascent against the public ceiling", () => {
    const config = VARIED_OBSTACLE_DEFAULT_CONFIG;
    const initial = createRun(createRunDescriptor({ runId: "flap-ascent-bound", seed: 0 }, config), config);
    const atKnownUnsafeApex = { ...initial, phase: "RUNNING" as const,
      duck: { ...initial.duck, y: 55_860, vy: 0 } };
    const atSafeApex = { ...atKnownUnsafeApex, duck: { ...atKnownUnsafeApex.duck, y: 56_241 } };
    expect(minimumFlapCenter(atKnownUnsafeApex)).toBe(9_620);
    expect(isFlapWorldSafe(atKnownUnsafeApex)).toBe(false);
    expect(minimumFlapCenter(atSafeApex)).toBe(10_001);
    expect(isFlapWorldSafe(atSafeApex)).toBe(true);
    expect(finalWorldSafeAction(atKnownUnsafeApex, true)).toBe(false);
    const noWorldSafeAction = { ...initial, phase: "RUNNING" as const,
      duck: { ...initial.duck, y: 15_000, vy: -8_000 } };
    expect(() => finalWorldSafeAction(noWorldSafeAction, false)).toThrow(/no world-safe action/);
  });

  it("retains a safe existing survival reference for a matured debris snapshot", () => {
    const config = VARIED_OBSTACLE_DEFAULT_CONFIG;
    const state = createRun(createRunDescriptor({ runId: "mature-debris-reference", seed: 0 }, config), config);
    const snapshot = { type: "debris", obstacles: [
      { typeId: "debris" as const, xOffset: 0, y: 412_902, width: 216_000, height: 42_000 },
    ] };
    expect(retainSafeDebrisReference(state, 35_001, snapshot)).toBe(35_001);
    expect(retainSafeDebrisReference(state, 433_902, snapshot)).toBeUndefined();
    expect(retainSafeDebrisReference(state, 35_001, { ...snapshot, type: "rock" })).toBeUndefined();
  });

  it("checks mature emergency rectangles from the captured public snapshot", () => {
    const config = VARIED_OBSTACLE_DEFAULT_CONFIG;
    const initial = createRun(createRunDescriptor({ runId: "captured-emergency-geometry", seed: 0 }, config), config);
    const station = { ...initial.pipes[0]!, stationId: "station-0", obstacles: [] };
    const state = { ...initial, phase: "RUNNING" as const, tick: 1,
      duck: { ...initial.duck, y: 30_000, vy: 0 }, pipes: [station] };
    const observed = new Map<string, RewardOwnerSnapshot & { y: number }>([["station-0", {
      readyAt: 1, observedAt: 0, x: 103_000, y: 30_000, type: "debris", gap: 280_000,
      obstacles: [{ typeId: "debris", xOffset: 0, y: 35_000, width: 52_000, height: 5_000 }],
    }]]);
    const observedXs = new Map([["station-0", 103_000]]);
    const speed = worldSpeedAt(config, state.tick + 1, state.score);
    expect(emergencyObstacleNeedsFlap(state, observed, observedXs, speed)).toBe(true);
  });

  it("issues paired routes while retaining frozen varied and 2.0 wetland identities", () => {
    expect([SIMULATION_VERSION, GENERATOR_VERSION, DEFAULT_CONFIG_ID]).toEqual([
      "2.3.0", "2.3.0", "dd-v2-currency-formations-v1",
    ]);
    expect(createRunDescriptor({ runId: "paired", seed: 4 })).toMatchObject({
      simulationVersion: SIMULATION_VERSION, generatorVersion: GENERATOR_VERSION, configId: DEFAULT_CONFIG_ID,
    });
    expect(createRunDescriptor({ runId: "paired-frozen", seed: 4 }, PAIRED_ROUTES_DEFAULT_CONFIG)).toMatchObject({
      simulationVersion: PAIRED_ROUTES_SIMULATION_VERSION, generatorVersion: PAIRED_ROUTES_GENERATOR_VERSION, configId: PAIRED_ROUTES_CONFIG_ID,
    });
    expect(createRunDescriptor({ runId: "varied", seed: 4 }, VARIED_OBSTACLE_DEFAULT_CONFIG)).toMatchObject({
      simulationVersion: VARIED_OBSTACLE_SIMULATION_VERSION, generatorVersion: VARIED_OBSTACLE_GENERATOR_VERSION,
      configId: VARIED_OBSTACLE_DEFAULT_CONFIG_ID,
    });
    expect(createRunDescriptor({ runId: "wetland-v2", seed: 4 }, WETLAND_DEFAULT_CONFIG)).toMatchObject({
      simulationVersion: "2.0.0", generatorVersion: "2.0.0", configId: "dd-v2-wetland-v1",
    });
    expect(WETLAND_DEFAULT_CONFIG.wetland?.catalogVersion).toBe(1);
    expect(VARIED_OBSTACLE_DEFAULT_CONFIG.wetland?.catalogVersion).toBe(2);
  });

  it("generates paired-only stations with authored family spacing and reward routes", () => {
    const state = createRun(createRunDescriptor({ runId: "paired-default-shape", seed: 7 }, PAIRED_ROUTES_DEFAULT_CONFIG), PAIRED_ROUTES_DEFAULT_CONFIG);
    expect(state.config.wetland?.catalogVersion).toBe(3);
    expect(state.pipes.length).toBeGreaterThan(0);
    expect(state.pipes.every(pipe => pipe.obstacles?.length === 2 && pipe.obstacles.every(rect => rect.typeId === "pipes" && rect.height > 0))).toBe(true);
    const expected = state.config.wetland!.families.find(family => family.id === state.pipes[0]!.encounterFamily)!;
    expect(state.pipes.map(pipe => pipe.stationSpacing)).toEqual(expected.stationSpacing.slice(0, state.pipes.length));
    expect(state.pipes[0]!.stationSpacing).toBe(expected.stationSpacing[0]);
    const coinPoint = wetlandRewardPoint(state.config, state.pipes[0]!, 7_000);
    expect(coinPoint.x).toBe(state.pipes[0]!.x + expected.rewardRoute[0]!.xOffset);
    expect(WETLAND_DEFAULT_CONFIG.wetland!.starRoute).toEqual({ xOffset: 100_000, yOffset: 70_000 });
    expect(state.config.wetland!.starRoute).toEqual({ xOffset: 100_000, yOffset: 35_000 });
  });

  it("accepts the catalog-3 paired-routes shape and rejects mixed obstacles", () => {
    const paired = structuredClone(WETLAND_DEFAULT_CONFIG) as Mutable<GameConfig>;
    paired.wetland!.catalogVersion = 3;
    paired.wetland!.families = paired.wetland!.families.map(family => ({
      ...family, obstacleTypes: family.obstacleTypes.map(() => "pipes" as const),
    }));
    expect(() => validateConfig(paired)).not.toThrow();
    const mixed = structuredClone(paired) as Mutable<GameConfig>;
    mixed.wetland!.families[0]!.obstacleTypes[1] = "vine";
    expect(() => validateConfig(mixed)).toThrow(/wetland/i);
  });

  it("keeps a scored station rendered until its full rectangle is offscreen", () => {
    const config = { ...VARIED_OBSTACLE_DEFAULT_CONFIG, pipes: { ...VARIED_OBSTACLE_DEFAULT_CONFIG.pipes, horizon: 600_000 } };
    let state = createRun(createRunDescriptor({ runId: "varied-retention", seed: 8 }, config), config);
    const station = {
      ...state.pipes[0]!, x: 100_000, scored: false,
      obstacles: [{ typeId: "debris" as const, xOffset: 0, y: 100_000, width: 180_000, height: 42_000 }],
    };
    state = { ...state, phase: "RUNNING", tick: config.pipes.rampTicks, pipes: [station],
      duck: { ...state.duck, y: 280_000, vy: 0 } };
    let passed = 0;
    let scored = false;
    for (let tick = 0; tick < 80; tick += 1) {
      const result = step(state, []);
      const passedNow = result.events.filter(event => event.type === "ObstaclePassed").length;
      passed += passedNow;
      state = { ...result.state, duck: { ...result.state.duck, y: 280_000, vy: 0 } };
      if (passedNow) expect(state.pipes.some(pipe => pipe.stationId === station.stationId)).toBe(true);
      scored ||= state.pipes.some(pipe => pipe.stationId === station.stationId && pipe.scored);
      if (scored && !state.pipes.some(pipe => pipe.stationId === station.stationId)) break;
      if (scored && state.pipes.length) {
        const retained = state.pipes.find(pipe => pipe.stationId === station.stationId);
        expect(retained).toBeDefined();
        expect(retained!.x + 90_000 + config.pipes.width).toBeGreaterThanOrEqual(0);
      }
    }
    expect(passed).toBe(1);
    expect(scored).toBe(true);
    expect(state.pipes.some(pipe => pipe.stationId === station.stationId)).toBe(false);
  });

  it("retains paired catalog geometry through once-only scoring and prunes after the full pair exits", () => {
    const config = { ...DEFAULT_CONFIG, pipes: { ...DEFAULT_CONFIG.pipes, width: 100_000 } };
    const initial = createRun(createRunDescriptor({ runId: "paired-retention", seed: 8 }, config), config);
    const station = {
      ...initial.pipes[0]!, x: 20_000, scored: false, gapCenter: 310_000,
      obstacles: [
        { typeId: "pipes" as const, xOffset: 50_000, y: config.pipes.ceilingY, width: 100_000, height: 190_000 },
        { typeId: "pipes" as const, xOffset: 50_000, y: 360_000, width: 100_000, height: config.pipes.floorY - 360_000 },
      ],
    };
    let state: RunState = { ...initial, phase: "RUNNING", tick: config.pipes.rampTicks, pipes: [station],
      duck: { ...initial.duck, y: 310_000, vy: 0 } };
    let passed = 0;
    let scoreEvents = 0;
    let scored = false;
    for (let tick = 0; tick < 100; tick += 1) {
      const result = step(state, []);
      const newPasses = result.events.filter(event => event.type === "ObstaclePassed");
      passed += newPasses.length;
      scoreEvents += newPasses.length;
      state = { ...result.state, duck: { ...result.state.duck, y: 310_000, vy: 0 } };
      if (newPasses.length) expect(state.pipes.some(pipe => pipe.stationId === station.stationId)).toBe(true);
      scored ||= state.pipes.some(pipe => pipe.stationId === station.stationId && pipe.scored);
      if (scored && !state.pipes.some(pipe => pipe.stationId === station.stationId)) break;
      const retained = state.pipes.find(pipe => pipe.stationId === station.stationId);
      if (scored && retained) {
        const rightmost = Math.max(...(retained.obstacles ?? []).map(obstacle => obstacle.xOffset + Math.floor(obstacle.width / 2)));
        expect(retained.x + rightmost + config.pipes.width).toBeGreaterThanOrEqual(0);
      }
    }
    expect(passed).toBe(1);
    expect(scoreEvents).toBe(1);
    expect(scored).toBe(true);
    expect(state.pipes.some(pipe => pipe.stationId === station.stationId)).toBe(false);

    const lethal = { ...initial, phase: "RUNNING" as const, pipes: [{ ...station, x: 60_000, scored: false }],
      duck: { ...initial.duck, y: config.pipes.floorY - config.flight.duckHalfHeight - 1, vy: 0 } };
    const fatal = step(lethal, []);
    expect(fatal.state.phase).toBe("DEAD");
    expect(fatal.events.filter(event => event.type === "ObstaclePassed")).toHaveLength(0);
  });

  it("realizes deterministic seeded 70–90 percent half-pipes and varied floating-bar sizes", () => {
    expect(VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.gapMinCenter).toBe(78_000);
    expect(VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.gapMaxCenter).toBe(483_000);
    const halfSpans = new Set<number>();
    const ceilingSpans = new Set<number>();
    const barWidths = new Set<number>();
    for (let seed = 0; seed < 2_000; seed += 1) {
      const config = { ...VARIED_OBSTACLE_DEFAULT_CONFIG, starSchedule: null, limits: { maxActivePipes: 20, maxActiveCollectibles: 20 }, pipes: { ...VARIED_OBSTACLE_DEFAULT_CONFIG.pipes, horizon: 5_000_000 } };
      const first = createRun(createRunDescriptor({ runId: `varied-${seed}`, seed }, config), config);
      const repeated = createRun(createRunDescriptor({ runId: `varied-${seed}`, seed }, config), config);
      expect(first.pipes).toEqual(repeated.pipes);
      for (const station of first.pipes) for (const obstacle of station.obstacles ?? []) {
        if (obstacle.typeId === "vine" || obstacle.typeId === "rock") {
          const percent = Math.round(obstacle.height * 100 / (VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.floorY - VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.ceilingY));
          halfSpans.add(percent);
          if (obstacle.typeId === "vine") {
            ceilingSpans.add(percent);
            expect(percent).toBeLessThanOrEqual(88);
          }
        }
        if (obstacle.typeId === "debris") barWidths.add(obstacle.width);
      }
    }
    expect(Math.min(...halfSpans)).toBe(70);
    expect(Math.max(...ceilingSpans)).toBe(88);
    expect(Math.max(...halfSpans)).toBe(90);
    const lateConfig = { ...VARIED_OBSTACLE_DEFAULT_CONFIG, pipes: { ...VARIED_OBSTACLE_DEFAULT_CONFIG.pipes, maxGapDelta: 120_000, horizon: 500_000 } };
    let lateRockAt90 = false;
    for (let seed = 0; seed < 2_000 && !lateRockAt90; seed += 1) {
      const state = createRun(createRunDescriptor({ runId: `late-ceiling-${seed}`, seed }, lateConfig), lateConfig);
      const late = generateNext({ ...state, pipes: [], nextPipeIndex: 56, nextPipeX: lateConfig.pipes.safeLeadIn, lastGapCenter: 483_000 }).state.pipes[0];
      const vine = late?.obstacles?.find(obstacle => obstacle.typeId === "vine");
      const rock = late?.obstacles?.find(obstacle => obstacle.typeId === "rock");
      if (vine) expect(Math.round(vine.height * 100 / (lateConfig.pipes.floorY - lateConfig.pipes.ceilingY))).toBeLessThanOrEqual(88);
      lateRockAt90 = rock !== undefined && Math.round(rock.height * 100 / (lateConfig.pipes.floorY - lateConfig.pipes.ceilingY)) === 90;
    }
    expect(lateRockAt90).toBe(true);
    expect(barWidths.size).toBeGreaterThan(10);
    expect(Math.min(...barWidths)).toBe(90_000);
    expect(Math.max(...barWidths)).toBe(216_000);
  }, 30_000);

  it("keeps all generated ceiling halves at or below 88 percent, including late stations", () => {
    const config = { ...VARIED_OBSTACLE_DEFAULT_CONFIG, starSchedule: null, pipes: { ...VARIED_OBSTACLE_DEFAULT_CONFIG.pipes, horizon: 10_000_000 } };
    for (let seed = 0; seed < 64; seed += 1) {
      const state = createRun(createRunDescriptor({ runId: `ceiling-cap-${seed}`, seed }, config), config);
      const late = generateNext({ ...state, pipes: [], nextPipeIndex: 56, nextPipeX: config.pipes.safeLeadIn, lastGapCenter: 483_000 }).state.pipes[0];
      for (const obstacle of late?.obstacles ?? []) if (obstacle.typeId === "vine")
        expect(Math.round(obstacle.height * 100 / (config.pipes.floorY - config.pipes.ceilingY))).toBeLessThanOrEqual(88);
    }
  });

  it("keeps the 88 percent outer corridors inside opposite edge-pipe openings", () => {
    const { pipes, flight } = VARIED_OBSTACLE_DEFAULT_CONFIG;
    const height88 = Math.floor((pipes.floorY - pipes.ceilingY) * 88 / 100);
    const duckLow = pipes.ceilingY + flight.duckHalfHeight + 1;
    const duckHigh = pipes.floorY - flight.duckHalfHeight - 1;
    const halfGap = Math.floor(pipes.gapHeight / 2);
    const bottomPipeBand: [number, number] = [483_000 - halfGap + flight.duckHalfHeight + 1, 483_000 + halfGap - flight.duckHalfHeight - 1];
    const bottomVineBand: [number, number] = [pipes.ceilingY + height88 + flight.duckHalfHeight + 1, duckHigh];
    const topPipeBand: [number, number] = [78_000 - halfGap + flight.duckHalfHeight + 1, 78_000 + halfGap - flight.duckHalfHeight - 1];
    const topRockBand: [number, number] = [duckLow, pipes.floorY - height88 - flight.duckHalfHeight - 1];

    expect(Math.max(bottomPipeBand[0], bottomVineBand[0])).toBeLessThanOrEqual(Math.min(bottomPipeBand[1], bottomVineBand[1]));
    expect(Math.max(topPipeBand[0], topRockBand[0])).toBeLessThanOrEqual(Math.min(topPipeBand[1], topRockBand[1]));
  });

  it("diagnoses a reachable 90 percent bottom-vine crossing at cap after the full visible reaction delay", () => {
    const config = VARIED_OBSTACLE_DEFAULT_CONFIG;
    const speed = config.pipes.maxSpeed;
    const prelude = "00000000000000000000000000000000000000000000100000000000000000000000000";
    const crossing = "000000001000000";
    const firstContactX = config.flight.duckX + config.flight.duckHalfWidth + Math.floor(config.pipes.width / 2);
    const stationX = firstContactX + speed * prelude.length;
    const firstVisibleOffset = Math.ceil((stationX - 360_000) / speed);
    const firstPolicyOffset = firstVisibleOffset + 18;
    const height = Math.floor((config.pipes.floorY - config.pipes.ceilingY) * 90 / 100);
    const result = replayHalfPipeRoute(config, 90, height, stationX, config.pipes.rampTicks, prelude, crossing);

    expect(prelude.length).toBe(71);
    expect(crossing.length + 1).toBe(16);
    expect(prelude.slice(0, firstPolicyOffset)).toBe("0".repeat(firstPolicyOffset));
    expect(result.entry).toEqual({ y: 515_080, vy: 3_040 });
    expect(result.crossingExit).toEqual({ y: 520_680, vy: -3_360 });
    expect(result.state.phase).toBe("RUNNING");
    expect(result.state.score).toBe(1);
    expect(result.events.filter(event => event.type === "ObstaclePassed")).toHaveLength(1);
  });

  it("replays a reachable 88 percent ceiling crossing through the full-width bar at base speed", () => {
    const config = { ...VARIED_OBSTACLE_DEFAULT_CONFIG, pipes: { ...VARIED_OBSTACLE_DEFAULT_CONFIG.pipes, maxSpeed: VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.speed } };
    const speed = config.pipes.speed;
    const prelude = "000000000000000000000000000000000000000000001000000000000000000000000000000000010000";
    const crossing = "0000000000000000000000000";
    const firstContactX = config.flight.duckX + config.flight.duckHalfWidth + Math.floor(config.pipes.width / 2);
    const stationX = firstContactX + speed * prelude.length;
    const firstVisibleOffset = Math.ceil((stationX - 360_000) / speed);
    const firstPolicyOffset = firstVisibleOffset + 18;
    const height = Math.floor((config.pipes.floorY - config.pipes.ceilingY) * 88 / 100);
    const result = replayHalfPipeRoute(config, 88, height, stationX, 0, prelude, crossing);

    expect(prelude.length).toBe(84);
    expect(crossing.length + 1).toBe(26);
    expect(prelude.slice(0, firstPolicyOffset)).toBe("0".repeat(firstPolicyOffset));
    expect(result.entry).toEqual({ y: 527_720, vy: -4_000 });
    expect(result.crossingExit).toEqual({ y: 531_720, vy: 4_000 });
    expect(result.state.phase).toBe("RUNNING");
    expect(result.state.score).toBe(1);
    expect(result.events.filter(event => event.type === "ObstaclePassed")).toHaveLength(1);
  });

  it("authors pressure polarity by block and a bounded recovery connector toward the next lane", () => {
    const config = {
      ...VARIED_OBSTACLE_DEFAULT_CONFIG,
      starSchedule: null,
      limits: { maxActivePipes: 12, maxActiveCollectibles: 12 },
      pipes: { ...VARIED_OBSTACLE_DEFAULT_CONFIG.pipes, maxGapDelta: 120_000, horizon: 10_000_000 },
    };
    const polarityTypes = new Set<string>();
    for (let seed = 0; seed < 32; seed += 1) {
      const descriptor = createRunDescriptor({ runId: `lane-recipe-${seed}`, seed }, config);
      const initial = createRun(descriptor, config);
      const candidates = [config.pipes.gapMinCenter, config.pipes.gapMaxCenter].map(lastGapCenter => generateNext({
        ...initial,
        pipes: [],
        nextPipeIndex: 56,
        nextPipeX: config.pipes.safeLeadIn,
        lastGapCenter,
      }).state.pipes);
      const stations = candidates.find(candidate => {
        const first = candidate.find(station => station.index === 56);
        return first?.gapCenter === config.pipes.gapMinCenter || first?.gapCenter === config.pipes.gapMaxCenter;
      })!;
      const pressureStart = stations.find(station => station.index === 56)!;
      const pressureEnd = stations.find(station => station.index === 59)!;
      const recovery = stations.filter(station => station.index >= 60 && station.index <= 63);
      const nextPressure = stations.find(station => station.index === 64)!;
      const verticalHalf = pressureStart.obstacles?.find(obstacle => obstacle.typeId === "vine" || obstacle.typeId === "rock");
      expect(verticalHalf, `seed=${seed}`).toBeDefined();
      polarityTypes.add(verticalHalf!.typeId);
      const lane = verticalHalf!.typeId === "rock" ? config.pipes.gapMinCenter : config.pipes.gapMaxCenter;
      const nextLane = nextPressure.obstacles?.some(obstacle => obstacle.typeId === "rock")
        ? config.pipes.gapMinCenter : config.pipes.gapMaxCenter;
      expect(pressureStart.gapCenter).toBe(lane);
      expect(pressureEnd.gapCenter).toBe(lane);
      expect(recovery).toHaveLength(4);
      const expectedRecovery = lane === nextLane ? Array(4).fill(lane) : lane === config.pipes.gapMinCenter
        ? [100_000, 220_000, 340_000, 460_000] : [430_000, 310_000, 190_000, 78_000];
      expect(recovery.map(station => station.gapCenter)).toEqual(expectedRecovery);
      expect([...recovery.map(station => station.gapCenter), nextPressure.gapCenter].every((center, index, centers) =>
        index === 0 || Math.abs(center - centers[index - 1]!) <= 120_000)).toBe(true);
    }
    expect(polarityTypes).toEqual(new Set(["vine", "rock"]));
  });

  it("prepares the seeded edge lane with the last intro pipe", () => {
    for (let seed = 0; seed < 8; seed += 1) {
      const config = { ...VARIED_OBSTACLE_DEFAULT_CONFIG, starSchedule: null, pipes: { ...VARIED_OBSTACLE_DEFAULT_CONFIG.pipes, horizon: 10_000_000 } };
      const initial = createRun(createRunDescriptor({ runId: `intro-edge-${seed}`, seed }, config), config);
      const stations = generateNext({ ...initial, pipes: [], nextPipeIndex: 0, nextPipeX: config.pipes.safeLeadIn }).state.pipes;
      const introEdge = stations.find(station => station.index === 3)!;
      const topEdge = introEdge.gapCenter === config.pipes.gapMinCenter;
      expect(stations.filter(station => station.index <= 3).map(station => station.gapCenter)).toEqual(
        topEdge ? [281_000, 221_000, 161_000, 78_000] : [280_000, 340_000, 400_000, 483_000],
      );
      expect(stations.filter(station => station.index >= 4 && station.index <= 7).map(station => station.gapCenter))
        .toEqual(Array(4).fill(introEdge.gapCenter));
      expect([config.pipes.gapMinCenter, config.pipes.gapMaxCenter]).toContain(introEdge.gapCenter);
      expect(stations.filter(station => station.index <= 7).every(station => station.gapCenter >= config.pipes.gapMinCenter && station.gapCenter <= config.pipes.gapMaxCenter)).toBe(true);
      expect(stations.filter(station => station.index <= 7).every((station, index, selected) => index === 0 ||
        Math.abs(station.gapCenter - selected[index - 1]!.gapCenter) <= config.pipes.maxGapDelta)).toBe(true);
      const topRect = introEdge.obstacles!.find(obstacle => obstacle.y === config.pipes.ceilingY)!;
      const bottomRect = introEdge.obstacles!.find(obstacle => obstacle.y + obstacle.height === config.pipes.floorY)!;
      const center = Math.floor((topRect.y + topRect.height + bottomRect.y) / 2);
      expect(center).toBe(introEdge.gapCenter);
    }
  });

  it("activates the prepared lane only after the edge pipe has matured for 18 ticks", () => {
    const seeds = new Map<number, number>();
    for (let seed = 0; seed < 32 && seeds.size < 2; seed += 1) {
      const config = { ...VARIED_OBSTACLE_DEFAULT_CONFIG, starSchedule: null, pipes: { ...VARIED_OBSTACLE_DEFAULT_CONFIG.pipes, horizon: 10_000_000 } };
      const initial = createRun(createRunDescriptor({ runId: `prepared-lane-seed-${seed}`, seed }, config), config);
      const edge = generateNext({ ...initial, pipes: [], nextPipeIndex: 0, nextPipeX: config.pipes.safeLeadIn }).state.pipes.find(pipe => pipe.index === 3)!;
      seeds.set(edge.gapCenter, seed);
    }
    expect(seeds.size).toBe(2);
    for (const [edgeCenter, seed] of seeds) {
      const result = runPlannedWitness(seed, 280_000, 0, 4, VARIED_OBSTACLE_DEFAULT_CONFIG);
      const edge = result.observations.find(item => item.stationId === "station-3")!;
      expect(edge.x).toBeLessThanOrEqual(360_000);
      expect(edge.readyAt - edge.observedAt).toBe(18);
      const activation = result.planning.find(item => item.mature.includes("station-3"))!;
      expect(activation.tick).toBe(edge.readyAt);
      const depth88 = Math.floor((VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.floorY - VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.ceilingY) * 88 / 100);
      const expected = edgeCenter === VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.gapMaxCenter
        ? [VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.ceilingY + depth88 + VARIED_OBSTACLE_DEFAULT_CONFIG.flight.duckHalfHeight + 1, VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.floorY - VARIED_OBSTACLE_DEFAULT_CONFIG.flight.duckHalfHeight - 1]
        : [VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.ceilingY + VARIED_OBSTACLE_DEFAULT_CONFIG.flight.duckHalfHeight + 1, VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.floorY - depth88 - VARIED_OBSTACLE_DEFAULT_CONFIG.flight.duckHalfHeight - 1];
      expect(activation.planner.preparedBand).toBe(expected.join(".."));
      expect(result.inputs.filter(input => input.tick >= edge.observedAt && input.tick < edge.readyAt)).toHaveLength(18);
    }
  }, 30_000);

  it("arms only a viable hold-kernel phase and sustains the exact 34-tick orbit", () => {
    const config = VARIED_OBSTACLE_DEFAULT_CONFIG;
    const band: [number, number] = [503_681, 550_999];
    const kernel = holdKernel(config.flight, band);
    expect(kernel.cycleTicks).toBe(34);
    expect(kernel.minimumDisplacement).toBe(-46_240);
    expect(kernel.phaseAt(515_320, 8_160)).toBeUndefined();
    expect(kernel.launchBand).toEqual([549_921, 550_999]);
    let state = createRun(createRunDescriptor({ runId: "hold-kernel-orbit", seed: 0 }, config), config);
    state = { ...state, phase: "RUNNING", tick: config.pipes.rampTicks, duck: { ...state.duck, y: kernel.launchBand[0], vy: 0 }, pipes: [], nextPipeX: config.pipes.horizon + 1 };
    const centerPath: number[] = [];
    for (let tick = 0; tick < 68; tick += 1) {
      const result = step(state, tick % kernel.cycleTicks === 0 ? [makeInput(state.nextInputSequence, "FLAP")] : []);
      expect(result.state.phase, `cycleTick=${tick}`).toBe("RUNNING");
      centerPath.push(result.state.duck.y);
      state = result.state;
    }
    expect(centerPath.every(y => y >= band[0] && y <= band[1])).toBe(true);
    expect(state.duck.y).toBe(kernel.launchBand[0]);
    expect(state.duck.vy).toBe(5_280);
  });

  it("targets realized pipe middles for connectors and hold launch bands only for edge pipes", () => {
    const config = VARIED_OBSTACLE_DEFAULT_CONFIG;
    const initial = createRun(createRunDescriptor({ runId: "pipe-target-contract", seed: 0 }, config), config);
    const state = { ...initial, phase: "RUNNING" as const, tick: config.pipes.rampTicks };
    const planFor = (center: number) => {
      const half = Math.floor(config.pipes.gapHeight / 2);
      const obstacles: MatureGeometry["obstacles"] = [
        { typeId: "pipes", xOffset: 0, y: config.pipes.ceilingY, width: config.pipes.width, height: center - half - config.pipes.ceilingY },
        { typeId: "pipes", xOffset: 0, y: center + half, width: config.pipes.width, height: config.pipes.floorY - center - half },
      ];
      const geometry: MatureGeometry = { stationId: "station-20", observedAt: state.tick, x: 900_000, obstacles };
      const status = { reason: "", horizon: 0, stationId: "", bandLow: 0, bandHigh: 0, targetY: 0, preparedBand: "none" };
      planMatureGeometry(state, [geometry], status, 32, 8);
      return status;
    };
    expect(planFor(179_250).targetY).toBe(179_250);
    const edge = planFor(config.pipes.gapMaxCenter);
    const corridorLow = config.pipes.ceilingY + Math.floor((config.pipes.floorY - config.pipes.ceilingY) * 88 / 100) + config.flight.duckHalfHeight + 1;
    const launchLow = corridorLow + holdKernel(config.flight, [corridorLow, config.pipes.floorY - config.flight.duckHalfHeight - 1]).minimumDisplacement * -1;
    expect(edge.preparedBand).not.toBe("none");
    expect(edge.targetY).toBeGreaterThanOrEqual(launchLow);
  });

  it("carries only matured paired-opening direction through the post-clear reference", () => {
    const config = VARIED_OBSTACLE_DEFAULT_CONFIG;
    const state = createRun(createRunDescriptor({ runId: "visible-pipe-flow", seed: 0 }, config), config);
    const geometry = (index: number, center: number): MatureGeometry => {
      const half = Math.floor(config.pipes.gapHeight / 2);
      return { stationId: `station-${index}`, observedAt: 0, x: 500_000,
        obstacles: [
          { typeId: "pipes", xOffset: 0, y: config.pipes.ceilingY, width: config.pipes.width, height: center - half - config.pipes.ceilingY },
          { typeId: "pipes", xOffset: 0, y: center + half, width: config.pipes.width, height: config.pipes.floorY - center - half },
        ] };
    };
    const up = visiblePipeFlow(state, [geometry(0, 483_000), geometry(1, 430_000)])!;
    expect(up.direction).toBe(-1);
    expect(pipeFlowReference(up, up.center, 0, 12_001, 548_999)).toBe(430_000);
    expect(pipeFlowReference(up, up.center, 20, 12_001, 548_999)).toBe(398_000);
    const down = visiblePipeFlow(state, [geometry(0, 78_000), geometry(1, 100_000)])!;
    expect(down.direction).toBe(1);
    expect(pipeFlowReference(down, down.center, 0, 12_001, 548_999)).toBe(100_000);
    expect(pipeFlowReference(down, down.center, 20, 12_001, 548_999)).toBe(132_000);
    expect(pipeFlowReference(down, down.center, 400, 12_001, 548_999)).toBe(548_999);
  });

  it("can traverse the intro lane connector into seeded extreme half-pipes at maximum speed after visible 18-tick delay", () => {
    for (const seed of [0, 2]) {
      const result = runRewardWitness(seed, 280_000, 0, 8, undefined, VARIED_OBSTACLE_DEFAULT_CONFIG, false);
      expect(result.state.tick).toBeGreaterThan(VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.rampTicks);
      expect(result.state.phase, `seed=${seed} score=${result.state.score} y=${result.state.duck.y}/${result.state.duck.vy} targets=${JSON.stringify(result.targetChanges.slice(-12))} hazards=${JSON.stringify(result.state.pipes.map(pipe => [pipe.stationId, pipe.x, pipe.encounterFamily, pipe.obstacles]))}`).toBe("RUNNING");
      expect(result.state.score, `seed=${seed}`).toBeGreaterThanOrEqual(8);
    }
  }, 30_000);

  it("connects the intro through the first seeded half-pipe polarity reversal", () => {
    const rules = VARIED_OBSTACLE_DEFAULT_CONFIG;
    const result = runPlannedWitness(0, 280_000, 0, 20, rules);
    expect(result.state.tick).toBeGreaterThan(rules.pipes.rampTicks);
    expect(result.state.phase, `score=${result.state.score} y=${result.state.duck.y}/${result.state.duck.vy} passed=${result.passed.slice(-5).map(item => `${item.type}:${item.spanPercent}@${item.x}`).join(",")} plans=${result.planning.slice(-5).map(item => `${item.planner.stationId}:${item.planner.reason}@${item.tick}`).join(",")}`).toBe("RUNNING");
    expect(result.state.score).toBeGreaterThanOrEqual(20);
    expect(new Set(result.passed.filter(item => item.type === "vine" || item.type === "rock").map(item => item.type)))
      .toEqual(new Set(["vine", "rock"]));
  }, 30_000);

  it("gates the seed-two cap entry through its first pressure recovery", () => {
    const result = runPlannedWitness(2, 275_000, -500, 17, VARIED_OBSTACLE_DEFAULT_CONFIG);
    const recoveryExit = result.passed.find(item => item.stationId === "station-16");
    expect({ profile: result.profile, seed: result.initialState.descriptor.seed, phase: result.initialState.phase,
      tick: result.initialState.tick, y: result.initialState.duck.y, vy: result.initialState.duck.vy,
      horizon: result.initialState.config.pipes.horizon,
      maxActivePipes: result.initialState.config.limits.maxActivePipes,
      maxActiveCollectibles: result.initialState.config.limits.maxActiveCollectibles,
      starSchedule: result.initialState.config.starSchedule ?? null })
      .toEqual({ profile: "custom-cap", seed: 2, phase: "RUNNING", tick: VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.rampTicks,
        y: 275_000, vy: -500, horizon: 1_700_000,
        maxActivePipes: 24, maxActiveCollectibles: 25, starSchedule: null });
    expect(result.initialState.descriptor.configId).toMatch(/^dd-v1-config:/);
    expect(result.state.phase, `seed=2 initial=${result.initialState.phase}/${result.initialState.tick}/${result.initialState.duck.y}/${result.initialState.duck.vy} final=${result.state.phase}/${result.state.tick}/${result.state.score}/${result.state.duck.y}/${result.state.duck.vy} passed=${JSON.stringify(result.passed.slice(-6))} plans=${JSON.stringify(result.planning.slice(-5))}`)
      .toBe("RUNNING");
    expect(result.state.score).toBeGreaterThanOrEqual(17);
    const station16Observation = result.observations.find(item => item.stationId === "station-16");
    expect(station16Observation).toBeDefined();
    expect(station16Observation!.readyAt - station16Observation!.observedAt).toBe(18);
    expect(recoveryExit).toBeDefined();
  }, 30_000);

  it("witnesses one paired catalog seed with the existing public gap-following policy", () => {
    const result = runPairedGapPolicyWitness(0, 280_000, 0);
    expect({ catalogVersion: result.initialState.config.wetland?.catalogVersion,
      phase: result.initialState.phase, tick: result.initialState.tick,
      y: result.initialState.duck.y, vy: result.initialState.duck.vy,
      horizon: result.initialState.config.pipes.horizon,
      maxActivePipes: result.initialState.config.limits.maxActivePipes,
      maxActiveCollectibles: result.initialState.config.limits.maxActiveCollectibles,
      starSchedule: result.initialState.config.starSchedule ?? null })
      .toEqual({ catalogVersion: 3, phase: "RUNNING", tick: DEFAULT_CONFIG.pipes.rampTicks,
        y: 280_000, vy: 0, horizon: 1_700_000, maxActivePipes: 24,
        maxActiveCollectibles: 25, starSchedule: null });
    expect(result.state.phase, JSON.stringify({ score: result.state.score, tick: result.state.tick,
      duck: result.state.duck, activations: result.activations, passed: result.passed,
      lastInputs: result.inputs.slice(-40) })).toBe("RUNNING");
    expect(result.state.score).toBeGreaterThanOrEqual(33);
    expect(result.passed.some(item => item.stationId === "station-32")).toBe(true);
    expect(result.observations.every(item => item.x <= 360_000 && item.readyAt - item.observedAt === 18)).toBe(true);
    expect(result.activations.some(item => item.stationId === "station-32")).toBe(true);
    expect(result.activations.every(item => item.tick === result.observations.find(observation => observation.stationId === item.stationId)!.readyAt)).toBe(true);
    expect(result.displacements.length).toBeGreaterThan(0);
    expect(result.displacements.every(item => item.actual === item.expected)).toBe(true);
    if (process.env.REPORT_PAIRED_WITNESS === "1") {
      console.info(JSON.stringify({ initial: { seed: result.initialState.descriptor.seed,
        configId: result.initialState.descriptor.configId, tick: result.initialState.tick,
        y: result.initialState.duck.y, vy: result.initialState.duck.vy },
      activations: result.activations, passed: result.passed,
      collected: result.collected,
      speedTicks: result.displacements.length, allDisplacementsMatch: result.displacements.every(item => item.actual === item.expected),
      score: result.state.score, finalTick: result.state.tick, finalDuck: result.state.duck }));
    }
  }, 60_000);

  it("witnesses the two remaining declared paired cap entries with the same public gap policy", () => {
    const cells = [
      { seed: 2, entryY: 275_000, entryVy: -500 },
      { seed: 9, entryY: 285_000, entryVy: 500 },
    ] as const;
    const failures: string[] = [];
    for (const cell of cells) {
      try {
        const result = runPairedGapPolicyWitness(cell.seed, cell.entryY, cell.entryVy);
        expect(result.initialState.config.wetland?.catalogVersion).toBe(3);
        expect({ catalogVersion: result.initialState.config.wetland?.catalogVersion,
          phase: result.initialState.phase, tick: result.initialState.tick,
          y: result.initialState.duck.y, vy: result.initialState.duck.vy,
          horizon: result.initialState.config.pipes.horizon,
          maxActivePipes: result.initialState.config.limits.maxActivePipes,
          maxActiveCollectibles: result.initialState.config.limits.maxActiveCollectibles,
          starSchedule: result.initialState.config.starSchedule ?? null })
          .toEqual({ catalogVersion: 3, phase: "RUNNING", tick: DEFAULT_CONFIG.pipes.rampTicks,
            y: cell.entryY, vy: cell.entryVy, horizon: 1_700_000,
            maxActivePipes: 24, maxActiveCollectibles: 25, starSchedule: null });
        expect(result.state.phase, `seed=${cell.seed} y=${cell.entryY} vy=${cell.entryVy} score=${result.state.score} tick=${result.state.tick} duck=${result.state.duck.y}/${result.state.duck.vy} activations=${JSON.stringify(result.activations)} passes=${JSON.stringify(result.passed)} inputs=${JSON.stringify(result.inputs.slice(-40))}`)
          .toBe("RUNNING");
        expect(result.state.score).toBeGreaterThanOrEqual(33);
        expect(result.passed.some(item => item.stationId === "station-32")).toBe(true);
        expect(result.observations.every(item => item.x <= 360_000 && item.readyAt - item.observedAt === 18)).toBe(true);
        expect(result.activations.some(item => item.stationId === "station-32")).toBe(true);
        expect(result.activations.every(item => item.tick === result.observations.find(observation => observation.stationId === item.stationId)!.readyAt)).toBe(true);
        expect(result.displacements.length).toBeGreaterThan(0);
        expect(result.displacements.every(item => item.actual === item.expected)).toBe(true);
        if (process.env.REPORT_PAIRED_WITNESS === "1") console.info(JSON.stringify({ seed: cell.seed,
          initialY: cell.entryY, initialVy: cell.entryVy, activations: result.activations, passed: result.passed,
          collected: result.collected, movementTicks: result.displacements.length,
          allDisplacementsMatch: result.displacements.every(item => item.actual === item.expected),
          score: result.state.score, finalTick: result.state.tick, finalDuck: result.state.duck }));
      } catch (error) {
        failures.push(`seed=${cell.seed} y=${cell.entryY} vy=${cell.entryVy}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(failures, `failed declared paired cap entries:\n${failures.join("\n")}`).toEqual([]);
  }, 120_000);

  it("covers all ten completed-family edges across the three fixed paired cap entries", () => {
    const cells = [
      { seed: 0, entryY: 280_000, entryVy: 0 },
      { seed: 2, entryY: 275_000, entryVy: -500 },
      { seed: 9, entryY: 285_000, entryVy: 500 },
    ] as const;
    const expectedEdges = new Set([
      "steady->quick-pairs",
      "quick-pairs->dive-climb", "quick-pairs->climb-dive", "quick-pairs->slalom",
      "dive-climb->steady", "climb-dive->steady", "slalom->steady",
      "steady->dive-climb", "steady->climb-dive", "steady->slalom",
    ]);
    const observedEdges = new Set<string>();

    for (const cell of cells) {
      const result = runPairedGapPolicyWitness(cell.seed, cell.entryY, cell.entryVy);
      expect(result.state.phase, `seed=${cell.seed}`).toBe("RUNNING");
      expect(result.state.score, `seed=${cell.seed}`).toBeGreaterThanOrEqual(33);
      expect(result.passed.some(item => item.stationId === "station-32"), `seed=${cell.seed}`).toBe(true);
      expect(result.observations.every(item => item.x <= 360_000 && item.readyAt - item.observedAt === 18), `seed=${cell.seed}`).toBe(true);

      const completed = result.passed.filter(item => (Number(item.stationId.slice("station-".length)) + 1) % 4 === 0);
      for (const pass of completed) {
        const observation = result.observations.find(item => item.stationId === pass.stationId);
        expect(observation, `seed=${cell.seed} station=${pass.stationId} observation`).toBeDefined();
        expect(pass.tick, `seed=${cell.seed} station=${pass.stationId} matured pass`).toBeGreaterThanOrEqual(observation!.readyAt);
        expect(pass.family, `seed=${cell.seed} station=${pass.stationId} family`).toBeDefined();
      }
      for (let index = 1; index < completed.length; index += 1) {
        const previous = completed[index - 1]!;
        const current = completed[index]!;
        expect(previous.family, `seed=${cell.seed} station=${previous.stationId} family`).toBeDefined();
        expect(current.family, `seed=${cell.seed} station=${current.stationId} family`).toBeDefined();
        observedEdges.add(`${previous.family}->${current.family}`);
      }
    }

    expect(observedEdges).toEqual(expectedEdges);
  }, 120_000);

  it("survives from a genuine paired READY default run through station 16 with the same pipe policy", () => {
    const result = runPairedGapPolicyWitness(9, 280_000, 0, true, 17);
    expect(result.initialState.descriptor.configId).toBe(DEFAULT_CONFIG_ID);
    expect({ phase: result.initialState.phase, tick: result.initialState.tick, catalogVersion: result.initialState.config.wetland?.catalogVersion,
      y: result.initialState.duck.y, vy: result.initialState.duck.vy })
      .toEqual({ phase: "READY", tick: 0, catalogVersion: 4,
        y: Math.floor((DEFAULT_CONFIG.pipes.ceilingY + DEFAULT_CONFIG.pipes.floorY) / 2), vy: 0 });
    expect(result.inputs[0]).toEqual({ tick: 0, flap: true });
    expect(result.state.phase, JSON.stringify({ score: result.state.score, tick: result.state.tick,
      duck: result.state.duck, activations: result.activations, passed: result.passed,
      lastInputs: result.inputs.slice(-40) })).toBe("RUNNING");
    expect(result.state.score).toBeGreaterThanOrEqual(17);
    expect(result.passed.some(item => item.stationId === "station-16")).toBe(true);
    expect(result.observations.every(item => item.x <= 360_000 && item.readyAt - item.observedAt === 18)).toBe(true);
    expect(result.activations.some(item => item.stationId === "station-16")).toBe(true);
    expect(result.displacements.every(item => item.actual === item.expected)).toBe(true);
    if (process.env.REPORT_PAIRED_WITNESS === "1") console.info(JSON.stringify({ profile: "normal-default", seed: 9,
      configId: result.initialState.descriptor.configId, firstInput: result.inputs[0], activations: result.activations,
      passed: result.passed, collected: result.collected, movementTicks: result.displacements.length,
      score: result.state.score, finalTick: result.state.tick, finalDuck: result.state.duck }));
  }, 60_000);

  if (process.env.RUN_MIXED_OBSTACLE_EXPERIMENTS === "1") it("retains the three declared cap rows under the mixed geometry planner", () => {
    const cells = [
      { seed: 0, entryY: 280_000, entryVy: 0 },
      { seed: 2, entryY: 275_000, entryVy: -500 },
      { seed: 9, entryY: 285_000, entryVy: 500 },
    ] as const;
    expect(cells).toHaveLength(3);
    const edges = new Set<string>();
    const failures: string[] = [];
    for (const cell of cells) {
      const label = `seed=${cell.seed} y=${cell.entryY} vy=${cell.entryVy}`;
      try {
      const result = runPlannedWitness(cell.seed, cell.entryY, cell.entryVy, 33, VARIED_OBSTACLE_DEFAULT_CONFIG);
      expect(result.initialState.descriptor.configId, label).toMatch(/^dd-v1-config:/);
      expect({ catalogVersion: result.initialState.config.wetland?.catalogVersion,
        phase: result.initialState.phase, tick: result.initialState.tick,
        y: result.initialState.duck.y, vy: result.initialState.duck.vy,
        horizon: result.initialState.config.pipes.horizon,
        maxActivePipes: result.initialState.config.limits.maxActivePipes,
        maxActiveCollectibles: result.initialState.config.limits.maxActiveCollectibles,
        starSchedule: result.initialState.config.starSchedule ?? null })
        .toEqual({ catalogVersion: 2, phase: "RUNNING", tick: VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.rampTicks,
          y: cell.entryY, vy: cell.entryVy, horizon: 1_700_000,
          maxActivePipes: 24, maxActiveCollectibles: 25, starSchedule: null });
      expect(worldSpeedAt(result.initialState.config, result.initialState.tick + 1, result.initialState.score))
        .toBe(result.initialState.config.pipes.maxSpeed);
      expect(result.state.phase, `${label} final=${result.state.tick}/${result.state.score}/${result.state.duck.y}/${result.state.duck.vy} plans=${JSON.stringify(result.planning.slice(-3))}`)
        .toBe("RUNNING");
      expect(result.state.score, label).toBeGreaterThanOrEqual(33);
      expect(result.passed.some(item => item.stationId === "station-32"), label).toBe(true);
      const allowedTypes = new Set(["pipes", "vine", "rock", "debris"]);
      expect(result.passed.every(item => allowedTypes.has(item.type)), `${label} passed=${JSON.stringify(result.passed.slice(-4))}`).toBe(true);
      expect(result.passed.some(item => item.type !== "pipes"), `${label} should exercise varied obstacles`).toBe(true);
      expect(result.displacements.length, label).toBeGreaterThan(0);
      expect(result.displacements.every(item => item.actual === item.expected), `${label} displacement=${JSON.stringify(result.displacements.slice(0, 3))}`).toBe(true);
      for (const observation of result.observations) {
        expect(observation.x, `${label} ${observation.stationId} visible center`).toBeLessThanOrEqual(360_000);
        expect(observation.readyAt - observation.observedAt, `${label} ${observation.stationId} reaction`).toBe(18);
        const activation = result.planning.find(item => item.mature.includes(observation.stationId));
        expect(activation, `${label} ${observation.stationId} planner activation`).toBeDefined();
        expect(activation!.tick, `${label} ${observation.stationId} activation`).toBe(observation.readyAt);
        expect(activation!.planned, `${label} ${observation.stationId} plan`).not.toBeNull();
      }
      const completedBlocks = result.passed.filter(item => Number(item.stationId.slice("station-".length)) % 4 === 3);
      for (let index = 1; index < completedBlocks.length; index += 1) {
        const previous = completedBlocks[index - 1]!.family;
        const current = completedBlocks[index]!.family;
        if (previous && current) edges.add(`${previous}->${current}`);
      }
      } catch (error) {
        failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(failures, `failed declared paired cells:\n${failures.join("\n")}`).toEqual([]);
    expect([...edges].sort()).toEqual([
      "climb-dive->steady", "dive-climb->steady", "quick-pairs->climb-dive",
      "quick-pairs->dive-climb", "quick-pairs->slalom", "slalom->steady",
      "steady->climb-dive", "steady->dive-climb", "steady->quick-pairs", "steady->slalom",
    ]);
  }, 120_000);

  it("discriminates normal seed-nine survival when reward pursuit is disabled", () => {
    const config = DEFAULT_CONFIG;
    const expectedInitial = createRun(createRunDescriptor({ runId: "wetland-reward-witness-9-17", seed: 9 }, config), config);
    const result = runRewardWitness(9, 280_000, 0, 17, undefined, config, false, undefined, "normal-default");
    const stationObservation = result.observedStations.get("station-16");
    const stationTarget = result.targetChanges.find(item => item.target === "station-16");
    const station11Target = result.targetChanges.find(item => item.target === "station-11");
    expect({ profile: result.profile, pursueRewards: result.args.pursueRewards, phase: result.initialState.phase,
      tick: result.initialState.tick, y: result.initialState.duck.y, vy: result.initialState.duck.vy,
      identity: result.args.configIdentity, horizon: result.initialState.config.pipes.horizon,
      capacity: result.initialState.config.limits.maxActiveCollectibles, stars: result.initialState.config.starSchedule })
      .toEqual({ profile: "normal-default", pursueRewards: false, phase: "READY", tick: 0, y: expectedInitial.duck.y, vy: 0,
        identity: DEFAULT_CONFIG_ID, horizon: config.pipes.horizon, capacity: config.limits.maxActiveCollectibles,
        stars: config.starSchedule });
    expect(result.inputs[0]).toEqual({ tick: 0, flap: true });
    expect(result.state.phase, `args=${JSON.stringify(result.args)} initial=READY/0/${result.initialState.duck.y}/0 final=${result.state.phase}/${result.state.tick}/${result.state.score}/${result.state.duck.y}/${result.state.duck.vy} passed=${JSON.stringify(result.passedTypes.slice(-8))} terminal=${JSON.stringify(result.terminal)} targets=${JSON.stringify(result.targetChanges.slice(-10))}`)
      .toBe("RUNNING");
    expect(result.state.score).toBeGreaterThanOrEqual(17);
    expect(result.passedTypes.some(item => item.stationId === "station-16")).toBe(true);
    expect(stationObservation).toBeDefined();
    expect(stationObservation!.readyAt - stationObservation!.observedAt).toBe(18);
    expect(stationObservation!.x).toBeLessThanOrEqual(360_000);
    expect(stationTarget).toBeDefined();
    expect(stationTarget!.tick).toBe(stationTarget!.readyAt);
    expect(station11Target).toMatchObject({ y: 280_000, readyAt: 1_020, tick: 1_020 });
    expect(result.displacements.length).toBeGreaterThan(0);
    expect(result.displacements.find(item => item.tick === 0)).toMatchObject({
      stationId: "station-0", actual: worldSpeedAt(config, 1, 0), expected: worldSpeedAt(config, 1, 0),
    });
    expect(result.displacements.every(item => item.actual === item.expected), JSON.stringify(result.displacements.slice(0, 5))).toBe(true);
  }, 30_000);

  it("collects the paired catalog intro trail and clears its following station", () => {
    const introRewards = ["feather-trail-0-1", "feather-trail-0-3"];
    const result = runRewardWitness(0, 280_000, 0, 5, undefined, PAIRED_ROUTES_DEFAULT_CONFIG, true, undefined, "custom-cap", introRewards);
    expect(result.state.phase, JSON.stringify({ args: result.args,
      initial: { phase: result.initialState.phase, tick: result.initialState.tick, y: result.initialState.duck.y,
        vy: result.initialState.duck.vy, nextStarPipeIndex: result.initialState.nextStarPipeIndex,
        starScheduleOrdinal: result.initialState.starScheduleOrdinal, starSchedule: result.initialState.config.starSchedule },
      terminal: result.terminal, collected: [...result.collected], collectionEvents: [...result.collectionEvents],
      passed: result.passedTypes, rollouts: result.rewardRollouts,
      stations: [...result.observedStations.entries()].map(([id, item]) => ({ id, ...item })),
      rewards: [...result.observedRewards.values()], inputs: result.inputs })).toBe("RUNNING");
    expect(result.state.score).toBeGreaterThanOrEqual(5);
    expect([...result.collected].filter(id => id.startsWith("feather-trail-0-")).sort())
      .toEqual(["feather-trail-0-1", "feather-trail-0-3"]);
    expect(result.collectionEvents.get("feather-trail-0-1")).toEqual({ count: 1, amount: 1 });
    expect(result.collectionEvents.get("feather-trail-0-3")).toEqual({ count: 1, amount: 1 });
    expect(result.passedTypes.some(item => item.stationId === "station-4")).toBe(true);
    for (const id of ["feather-trail-0-1", "feather-trail-0-3"]) {
      const reward = result.observedRewards.get(id)!;
      const owner = result.observedStations.get(`station-${id.split("-").at(-1)}`)!;
      expect(reward.readyAt - reward.observedAt).toBe(18);
      expect(owner.readyAt - owner.observedAt).toBe(18);
      expect(result.collectedAt.get(id)).toBeGreaterThanOrEqual(Math.max(reward.readyAt, owner.readyAt));
    }
    expect(result.rewardRollouts.map(item => item.rewardId)).toEqual(expect.arrayContaining(["feather-trail-0-1", "feather-trail-0-3"]));
  }, 30_000);

  it("collects the paired catalog complete quick-pairs trail and clears its following station", () => {
    const required = [0, 1, 2, 3].map(stepIndex => `feather-trail-1-${stepIndex}`);
    const result = runRewardWitness(0, 280_000, 0, 9, undefined, PAIRED_ROUTES_DEFAULT_CONFIG, true, undefined, "custom-cap", required);
    expect(result.state.phase, JSON.stringify({ args: result.args, terminal: result.terminal,
      collected: [...result.collected], passed: result.passedTypes, inputs: result.inputs.slice(-40) })).toBe("RUNNING");
    expect(result.state.score).toBeGreaterThanOrEqual(9);
    expect(required.every(id => result.collected.has(id))).toBe(true);
    for (const id of required) expect(result.collectionEvents.get(id)).toEqual({ count: 1, amount: 1 });
    expect([...result.collected].filter(id => id.startsWith("feather-trail-1-")).sort()).toEqual(required);
    for (const id of required) {
      const reward = result.observedRewards.get(id)!;
      const ownerIndex = Number(id.split("-")[2]) * 4 + Number(id.split("-").at(-1));
      const owner = result.observedStations.get(`station-${ownerIndex}`)!;
      expect(reward.readyAt - reward.observedAt).toBe(18);
      expect(owner.readyAt - owner.observedAt).toBe(18);
      expect(result.collectedAt.get(id)).toBeGreaterThanOrEqual(Math.max(reward.readyAt, owner.readyAt));
    }
    expect(result.passedTypes.some(item => item.stationId === "station-8")).toBe(true);
  }, 30_000);

  it("collects the paired catalog pressure trail and clears its following station", () => {
    const required = [0, 1, 2, 3].map(stepIndex => `feather-trail-2-${stepIndex}`);
    const result = runRewardWitness(0, 280_000, 0, 13, undefined, PAIRED_ROUTES_DEFAULT_CONFIG, true, undefined, "custom-cap", required);
    expect(result.state.phase, JSON.stringify({ args: result.args, terminal: result.terminal,
      collected: [...result.collected], passed: result.passedTypes, inputs: result.inputs.slice(-40) })).toBe("RUNNING");
    expect(result.state.score).toBeGreaterThanOrEqual(13);
    expect(required.every(id => result.collected.has(id))).toBe(true);
    for (const id of required) expect(result.collectionEvents.get(id)).toEqual({ count: 1, amount: 1 });
    expect([...result.collected].filter(id => id.startsWith("feather-trail-2-")).sort()).toEqual(required);
    for (const id of required) {
      const reward = result.observedRewards.get(id)!;
      const ownerIndex = 8 + Number(id.split("-").at(-1));
      const owner = result.observedStations.get(`station-${ownerIndex}`)!;
      expect(reward.readyAt - reward.observedAt).toBe(18);
      expect(owner.readyAt - owner.observedAt).toBe(18);
      expect(result.collectedAt.get(id)).toBeGreaterThanOrEqual(Math.max(reward.readyAt, owner.readyAt));
    }
    expect(result.passedTypes.some(item => item.stationId === "station-12")).toBe(true);
  }, 30_000);

  it("does not automatically collect the complete paired pressure trail when rewards are ignored", () => {
    const result = runRewardWitness(0, 280_000, 0, 13, undefined, PAIRED_ROUTES_DEFAULT_CONFIG, false);
    const pressureTrail = [0, 1, 2, 3].map(stepIndex => `feather-trail-2-${stepIndex}`);
    expect(result.state.phase).toBe("RUNNING");
    expect(result.state.score).toBeGreaterThanOrEqual(13);
    expect(result.passedTypes.some(item => item.stationId === "station-12")).toBe(true);
    expect(pressureTrail.filter(id => result.collected.has(id)).length).toBeLessThan(4);
  }, 30_000);

  it("collects the paired catalog scheduled Star and clears the following station", () => {
    expect(PAIRED_ROUTES_DEFAULT_CONFIG.wetland!.starRoute).toEqual({ xOffset: 100_000, yOffset: 35_000 });
    const result = runRewardWitness(0, 280_000, 0, 10, 8, PAIRED_ROUTES_DEFAULT_CONFIG, true, undefined, "custom-cap", ["star-8"],
      { stationId: "station-8", fromTick: 3_231, throughTick: 3_251 });
    if (process.env.REPORT_STAR_WITNESS === "1") console.info(JSON.stringify({
      star: result.starWitness,
      ownerContinuationInputs: result.ownerContinuationInputs,
      rolloutAttempts: result.rewardRolloutDiagnostics.filter(item => item.rewardId === "star-8"),
      collected: [...result.collected],
      station9Exit: result.passedTypes.find(item => item.stationId === "station-9"),
      final: { tick: result.state.tick, score: result.state.score, phase: result.state.phase,
        y: result.state.duck.y, vy: result.state.duck.vy },
    }));
    expect(result.state.phase, JSON.stringify({ args: result.args, terminal: result.terminal,
      collected: [...result.collected], passed: result.passedTypes, inputs: result.inputs.slice(-40) })).toBe("RUNNING");
    expect(result.state.score).toBeGreaterThanOrEqual(10);
    expect(result.collected.has("star-8")).toBe(true);
    expect(result.collectionEvents.get("star-8")).toEqual({ count: 1, amount: 1 });
    const star = result.observedRewards.get("star-8")!;
    const owner = result.observedStations.get("station-8")!;
    expect(star.readyAt - star.observedAt).toBe(18);
    expect(owner.readyAt - owner.observedAt).toBe(18);
    expect(result.collectedAt.get("star-8")).toBeGreaterThanOrEqual(Math.max(star.readyAt, owner.readyAt));
    expect(result.passedTypes.some(item => item.stationId === "station-9")).toBe(true);

    const ignored = runRewardWitness(0, 280_000, 0, 10, 8, PAIRED_ROUTES_DEFAULT_CONFIG, false, undefined, "custom-cap", ["star-8"],
      { stationId: "station-8", fromTick: 3_231, throughTick: 3_251 });
    expect(ignored.state.phase).toBe("RUNNING");
    expect(ignored.state.score).toBeGreaterThanOrEqual(10);
    expect(ignored.collected.has("star-8")).toBe(false);
    expect(ignored.passedTypes.some(item => item.stationId === "station-9")).toBe(true);
  }, 30_000);

  it("survives the reverse half-pipe polarity transition at maximum speed", () => {
    const result = runPlannedWitness(0, 280_000, 0, 28, VARIED_OBSTACLE_DEFAULT_CONFIG);
    expect(result.state.phase, `score=${result.state.score} y=${result.state.duck.y}/${result.state.duck.vy} plans=${result.planning.slice(-4).map(item => `${item.planner.stationId}:${item.planner.reason}@${item.tick}`).join(",")}`).toBe("RUNNING");
    expect(result.state.score).toBeGreaterThanOrEqual(28);
    const types = new Set(result.passed.filter(item => item.type === "vine" || item.type === "rock").map(item => item.type));
    expect(types).toEqual(new Set(["vine", "rock"]));
  }, 30_000);

  it("survives a composed maximum-speed trace through both half-pipe polarities", () => {
    const result = runPlannedWitness(0, 280_000, 0, 60, VARIED_OBSTACLE_DEFAULT_CONFIG);
    expect(result.state.phase, `score=${result.state.score} y=${result.state.duck.y}/${result.state.duck.vy} plans=${result.planning.slice(-5).map(item => `${item.planner.stationId}:${item.planner.reason}@${item.tick}`).join(",")}`).toBe("RUNNING");
    expect(result.state.score).toBeGreaterThanOrEqual(60);
    expect(new Set(result.passed.filter(item => item.type === "vine" || item.type === "rock").map(item => item.type)))
      .toEqual(new Set(["vine", "rock"]));
    expect(result.passed.filter(item => item.type === "vine").every(item => item.spanPercent <= 88)).toBe(true);
    const introEdge = result.observations.find(item => item.stationId === "station-3")!;
    expect(introEdge.x).toBeLessThanOrEqual(360_000);
    expect(introEdge.readyAt - introEdge.observedAt).toBe(18);
    const edgePlan = result.planning.find(item => item.mature.includes("station-3"))!;
    expect(edgePlan.tick).toBe(introEdge.readyAt);
    const witnessRules = createRun(createRunDescriptor({ runId: "edge-policy-shape", seed: 0 }, VARIED_OBSTACLE_DEFAULT_CONFIG), VARIED_OBSTACLE_DEFAULT_CONFIG);
    const edgeOpening = pairedPipeOpening(witnessRules, introEdge.obstacles)!;
    const expectedPrepared = edgeOpening.bottom === VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.floorY
      ? `${Math.floor((VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.floorY - VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.ceilingY) * 88 / 100) + VARIED_OBSTACLE_DEFAULT_CONFIG.flight.duckHalfHeight + 1}..${VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.floorY - VARIED_OBSTACLE_DEFAULT_CONFIG.flight.duckHalfHeight - 1}`
      : `${VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.ceilingY + VARIED_OBSTACLE_DEFAULT_CONFIG.flight.duckHalfHeight + 1}..${VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.floorY - Math.floor((VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.floorY - VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.ceilingY) * 88 / 100) - VARIED_OBSTACLE_DEFAULT_CONFIG.flight.duckHalfHeight - 1}`;
    expect(edgePlan.planner.preparedBand).toBe(expectedPrepared);
    expect(result.inputs.filter(input => input.tick >= introEdge.observedAt && input.tick < introEdge.readyAt)).toHaveLength(18);
  }, 60_000);

  it("crosses a deterministic 90 percent floor half with a following station exit", () => {
    const result = runPlannedWitness(3, 280_000, 0, 21, VARIED_OBSTACLE_DEFAULT_CONFIG);
    const rock = result.passed.find(item => item.stationId === "station-19");
    expect(result.state.phase, `score=${result.state.score} y=${result.state.duck.y}/${result.state.duck.vy}`).toBe("RUNNING");
    expect(rock).toMatchObject({ type: "rock", spanPercent: 90 });
    expect(result.passed.some(item => item.stationId === "station-20")).toBe(true);
    expect(result.entries.has("station-20")).toBe(true);
  }, 30_000);

  it("crosses a deterministic 90 percent floor half and next station at base world speed", () => {
    const config = { ...VARIED_OBSTACLE_DEFAULT_CONFIG, pipes: { ...VARIED_OBSTACLE_DEFAULT_CONFIG.pipes, maxSpeed: VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.speed } };
    const initial = createRun(createRunDescriptor({ runId: "base-speed-90-rock", seed: 0 }, config), config);
    const top = config.pipes.floorY - Math.floor((config.pipes.floorY - config.pipes.ceilingY) * 90 / 100);
    const gapTop = 280_000 - Math.floor(config.pipes.gapHeight / 2);
    const gapBottom = 280_000 + Math.floor(config.pipes.gapHeight / 2);
    const stations = [
      { ...initial.pipes[0]!, index: 0, id: "pipe-0", stationId: "station-0", stationStep: 0, encounterFamily: "steady" as const,
        x: 360_000, gapCenter: 280_000, obstacles: [{ typeId: "rock" as const, xOffset: 0, y: top, width: config.pipes.width, height: config.pipes.floorY - top }] },
      { ...initial.pipes[0]!, index: 1, id: "pipe-1", stationId: "station-1", stationStep: 1, encounterFamily: "steady" as const,
        x: 720_000, gapCenter: 280_000, obstacles: [
          { typeId: "pipes" as const, xOffset: 0, y: config.pipes.ceilingY, width: config.pipes.width, height: gapTop },
          { typeId: "pipes" as const, xOffset: 0, y: gapBottom, width: config.pipes.width, height: config.pipes.floorY - gapBottom },
        ] },
    ];
    const result = runGeometryExitWitness(config, stations);
    const observed = result.observations.find(item => item.stationId === "station-0");
    expect(observed).toBeDefined();
    expect(observed!.readyAt - observed!.observedAt).toBe(18);
    expect(result.state.phase, `score=${result.state.score} y=${result.state.duck.y}/${result.state.duck.vy}`).toBe("RUNNING");
    expect(result.passed).toEqual(["station-0", "station-1"]);
  }, 30_000);

  it("gates a 216000-by-42000 floating bar into a paired-pipe exit at cap speed", () => {
    const config = VARIED_OBSTACLE_DEFAULT_CONFIG;
    const initial = createRun(createRunDescriptor({ runId: "m4a-wide-bar-exit", seed: 0 }, config), config);
    const gapTop = 280_000 - Math.floor(config.pipes.gapHeight / 2);
    const gapBottom = 280_000 + Math.floor(config.pipes.gapHeight / 2);
    const stations = [
      { ...initial.pipes[0]!, id: "m4a-bar", index: 0, stationId: "station-0", stationStep: 0, encounterFamily: "steady" as const,
        x: 360_000, gapCenter: 280_000, obstacles: [{ typeId: "debris" as const, xOffset: 0, y: 69_000, width: 216_000, height: 42_000 }] },
      { ...initial.pipes[0]!, id: "m4a-paired-pipe", index: 1, stationId: "station-1", stationStep: 1, encounterFamily: "steady" as const,
        x: 720_000, gapCenter: 280_000, obstacles: [
          { typeId: "pipes" as const, xOffset: 0, y: config.pipes.ceilingY, width: config.pipes.width, height: gapTop },
          { typeId: "pipes" as const, xOffset: 0, y: gapBottom, width: config.pipes.width, height: config.pipes.floorY - gapBottom },
        ] },
    ];
    const result = runGeometryExitWitness(config, stations);
    const bar = stations[0]!.obstacles[0]!;
    expect({ width: bar.width, height: bar.height, centerY: bar.y + Math.floor(bar.height / 2) })
      .toEqual({ width: 216_000, height: 42_000, centerY: 90_000 });
    const barObservation = result.observations.find(item => item.stationId === "station-0");
    const pipeObservation = result.observations.find(item => item.stationId === "station-1");
    expect(barObservation).toMatchObject({ observedAt: config.pipes.rampTicks, readyAt: config.pipes.rampTicks + 18 });
    expect(barObservation!.readyAt - barObservation!.observedAt).toBe(18);
    expect(pipeObservation).toBeDefined();
    expect(pipeObservation!.readyAt - pipeObservation!.observedAt).toBe(18);
    expect(result.activations).toContainEqual({ tick: barObservation!.readyAt, stations: ["station-0"] });
    expect(result.activations).toContainEqual({ tick: pipeObservation!.readyAt, stations: ["station-1"] });
    expect(result.state.phase, `seed=0 profile=custom-cap initial=RUNNING/${config.pipes.rampTicks}/280000/0 final=${result.state.phase}/${result.state.tick}/${result.state.score}/${result.state.duck.y}/${result.state.duck.vy} observed=${JSON.stringify(result.observations)} passed=${JSON.stringify(result.passed)}`)
      .toBe("RUNNING");
    expect(result.passed).toEqual(["station-0", "station-1"]);
    expect(result.displacements.length).toBeGreaterThan(0);
    expect(result.displacements.every(item => item.actual === item.expected), JSON.stringify(result.displacements.slice(0, 5))).toBe(true);
  }, 30_000);

  it("places varied-catalog coin and Star points inside realized free geometry", () => {
    const realizedTypes = new Set<string>();
    for (let seed = 0; seed < 8; seed += 1) {
      for (const firstIndex of [0, 4, 8, 12, 16]) {
        const config = { ...VARIED_OBSTACLE_DEFAULT_CONFIG, pipes: { ...VARIED_OBSTACLE_DEFAULT_CONFIG.pipes, horizon: 1_700_000 } };
        const initial = createRun(createRunDescriptor({ runId: `varied-reward-geometry-${seed}-${firstIndex}`, seed }, config), config);
        const result = generateNext({ ...initial, pipes: [], nextPipeIndex: firstIndex,
          nextPipeX: config.pipes.safeLeadIn, lastGapCenter: 280_000 });
        for (const station of result.state.pipes) {
          const type = station.obstacles?.[0]?.typeId;
          if (!type) continue;
          realizedTypes.add(type);
          const feather = config.collectibles.find(item => item.typeId === "FEATHER")!;
          const star = config.collectibles.find(item => item.typeId === "GAME_STAR")!;
          for (const [kind, point, radius] of [
            ["coin", wetlandRewardPoint(config, station, feather.radius), feather.radius],
            ["star", wetlandRewardPoint(config, station, star.radius, true), star.radius],
          ] as const) {
            expect(point.y - radius, `${kind} upper world bound ${station.stationId}`).toBeGreaterThan(config.pipes.ceilingY);
            expect(point.y + radius, `${kind} lower world bound ${station.stationId}`).toBeLessThan(config.pipes.floorY);
            for (const obstacle of station.obstacles ?? []) {
              const left = station.x + obstacle.xOffset - Math.floor(obstacle.width / 2);
              const right = station.x + obstacle.xOffset + Math.floor(obstacle.width / 2);
              const overlapsX = point.x + radius >= left && point.x - radius <= right;
              const overlapsY = point.y + radius >= obstacle.y && point.y - radius <= obstacle.y + obstacle.height;
              expect(overlapsX && overlapsY, `${kind} ${station.stationId} intersects ${obstacle.typeId} seed=${seed} first=${firstIndex}`).toBe(false);
            }
          }
        }
      }
    }
    expect(realizedTypes).toEqual(new Set(["pipes", "vine", "rock", "debris"]));
  });

  it("collects complete intro and quick-pairs coin trails before a safe exit", () => {
    const intro = runRewardWitness(0, 280_000, 0, 4, undefined, VARIED_OBSTACLE_DEFAULT_CONFIG, true);
    expect(intro.state.phase, `score=${intro.state.score} y=${intro.state.duck.y}/${intro.state.duck.vy} collected=${JSON.stringify([...intro.collected])} passed=${JSON.stringify(intro.passedTypes)} targets=${JSON.stringify(intro.targetChanges.slice(-8))}`).toBe("RUNNING");
    expect([...intro.collected].filter(id => id.startsWith("feather-trail-0-")).sort())
      .toEqual(["feather-trail-0-1", "feather-trail-0-3"]);
    const quick = runRewardWitness(0, 280_000, 0, 8, undefined, VARIED_OBSTACLE_DEFAULT_CONFIG, true);
    expect(quick.state.phase, `score=${quick.state.score} y=${quick.state.duck.y}/${quick.state.duck.vy} collected=${JSON.stringify([...quick.collected])} passed=${JSON.stringify(quick.passedTypes.slice(-6))} targets=${JSON.stringify(quick.targetChanges.slice(-8))}`).toBe("RUNNING");
    expect([...quick.collected].filter(id => id.startsWith("feather-trail-1-")).sort(), JSON.stringify(quick.targetChanges.slice(-8)))
      .toEqual(["feather-trail-1-0", "feather-trail-1-1", "feather-trail-1-2", "feather-trail-1-3"]);
  }, 30_000);

  it("collects a harder scheduled Star route for each obstacle type and clears the next station", () => {
    const starCases = new Map<string, { seed: number; index: number }>();
    const starResults = new Map<string, ReturnType<typeof runRewardWitness>>();
    for (let seed = 0; seed < 8 && starCases.size < 4; seed += 1) {
      const config = { ...VARIED_OBSTACLE_DEFAULT_CONFIG, pipes: { ...VARIED_OBSTACLE_DEFAULT_CONFIG.pipes, horizon: 1_700_000 } };
      const initial = createRun(createRunDescriptor({ runId: `star-route-search-${seed}`, seed }, config), config);
      for (let index = 8; index < 28 && starCases.size < 4; index += 1) {
        const station = generateNext({ ...initial, pipes: [], nextPipeIndex: index,
          nextPipeX: config.pipes.safeLeadIn, lastGapCenter: 280_000 }).state.pipes[0]!;
        const type = station.obstacles?.[0]?.typeId;
        if (!type || starCases.has(type)) continue;
        const entryOffset = (seed % 3 - 1) * 5_000;
        const entryVelocity = (seed % 3 - 1) * 500;
        const result = runRewardWitness(seed, 280_000 + entryOffset, entryVelocity, index + 2, index, VARIED_OBSTACLE_DEFAULT_CONFIG, true);
        if (result.collected.has(`star-${index}`) && result.passedTypes.some(item => item.stationId === `station-${index + 1}`)) {
          starCases.set(type, { seed, index });
          starResults.set(type, result);
        }
      }
    }
    expect([...starCases.keys()].sort()).toEqual(["debris", "pipes", "rock", "vine"]);
    for (const [type, { seed, index }] of starCases) {
      const result = starResults.get(type)!;
      expect(result.collected.has(`star-${index}`), `${type} seed=${seed} index=${index}`).toBe(true);
      expect(result.state.score).toBeGreaterThanOrEqual(index + 2);
      expect(result.passedTypes.some(item => item.stationId === `station-${index + 1}`), `${type} next station passed`).toBe(true);
      const starTarget = result.targetChanges.find(change => change.target === `star-${index}`)!;
      expect(starTarget.tick - starTarget.readyAt).toBeGreaterThanOrEqual(0);
    }
  }, 30_000);

  it("owns and freezes a deep copy of nested catalog route data", () => {
    const input = structuredClone(WETLAND_DEFAULT_CONFIG) as Mutable<GameConfig>;
    const originalCoinX = input.wetland!.families[0]!.rewardRoute[0]!.xOffset;
    const originalStarX = input.wetland!.starRoute.xOffset;
    const state = createRun(createRunDescriptor({ runId: "wetland-config-copy", seed: 1 }, input), input);
    expect(Object.isFrozen(input.wetland!.families[0]!.rewardRoute)).toBe(false);
    expect(Object.isFrozen(input.wetland!.families[0]!.rewardRoute[0])).toBe(false);
    expect(Object.isFrozen(input.wetland!.starRoute)).toBe(false);
    Object.assign(input.wetland!.families[0]!.rewardRoute[0]!, { xOffset: originalCoinX + 1 });
    Object.assign(input.wetland!.starRoute, { xOffset: originalStarX + 1 });
    expect(state.config.wetland!.families[0]!.rewardRoute[0]!.xOffset).toBe(originalCoinX);
    expect(state.config.wetland!.starRoute.xOffset).toBe(originalStarX);
  });
  it("uses the shared accepted/rejected configuration corpus", () => {
    for (const example of [...validationFixture.cases, ...variedValidationFixture.cases]) {
      const config = structuredClone(example.varied ? VARIED_OBSTACLE_DEFAULT_CONFIG : WETLAND_DEFAULT_CONFIG) as Mutable<GameConfig>;
      if (example.withChallenges) Object.assign(config, { challenges: PRIOR_DEFAULT_CONFIG.challenges });
      if (example.noStars) Object.assign(config, { starSchedule: null });
      if (example.removeFeather) Object.assign(config, { collectibles: config.collectibles.filter(item => item.typeId !== "FEATHER") });
      if (example.recoverySpacing !== undefined) Object.assign(config.wetland!, { recoverySpacing: example.recoverySpacing });
      if (example.removeGeometry) Object.assign(config.wetland!, { geometry: undefined });
      if (example.worldOffset !== undefined) {
        const offset = example.worldOffset;
        Object.assign(config.pipes, { ceilingY: config.pipes.ceilingY + offset, floorY: config.pipes.floorY + offset,
          gapMinCenter: config.pipes.gapMinCenter + offset, gapMaxCenter: config.pipes.gapMaxCenter + offset });
        Object.assign(config.wetland!, { introLaneCenters: config.wetland!.introLaneCenters!.map(center => center + offset),
          families: config.wetland!.families.map(family => ({ ...family, gapCenters: family.gapCenters.map(center => center + offset) })) });
      }
      if (example.geometry) Object.assign(config.wetland!.geometry!, example.geometry);
      if (example.introLaneCenter) {
        const introLaneCenters = [...config.wetland!.introLaneCenters!];
        introLaneCenters[example.introLaneCenter.index] = example.introLaneCenter.value;
        Object.assign(config.wetland!, { introLaneCenters });
      }
      if (example.limits) Object.assign(config.limits, example.limits);
      if (example.flight) Object.assign(config.flight, example.flight);
      if (example.pipes) Object.assign(config.pipes, example.pipes);
      if (example.coin) {
        const family = config.wetland!.families.find(item => item.id === example.coin!.family)!;
        const route = family.rewardRoute[example.coin.step]!;
        Object.assign(route, { ...(example.coin.xOffset === undefined ? {} : { xOffset: example.coin.xOffset }),
          ...(example.coin.yOffset === undefined ? {} : { yOffset: example.coin.yOffset }) });
      }
      if (example.starRoute) Object.assign(config.wetland!.starRoute, example.starRoute);
      if (example.accepted) expect(() => validateConfig(config), example.name).not.toThrow();
      else expect(() => validateConfig(config), example.name).toThrow();
    }
    for (const example of pairedValidationFixture.cases) {
      const config = structuredClone(DEFAULT_CONFIG) as Mutable<GameConfig>;
      if (example.mutation === "custom-center") config.wetland!.families[0]!.gapCenters[0] = 290_000;
      if (example.mutation === "mixed-obstacle") config.wetland!.families[0]!.obstacleTypes[1] = "vine";
      if (example.mutation === "varied-geometry") config.wetland!.geometry = {
        halfPipeMinPercent: 70, halfPipeMaxPercent: 90,
        floatingBarMinWidth: 90_000, floatingBarMaxWidth: 216_000, floatingBarHeight: 42_000,
      };
      if (example.mutation === "zero-height-pipe") {
        config.pipes.gapMinCenter = 78_000;
        config.wetland!.families[0]!.gapCenters = [78_000, 163_000, 248_000, 330_000];
      }
      if (example.accepted) expect(() => validateConfig(config), example.name).not.toThrow();
      else expect(() => validateConfig(config), example.name).toThrow();
    }
  });
  it("keeps both varied recovery recipes inside a translated world", () => {
    const offset = 600_000;
    for (const [seed, recipe] of [[0, [430_000, 310_000, 190_000, 78_000]], [2, [100_000, 220_000, 340_000, 460_000]]] as const) {
      const config = structuredClone(VARIED_OBSTACLE_DEFAULT_CONFIG) as Mutable<GameConfig>;
      Object.assign(config.pipes, { ceilingY: config.pipes.ceilingY + offset, floorY: config.pipes.floorY + offset,
        gapMinCenter: config.pipes.gapMinCenter + offset, gapMaxCenter: config.pipes.gapMaxCenter + offset });
      Object.assign(config.wetland!, { introLaneCenters: config.wetland!.introLaneCenters!.map(center => center + offset),
        families: config.wetland!.families.map(family => ({ ...family, gapCenters: family.gapCenters.map(center => center + offset) })) });
      const initial = createRun(createRunDescriptor({ runId: `shifted-${seed}`, seed }, config), config);
      for (let step = 0; step < recipe.length; step += 1) {
        const generated = generateNext({ ...initial, pipes: [], nextPipeIndex: 12 + step, nextPipeX: config.pipes.safeLeadIn, lastGapCenter: 280_000 + offset }).state;
        const pipe = generated.pipes[0]!;
        expect(pipe.gapCenter, `seed ${seed}, step ${step}`).toBe(recipe[step]! + offset);
        for (const obstacle of pipe.obstacles ?? []) {
          expect(obstacle.height, pipe.id).toBeGreaterThanOrEqual(0);
          expect(obstacle.y, pipe.id).toBeGreaterThanOrEqual(config.pipes.ceilingY);
          expect(obstacle.y + obstacle.height, pipe.id).toBeLessThanOrEqual(config.pipes.floorY);
        }
      }
    }
  });
  it("rejects catalog-2 custom configs under frozen version pairs while retaining catalog-1 custom runs", () => {
    const custom = structuredClone(VARIED_OBSTACLE_DEFAULT_CONFIG) as Mutable<GameConfig>;
    custom.pipes.width += 1;
    const current = createRunDescriptor({ runId: "catalog-2-custom", seed: 1 }, custom);
    expect(() => createRun(current, custom)).not.toThrow();
    for (const [simulationVersion, generatorVersion] of [[SIMULATION_VERSION, GENERATOR_VERSION], ["2.0.0", "2.0.0"], ["1.4.0", "1.3.0"], ["1.3.0", "1.2.0"]] as const) {
      expect(() => createRun({ ...current, simulationVersion, generatorVersion }, custom), `${simulationVersion}/${generatorVersion}`).toThrow();
    }
    const legacyCustom = structuredClone(WETLAND_DEFAULT_CONFIG) as Mutable<GameConfig>;
    legacyCustom.pipes.width += 1;
    const legacyDescriptor = createRunDescriptor({ runId: "catalog-1-custom", seed: 1 }, legacyCustom);
    expect(legacyDescriptor).toMatchObject({ simulationVersion: SIMULATION_VERSION, generatorVersion: GENERATOR_VERSION });
    for (const [simulationVersion, generatorVersion] of [["2.1.0", "2.1.0"], ["2.0.0", "2.0.0"], ["1.4.0", "1.3.0"], ["1.3.0", "1.2.0"]] as const) {
      expect(() => createRun({ ...legacyDescriptor, simulationVersion, generatorVersion }, legacyCustom), `catalog-1 ${simulationVersion}/${generatorVersion}`).not.toThrow();
    }
  });
  it("replays reviewed raw full-state and event vectors", () => {
    expect(pairedWetlandFixture).toMatchObject({ fixtureRevision: "wetland-paired-stations-1",
      simulationVersion: PAIRED_ROUTES_SIMULATION_VERSION, generatorVersion: PAIRED_ROUTES_GENERATOR_VERSION, configId: PAIRED_ROUTES_CONFIG_ID });
    expect(currencyFormationsFixture).toMatchObject({ fixtureRevision: "currency-formations-1",
      simulationVersion: SIMULATION_VERSION, generatorVersion: GENERATOR_VERSION, configId: DEFAULT_CONFIG_ID });
    for (const example of [...wetlandFixture.cases, ...variedWetlandFixture.cases, ...pairedWetlandFixture.cases, ...currencyFormationsFixture.cases]) {
      let state = example.syntheticInitialState
        ? example.initialState
        : createRun(example.initialState.descriptor, example.initialState.config);
      expect(canonicalState(state), example.name).toBe(canonicalState(example.initialState));
      for (const operation of example.operations) {
        expect(operation.kind).toBe("step");
        const result = step(state, operation.frames ?? []);
        expect(canonicalState(result.state), `${example.name} state`).toBe(canonicalState(operation.expectedState));
        expect(result.events, `${example.name} events`).toEqual(operation.expectedEvents);
        state = result.state;
      }
    }
  });
  it("issues the versioned wetland default and preserves the old current identity", () => {
    expect([WETLAND_SIMULATION_VERSION, WETLAND_GENERATOR_VERSION, WETLAND_DEFAULT_CONFIG_ID]).toEqual([
      "2.0.0", "2.0.0", "dd-v2-wetland-v1",
    ]);
    expect(WETLAND_DEFAULT_CONFIG.wetland?.catalogVersion).toBe(1);
    expect(createRunDescriptor({ runId: "wetland", seed: 4 }, WETLAND_DEFAULT_CONFIG)).toMatchObject({
      simulationVersion: "2.0.0", generatorVersion: "2.0.0", configId: "dd-v2-wetland-v1",
    });
    expect(createRunDescriptor({ runId: "prior", seed: 4 }, PRIOR_DEFAULT_CONFIG)).toMatchObject({
      simulationVersion: PRIOR_SIMULATION_VERSION, generatorVersion: PRIOR_GENERATOR_VERSION, configId: PRIOR_DEFAULT_CONFIG_ID,
    });
    expect(createRunDescriptor({ runId: "legacy", seed: 4 }, LEGACY_DEFAULT_CONFIG)).toMatchObject({
      simulationVersion: LEGACY_SIMULATION_VERSION, generatorVersion: LEGACY_GENERATOR_VERSION, configId: LEGACY_DEFAULT_CONFIG_ID,
    });
    for (const [runId, config] of [["prior-state", PRIOR_DEFAULT_CONFIG], ["legacy-state", LEGACY_DEFAULT_CONFIG]] as const) {
      const state = createRun(createRunDescriptor({ runId, seed: 4 }, config), config);
      const serialized = JSON.parse(canonicalState(state)) as Record<string, unknown>;
      expect(serialized).not.toHaveProperty("nextPipeX");
      expect(state.config).not.toHaveProperty("wetland");
      expect(state.pipes.every(pipe => !pipe.stationId && !pipe.obstacles)).toBe(true);
    }
  });

  it("generates reproducible four-station encounters with authored obstacles", () => {
    const config = { ...WETLAND_DEFAULT_CONFIG, pipes: { ...WETLAND_DEFAULT_CONFIG.pipes, horizon: 1_500_000 } };
    const descriptor = createRunDescriptor({ runId: "wetland", seed: 41 }, config);
    const first = createRun(descriptor, config);
    const repeated = createRun(descriptor, config);
    expect(first.pipes).toEqual(repeated.pipes);
    expect(first.pipes.slice(0, 4).map((station) => station.stationStep)).toEqual([0, 1, 2, 3]);
    expect(first.pipes.every((station) => station.stationId && station.obstacles)).toBe(true);
    expect(new Set(first.pipes.flatMap((station) => station.obstacles!.map((item) => item.typeId)))).toEqual(
      new Set(["pipes", "vine", "rock", "debris"]),
    );
    expect(first.pipes.find(station => station.obstacles?.[0]?.typeId === "pipes")?.obstacles).toHaveLength(2);
    for (const typeId of ["vine", "rock", "debris"] as const)
      expect(first.pipes.find(station => station.obstacles?.[0]?.typeId === typeId)?.obstacles).toHaveLength(1);
  });

  it("advances the wetland spawn cursor and refills after every previous station is pruned", () => {
    let state = createRun(createRunDescriptor({ runId: "wetland-refill", seed: 32 }));
    state = {
      ...state,
      phase: "RUNNING",
      tick: 2700,
      pipes: [],
      nextPipeIndex: 2,
      nextSpawnPipeIndex: 2,
      nextPipeX: 500_000,
      duck: { ...state.duck, y: 280_000, vy: 0 },
    };
    const refilled = step(state, []).state;
    expect(refilled.pipes[0]?.index).toBe(2);
    expect(refilled.pipes[0]?.x).toBe(495_200);
    expect(refilled.pipes.map(pipe => pipe.x)).toEqual([495_200, 795_200]);
    expect(refilled.nextPipeX).toBe(1_095_200);
  });

  it("scores an obstacle station once and suppresses score on a lethal tick", () => {
    const descriptor = createRunDescriptor({ runId: "wetland", seed: 8 });
    let state = createRun(descriptor);
    state = { ...state, phase: "RUNNING", pipes: [{ ...state.pipes[0]!, x: 60_000, scored: false }] };
    const passed = step(state, []);
    expect(passed.events.filter((event) => event.type === "ObstaclePassed")).toHaveLength(1);
    expect(step(passed.state, []).events.filter((event) => event.type === "ObstaclePassed")).toHaveLength(0);
    const lethal = { ...state, duck: { ...state.duck, y: state.config.pipes.floorY - state.config.flight.duckHalfHeight - 1 }, pipes: [{ ...state.pipes[0]!, x: 100_000, scored: false }] };
    expect(step(lethal, []).events.some((event) => event.type === "ObstaclePassed")).toBe(false);
  });

  it("scores and prunes a wetland station only after its actual rightmost rectangle clears", () => {
    const config = { ...WETLAND_DEFAULT_CONFIG, pipes: { ...WETLAND_DEFAULT_CONFIG.pipes, width: 100_000 } };
    const descriptor = createRunDescriptor({ runId: "wetland-right-edge", seed: 4 }, config);
    let state = createRun(descriptor, config);
    const station = {
      ...state.pipes[0]!, x: 20_000, scored: false,
      obstacles: [{ typeId: "pipes" as const, xOffset: 50_000, y: 0, width: 100_000, height: 1 }],
    };
    state = { ...state, phase: "RUNNING", tick: config.pipes.rampTicks, pipes: [station] };
    const events = [] as GameEvent[];
    for (let tick = 0; tick < 7; tick += 1) {
      const result = step(state, []);
      events.push(...result.events);
      state = result.state;
      if (tick < 6) expect(events.some(event => event.type === "ObstaclePassed")).toBe(false);
    }
    expect(events.filter(event => event.type === "ObstaclePassed")).toHaveLength(1);
    expect(state.pipes.some(pipe => pipe.stationId === station.stationId)).toBe(false);
  });

  it("uses every authored obstacle rectangle for collision", () => {
    const config = {
      ...WETLAND_DEFAULT_CONFIG,
      pipes: { ...WETLAND_DEFAULT_CONFIG.pipes, horizon: 3_000_000 },
      limits: { maxActivePipes: 8, maxActiveCollectibles: 10 },
      starSchedule: null,
    };
    const initial = createRun(createRunDescriptor({ runId: "wetland-collision", seed: 9 }, config), config);
    const sources = initial.pipes.flatMap(pipe => pipe.obstacles ?? []);
    for (const typeId of ["pipes", "vine", "rock", "debris"] as const) {
      const obstacle = sources.find(item => item.typeId === typeId)!;
      const y = obstacle.y + Math.floor(obstacle.height / 2);
      const station = { ...initial.pipes[0]!, x: initial.config.flight.duckX, obstacles: [obstacle] };
      const state = { ...initial, phase: "RUNNING" as const, duck: { ...initial.duck, y, vy: 0 }, pipes: [station] };
      expect(step(state, []).state.phase, typeId).toBe("DEAD");
    }
  });

  it("materializes complete family trails with stable one-unit IDs", () => {
    const config = {
      ...WETLAND_DEFAULT_CONFIG,
      pipes: { ...WETLAND_DEFAULT_CONFIG.pipes, horizon: 4_000_000 },
      limits: { maxActivePipes: 12, maxActiveCollectibles: 13 },
      starSchedule: null,
    };
    let state = createRun(createRunDescriptor({ runId: "wetland-trails", seed: 11 }, config), config);
    state = { ...state, phase: "RUNNING" };
    const spawned = step(state, []).state.collectibles;
    expect(spawned).toHaveLength(10);
    expect(spawned.every(item => item.typeId === "FEATHER" && item.amount === 1)).toBe(true);
    expect(spawned.map(item => item.id)).toEqual([
      "feather-trail-0-1", "feather-trail-0-3",
      "feather-trail-1-0", "feather-trail-1-1", "feather-trail-1-2", "feather-trail-1-3",
      "feather-trail-2-0", "feather-trail-2-1", "feather-trail-2-2", "feather-trail-2-3",
    ]);
    expect(new Set(spawned.map(item => item.id)).size).toBe(spawned.length);
  });

  it("reserves the scheduled Star alongside a complete authored reward route", () => {
    const config = {
      ...WETLAND_DEFAULT_CONFIG,
      pipes: { ...WETLAND_DEFAULT_CONFIG.pipes, horizon: 1_700_000 },
      limits: { maxActivePipes: 8, maxActiveCollectibles: 10 },
      starSchedule: { minIntervalPipes: 8, maxIntervalPipes: 8 },
    };
    let state = createRun(createRunDescriptor({ runId: "wetland-star-route", seed: 11 }, config), config);
    state = { ...state, phase: "RUNNING", nextStarPipeIndex: 1, starScheduleOrdinal: 0 };
    const result = step(state, []);
    expect(result.state.collectibles.some(item => item.id === "star-1" && item.typeId === "GAME_STAR")).toBe(true);
    expect(result.state.collectibles.filter(item => item.typeId === "FEATHER")).toHaveLength(3);
    expect(result.state.collectibles.length).toBeLessThanOrEqual(config.limits.maxActiveCollectibles);
  });

  it("places coin and harder Star routes from authored catalog offsets", () => {
    const config = {
      ...WETLAND_DEFAULT_CONFIG,
      pipes: { ...WETLAND_DEFAULT_CONFIG.pipes, horizon: 1_700_000 },
      limits: { maxActivePipes: 8, maxActiveCollectibles: 10 },
      starSchedule: { minIntervalPipes: 8, maxIntervalPipes: 8 },
    };
    let state = createRun(createRunDescriptor({ runId: "wetland-route-geometry", seed: 11 }, config), config);
    state = { ...state, phase: "RUNNING", nextStarPipeIndex: 1, starScheduleOrdinal: 0 };
    const result = step(state, []).state;
    const feather = result.collectibles.find(item => item.id === "feather-trail-0-1")!;
    const featherPipe = result.pipes.find(pipe => pipe.index === 1)!;
    const family = config.wetland!.families.find(item => item.id === featherPipe.encounterFamily)!;
    const coinPoint = family.rewardRoute[featherPipe.stationStep!]!;
    expect(feather.x).toBe(featherPipe.x + coinPoint.xOffset);
    expect(feather.y).toBe(featherPipe.gapCenter + coinPoint.yOffset);
    const star = result.collectibles.find(item => item.id === "star-1")!;
    expect(star.x).toBe(featherPipe.x + config.wetland!.starRoute.xOffset);
    expect(star.x - feather.x).toBeGreaterThan(80_000);
    expect(config.wetland!.starRoute).toEqual({ xOffset: 100_000, yOffset: 70_000 });
    expect(star.y).not.toBe(feather.y);
    for (const family of config.wetland!.families) family.obstacleTypes.forEach((type, index) => {
      if (type !== "debris") expect(Math.abs(config.wetland!.starRoute.yOffset)).toBeGreaterThanOrEqual(Math.abs(family.rewardRoute[index]!.yOffset) + 48_000);
    });
    expect(result.collectibles.length).toBeLessThanOrEqual(config.limits.maxActiveCollectibles);
  });

  it("keeps every authored pickup point clear of its obstacle and inside flight bounds", () => {
    const config = {
      ...WETLAND_DEFAULT_CONFIG,
      pipes: { ...WETLAND_DEFAULT_CONFIG.pipes, horizon: 10_000_000, width: 64_000 },
      limits: { maxActivePipes: 28, maxActiveCollectibles: 29 },
      starSchedule: null,
    };
    let state = createRun(createRunDescriptor({ runId: "wetland-route-bounds", seed: 41 }, config), config);
    state = { ...state, phase: "RUNNING" };
    state = step(state, []).state;
    const minY = config.pipes.ceilingY + config.flight.duckHalfHeight;
    const maxY = config.pipes.floorY - config.flight.duckHalfHeight;
    expect(state.collectibles.length).toBeGreaterThan(0);
    for (const item of state.collectibles) {
      expect(item.y).toBeGreaterThanOrEqual(minY);
      expect(item.y).toBeLessThanOrEqual(maxY);
      const sourceIndex = Number(item.id.split("-").at(-1));
      const station = state.pipes.find(pipe => pipe.index === sourceIndex || Math.floor(pipe.index / 4) === Number(item.id.split("-")[2]) && pipe.stationStep === Number(item.id.split("-")[3]));
      expect(station).toBeDefined();
      for (const obstacle of station!.obstacles ?? []) {
        expect(obstacle.width).toBe(config.pipes.width);
        const obstacleX = station!.x + obstacle.xOffset;
        const overlapsHorizontally = Math.abs(item.x - obstacleX) <= config.flight.duckHalfWidth + Math.floor(obstacle.width / 2);
        const overlapsVertically = item.y + config.flight.duckHalfHeight > obstacle.y && item.y - config.flight.duckHalfHeight < obstacle.y + obstacle.height;
        expect(overlapsHorizontally && overlapsVertically, `${item.id} vs ${obstacle.typeId}`).toBe(false);
      }
    }
  });

  it("collects complete authored coin trails for intro, quick, pressure, and recovery families", () => {
    const cases = [
      { block: 0, count: 2, y: 260_000, vy: 0 }, { block: 1, count: 4, y: 260_000, vy: 0 },
      { block: 2, count: 4, y: 260_000, vy: 0 }, { block: 3, count: 2, y: 260_000, vy: 0 },
      { block: 4, count: 4, y: 280_000, vy: 1_000 }, { block: 5, count: 2, y: 260_000, vy: 500 },
      { block: 6, count: 4, y: 260_000, vy: 0 },
    ];
    for (const { block, count, y, vy } of cases) {
      const expected = Array.from({ length: count }, (_, i) => `feather-trail-${block}-${count === 2 ? i * 2 + 1 : i}`).sort();
      const result = runLegacyRewardWitness(0, y, vy, block * 4 + 5);
      expect(result.state.phase, `block=${block} entry=${y}/${vy}`).toBe("RUNNING");
      expect(result.state.score, `block=${block}`).toBeGreaterThanOrEqual(block * 4 + 5);
      expect(expected.every(id => result.collected.has(id)), `block=${block} entry=${y}/${vy}`).toBe(true);
    }
  }, 30_000);

  it("uses only a matured visible owner snapshot for reward geometry", () => {
    const station = { readyAt: 118, observedAt: 100, x: 350_000, type: "debris", obstacleCenter: 257_000,
      obstacles: [{ typeId: "debris" as const, xOffset: 0, y: 250_000, width: 90_000, height: 14_000 }] };
    const observed = new Map([["station-8", station]]);
    expect(matureRewardOwner("feather-trail-2-0", new Map(), 200)).toBeUndefined();
    expect(matureRewardOwner("feather-trail-2-0", observed, 117)).toBeUndefined();
    expect(matureRewardOwner("feather-trail-2-0", observed, 118)).toEqual(station);
    expect(matureRewardOwner("star-8", new Map(), 200)).toBeUndefined();
  });

  it("collects the fixed seed-zero pressure trail and exits its next station at cap speed", () => {
    const result = runRewardWitness(0, 280_000, 0, 13, undefined, VARIED_OBSTACLE_DEFAULT_CONFIG, true, [3277, 3293]);
    const prefixFlaps = [2712, 2746, 2780, 2825, 2871, 2905, 2947, 2984, 3002, 3035, 3077, 3104, 3138, 3175, 3212, 3242, 3269];
    expect(result.inputs.filter(input => input.tick <= 3276 && input.flap).map(input => input.tick)).toEqual(prefixFlaps);
    expect(result.inputs.filter(input => input.tick >= 3277 && input.tick <= 3293).every(input => input.flap),
      "the accepted forced branch retains every authored flap after the world-safety guard").toBe(true);
    const branchReward = result.observedRewards.get("feather-trail-2-1");
    expect(branchReward).toBeDefined();
    expect(branchReward!.readyAt - branchReward!.observedAt).toBe(18);
    expect(branchReward!.x).toBeLessThanOrEqual(360_000);
    expect(result.targetChanges.find(item => item.target === "feather-trail-2-1")?.tick).toBe(branchReward!.readyAt);
    expect(3277).toBeGreaterThanOrEqual(branchReward!.readyAt);
    expect(result.branchCheckpoint?.tick).toBe(3294);
    expect(result.branchCheckpoint?.collectibles.find(item => item.id === "feather-trail-2-1")?.collected).toBe(false);
    expect(result.collectedAt.get("feather-trail-2-1")).toBe(3309);
    const requiredTrail = [0, 1, 2, 3].map(step => `feather-trail-2-${step}`);
    for (const id of requiredTrail) {
      const pickup = result.observedRewards.get(id);
      const ownerIndex = Number(id.split("-").at(-1)) + 8;
      const owner = result.observedStations.get(`station-${ownerIndex}`);
      expect(pickup, `${id} was observed`).toBeDefined();
      expect(owner, `${id} has an observed owner`).toBeDefined();
      expect(pickup!.readyAt - pickup!.observedAt, `${id} matures after 18 ticks`).toBe(18);
      expect(owner!.readyAt, `${id} owner is mature by collection`).toBeLessThanOrEqual(result.collectedAt.get(id)!);
      expect(result.collectionEvents.get(id), `${id} one 1-unit CurrencyCollected event`).toEqual({ count: 1, amount: 1 });
    }
    expect(result.displacements.length).toBeGreaterThan(0);
    expect(result.displacements.every(item => item.actual === item.expected), JSON.stringify(result.displacements.slice(0, 5))).toBe(true);
    const owner = result.observedStations.get("station-9");
    expect(owner).toBeDefined();
    expect(owner!.readyAt - owner!.observedAt).toBe(18);
    expect(owner!.obstacles[0]?.typeId).toBe("debris");
    expect(result.state.phase).toBe("RUNNING");
    expect(result.state.score).toBeGreaterThanOrEqual(13);
    expect(result.passedTypes.some(item => item.stationId === "station-12")).toBe(true);
    expect([0, 1, 2, 3].every(step => result.collected.has(`feather-trail-2-${step}`)),
      `collected=${JSON.stringify([...result.collected].sort())} passed=${JSON.stringify(result.passedTypes)} targetChanges=${JSON.stringify(result.targetChanges)} flaps=${JSON.stringify(result.inputs.filter(input => input.flap).map(input => input.tick))}`).toBe(true);
  }, 30_000);

  it("collects each authored Star variant and survives its next exit after the 18-tick observation delay", () => {
    const variants = [
      { station: 12, y: 260_000, vy: -1_000 }, { station: 13, y: 260_000, vy: -1_000 },
      { station: 14, y: 260_000, vy: -1_000 }, { station: 15, y: 270_000, vy: 0 },
    ];
    for (const { station, y, vy } of variants) {
      const result = runLegacyRewardWitness(0, y, vy, station + 2, station);
      expect(result.collected.has(`star-${station}`), `station=${station} entry=${y}/${vy}`).toBe(true);
      expect(result.state.phase, `station=${station}`).toBe("RUNNING");
      expect(result.state.score, `station=${station}`).toBeGreaterThanOrEqual(station + 2);
    }
  }, 30_000);

  it("witnesses mature visible catalog-1 targets through 33 scored stations across all pressure edges and entry variants", () => {
    const config = {
      ...WETLAND_DEFAULT_CONFIG,
      pipes: { ...WETLAND_DEFAULT_CONFIG.pipes, horizon: 5_000_000 },
      limits: { maxActivePipes: 24, maxActiveCollectibles: 24 },
      starSchedule: null,
    };
    const familyEdges = new Set<string>();
    for (const seed of [0, 2, 9]) for (const yOffset of [-5_000, 0, 5_000]) for (const vy of [-500, 0, 500]) {
      let state = createRun(createRunDescriptor({ runId: `wetland-witness-${seed}-${yOffset}-${vy}`, seed }, config), config);
      const entryY = state.duck.y + yOffset;
      state = { ...state, phase: "RUNNING", tick: config.pipes.rampTicks, duck: { ...state.duck, y: entryY, vy } };
      const observations = new Map<string, { readyAt: number; targetY: number; obstacleType: string; gapCenter: number }>();
      const familyByStation = new Map<string, EncounterFamilyId>();
      const passedFamilies = new Map<number, EncounterFamilyId>();
      let currentStation = "";
      let targetY = entryY;
      let targetType = "pipes";
      let targetGap = entryY;
      let targetSelected = "";
      for (let frame = 0; frame < 5_000 && state.score < 33 && state.phase !== "DEAD"; frame += 1) {
        for (const pipe of state.pipes) {
          if (pipe.stationId && pipe.encounterFamily) familyByStation.set(pipe.stationId, pipe.encounterFamily);
          if (pipe.x <= 360_000 && pipe.x >= state.duck.x - 40_000 && pipe.stationId && !observations.has(pipe.stationId)) {
            expect(pipe.x, `${pipe.stationId} observation is screen-visible`).toBeLessThanOrEqual(360_000);
            observations.set(pipe.stationId, {
              readyAt: state.tick + 18,
              targetY: nearestSafeY(state, pipe),
              obstacleType: pipe.obstacles?.[0]?.typeId ?? "pipes",
              gapCenter: pipe.gapCenter,
            });
          }
        }
        const next = state.pipes.find(pipe => pipe.x >= state.duck.x - 40_000 && pipe.x <= 360_000 &&
          pipe.stationId !== undefined && observations.has(pipe.stationId) && state.tick >= observations.get(pipe.stationId)!.readyAt);
        if (next?.stationId && next.stationId !== currentStation) {
          currentStation = next.stationId;
          targetSelected = `${state.tick}:${state.duck.y}/${state.duck.vy}`;
          const observation = observations.get(currentStation)!;
          expect(state.tick, `${currentStation} 18-tick reaction`).toBeGreaterThanOrEqual(observation.readyAt);
          targetY = observation.targetY;
          targetType = observation.obstacleType;
          targetGap = observation.gapCenter;
        }
        const threshold = targetType === "debris" && targetY < targetGap ? 18_000 : 23_000;
        let flap = state.duck.y > targetY + threshold && state.duck.vy > 0;
        const flight = state.config.flight;
        const coastY = state.duck.y + Math.min(flight.maxFallSpeed, state.duck.vy + flight.gravity);
        const flapY = state.duck.y + Math.min(flight.maxFallSpeed, flight.flapVelocity + flight.gravity);
        if ((coastY - flight.duckHalfHeight <= state.config.pipes.ceilingY ||
          coastY + flight.duckHalfHeight >= state.config.pipes.floorY) &&
          flapY - flight.duckHalfHeight > state.config.pipes.ceilingY &&
          flapY + flight.duckHalfHeight < state.config.pipes.floorY) flap = true;
        for (const pipe of state.pipes) {
          if (!pipe.stationId || state.tick < (observations.get(pipe.stationId)?.readyAt ?? Number.POSITIVE_INFINITY)) continue;
          const obstacles = pipe.obstacles ?? [];
          const coastHits = obstacles.some(obstacle => projectedObstacleHit(state, pipe, obstacle, false));
          const flapHits = obstacles.some(obstacle => projectedObstacleHit(state, pipe, obstacle, true));
          if (coastHits && !flapHits) flap = true;
        }
        const result = step(state, flap ? [makeInput(state.nextInputSequence, "FLAP")] : []);
        for (const event of result.events) {
          if (event.type !== "ObstaclePassed") continue;
          const family = familyByStation.get(event.stationId);
          const stationIndex = Number(event.stationId.slice("station-".length));
          if (family && Number.isSafeInteger(stationIndex) && stationIndex % 4 === 3) passedFamilies.set(Math.floor(stationIndex / 4), family);
        }
        state = result.state;
      }
      expect(state.phase, `seed=${seed} yOffset=${yOffset} vy=${vy} tick=${state.tick} score=${state.score} duck=${state.duck.y}/${state.duck.vy} target=${currentStation}:${targetY}@${targetSelected} nearby=${JSON.stringify(state.pipes.map(pipe => ({ index: pipe.index, x: pipe.x, family: pipe.encounterFamily, obstacles: pipe.obstacles })).filter(pipe => pipe.x < state.duck.x + 100_000))}`).toBe("RUNNING");
      expect(state.score, `seed=${seed} yOffset=${yOffset} vy=${vy}`).toBeGreaterThanOrEqual(33);
      const sequence = [...passedFamilies.entries()].sort((a, b) => a[0] - b[0]).map(([, family]) => family);
      for (let i = 1; i < sequence.length; i += 1) familyEdges.add(`${sequence[i - 1]}->${sequence[i]}`);
    }
    expect([...familyEdges].sort()).toEqual([
      "climb-dive->steady", "dive-climb->steady", "quick-pairs->climb-dive",
      "quick-pairs->dive-climb", "quick-pairs->slalom", "slalom->steady",
      "steady->climb-dive", "steady->dive-climb", "steady->quick-pairs", "steady->slalom",
    ]);
  }, 30_000);

  if (process.env.RUN_MIXED_OBSTACLE_EXPERIMENTS === "1") {
  it("declares and witnesses all 27 custom-cap survival cells through station 32", () => {
    const declaredCells = [0, 2, 9].flatMap(seed => [275_000, 280_000, 285_000]
      .flatMap(entryY => [-500, 0, 500].map(entryVy => ({ seed, entryY, entryVy }))));
    expect(declaredCells).toHaveLength(27);
    const familyEdges = new Set<string>();
    const failures: string[] = [];
    for (const cell of declaredCells) {
      const label = `seed=${cell.seed} y=${cell.entryY} vy=${cell.entryVy}`;
      try {
        const result = runPlannedWitness(cell.seed, cell.entryY, cell.entryVy, 33, VARIED_OBSTACLE_DEFAULT_CONFIG);
        expect(result.initialState.descriptor.configId, label).toMatch(/^dd-v1-config:/);
        expect({ profile: result.profile, seed: result.initialState.descriptor.seed, phase: result.initialState.phase,
          tick: result.initialState.tick, y: result.initialState.duck.y, vy: result.initialState.duck.vy,
          horizon: result.initialState.config.pipes.horizon, maxActivePipes: result.initialState.config.limits.maxActivePipes,
          maxActiveCollectibles: result.initialState.config.limits.maxActiveCollectibles,
          starSchedule: result.initialState.config.starSchedule ?? null })
          .toEqual({ profile: "custom-cap", seed: cell.seed, phase: "RUNNING", tick: VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.rampTicks,
            y: cell.entryY, vy: cell.entryVy, horizon: 1_700_000, maxActivePipes: 24, maxActiveCollectibles: 25,
            starSchedule: null });
        expect(worldSpeedAt(result.initialState.config, result.initialState.tick + 1, result.initialState.score))
          .toBe(result.initialState.config.pipes.maxSpeed);
        expect(result.state.phase, `${label} final=${result.state.tick}/${result.state.score}/${result.state.duck.y}/${result.state.duck.vy} planning=${JSON.stringify(result.planning.slice(-3))}`)
          .toBe("RUNNING");
        expect(result.state.score, label).toBeGreaterThanOrEqual(33);
        expect(result.passed.some(item => item.stationId === "station-32"), label).toBe(true);
        expect(result.displacements.length, label).toBeGreaterThan(0);
        expect(result.displacements.every(item => item.actual === item.expected), `${label} displacement=${JSON.stringify(result.displacements.slice(0, 3))}`).toBe(true);
        for (const observation of result.observations) {
          expect(observation.x, `${label} ${observation.stationId} visible center`).toBeLessThanOrEqual(360_000);
          expect(observation.readyAt - observation.observedAt, `${label} ${observation.stationId} reaction`).toBe(18);
          const activation = result.planning.find(item => item.mature.includes(observation.stationId));
          expect(activation, `${label} ${observation.stationId} planner activation`).toBeDefined();
          expect(activation!.tick, `${label} ${observation.stationId} activation`).toBe(observation.readyAt);
          expect(activation!.planned, `${label} ${observation.stationId} plan`).not.toBeNull();
        }
        const completedBlocks = result.passed.filter(item => Number(item.stationId.slice("station-".length)) % 4 === 3);
        for (let index = 1; index < completedBlocks.length; index += 1) {
          const previous = completedBlocks[index - 1]!.family;
          const current = completedBlocks[index]!.family;
          if (previous && current) familyEdges.add(`${previous}->${current}`);
        }
      } catch (error) {
        failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect([...familyEdges].sort()).toEqual([
      "climb-dive->steady", "dive-climb->steady", "quick-pairs->climb-dive",
      "quick-pairs->dive-climb", "quick-pairs->slalom", "slalom->steady",
      "steady->climb-dive", "steady->dive-climb", "steady->quick-pairs", "steady->slalom",
    ]);
    expect(failures, `failed declared cells:\n${failures.join("\n")}`).toEqual([]);
  }, 300_000);

  it("counterfactually coasts through ticks 4654-4655 after mature station-28 downflow", () => {
    const baseline = runPlannedWitness(9, 275_000, 500, 31, VARIED_OBSTACLE_DEFAULT_CONFIG,
      { capturePlannerFailureAt: 4656, captureTicks: [4653, 4654, 4655, 4656] });
    expect(baseline.plannerFailure).toContain("tick=4656");
    expect(baseline.plannerFailure).toContain("reason=no-survivor-at-28");
    expect(baseline.state.tick).toBe(4656);
    expect(baseline.inputs.find(input => input.tick === 4654)?.flap).toBe(true);
    expect(baseline.inputs.find(input => input.tick === 4655)?.flap).toBe(false);

    const result = runPlannedWitness(9, 275_000, 500, 31, VARIED_OBSTACLE_DEFAULT_CONFIG,
      { forceCoastTicks: [4654, 4655], captureTicks: [4653, 4654, 4655, 4656] });
    expect(result.profile).toBe("custom-cap");
    expect(result.initialState).toMatchObject({ phase: "RUNNING", tick: VARIED_OBSTACLE_DEFAULT_CONFIG.pipes.rampTicks,
      duck: { y: 275_000, vy: 500 }, config: { pipes: { horizon: 1_700_000 }, limits: { maxActivePipes: 24, maxActiveCollectibles: 25 } } });
    expect(result.initialState.config.starSchedule ?? null).toBeNull();
    expect(canonicalState(result.snapshots.get(4653)!)).toEqual(canonicalState(baseline.snapshots.get(4653)!));
    expect(result.inputs.filter(input => input.tick <= 4653)).toEqual(baseline.inputs.filter(input => input.tick <= 4653));
    expect(result.inputs.find(input => input.tick === 4654)).toEqual({ tick: 4654, flap: false });
    expect(result.inputs.find(input => input.tick === 4655)).toEqual({ tick: 4655, flap: false });

    const publicBeforeBranch = result.snapshots.get(4653)!;
    const station26 = result.observations.find(item => item.stationId === "station-26")!;
    const station28 = result.observations.find(item => item.stationId === "station-28")!;
    const station29 = result.observations.find(item => item.stationId === "station-29")!;
    const opening26 = pairedPipeOpening(publicBeforeBranch, station26.obstacles)!;
    const opening28 = pairedPipeOpening(publicBeforeBranch, station28.obstacles)!;
    expect(station28.readyAt).toBeLessThanOrEqual(publicBeforeBranch.tick);
    expect(opening28.center).toBeGreaterThan(opening26.center);
    expect(publicBeforeBranch.duck).toMatchObject({ y: 165_620, vy: 2_080 });
    expect(station29).toMatchObject({ observedAt: 4_638, readyAt: 4_656 });
    expect(station29.x).toBeLessThanOrEqual(360_000);
    expect(result.planning.filter(item => item.tick < station29.readyAt).every(item => !item.mature.includes("station-29"))).toBe(true);
    const station29Activation = result.planning.find(item => item.tick === station29.readyAt);
    expect(station29Activation?.mature).toContain("station-29");
    expect(result.snapshots.get(4656)?.duck).toMatchObject({ y: 173_780, vy: 3_040 });

    expect(result.state.phase).toBe("RUNNING");
    expect(result.state.score).toBeGreaterThanOrEqual(31);
    expect(result.passed.some(item => item.stationId === "station-29")).toBe(true);
    expect(result.passed.some(item => item.stationId === "station-30")).toBe(true);
    console.info("M4B1 fixed counterfactual result", JSON.stringify({
      baselineFailure: baseline.plannerFailure,
      initial: { profile: result.profile, seed: result.initialState.descriptor.seed, tick: result.initialState.tick,
        y: result.initialState.duck.y, vy: result.initialState.duck.vy, horizon: result.initialState.config.pipes.horizon,
        maxActivePipes: result.initialState.config.limits.maxActivePipes,
        maxActiveCollectibles: result.initialState.config.limits.maxActiveCollectibles, starSchedule: result.initialState.config.starSchedule },
      observations: { station26, station28, station29 },
      publicBeforeBranch: { tick: publicBeforeBranch.tick, y: publicBeforeBranch.duck.y, vy: publicBeforeBranch.duck.vy,
        opening26: opening26.center, opening28: opening28.center },
      branchStates: [4653, 4654, 4655, 4656].map(tick => ({ tick,
        y: result.snapshots.get(tick)?.duck.y, vy: result.snapshots.get(tick)?.duck.vy })),
      prefixFlaps: result.inputs.filter(input => input.tick <= 4653 && input.flap).map(input => input.tick),
      branchInputs: result.inputs.filter(input => input.tick >= 4654 && input.tick <= 4665),
      station29Plan: station29Activation, exit: { phase: result.state.phase, tick: result.state.tick, score: result.state.score,
        passed: result.passed.filter(item => [29, 30].includes(Number(item.stationId.slice(8)))) },
      inputs: result.inputs,
    }));
  }, 30_000);
  }

  it("matches the reviewed shared station catalog and pressure/recovery sequence", () => {
    expect(wetlandFixture).toMatchObject({
      fixtureRevision: "wetland-stations-1", simulationVersion: WETLAND_SIMULATION_VERSION,
      generatorVersion: WETLAND_GENERATOR_VERSION, configId: WETLAND_DEFAULT_CONFIG_ID,
    });
    expect(WETLAND_DEFAULT_CONFIG.wetland!.families).toEqual(wetlandFixture.catalog);
    expect(WETLAND_DEFAULT_CONFIG.wetland!.starRoute).toEqual(wetlandFixture.starRoute);
    const config = {
      ...WETLAND_DEFAULT_CONFIG,
      pipes: { ...WETLAND_DEFAULT_CONFIG.pipes, horizon: 10_000_000 },
      limits: { maxActivePipes: 28, maxActiveCollectibles: 29 },
      starSchedule: null,
    };
    const descriptor = createRunDescriptor({ runId: "wetland-fixture", seed: wetlandFixture.seed }, config);
    const state = createRun(descriptor, config);
    expect(state.pipes.slice(0, wetlandFixture.familySequence.length * 4).filter((_, index) => index % 4 === 0).map(pipe => pipe.encounterFamily))
      .toEqual(wetlandFixture.familySequence);
    for (const pipe of state.pipes.slice(0, wetlandFixture.familySequence.length * 4)) {
      const family = wetlandFixture.catalog.find(candidate => candidate.id === pipe.encounterFamily)!;
      const step = pipe.stationStep!;
      expect(pipe.gapCenter).toBe(family.gapCenters[step]);
      expect(pipe.obstacles?.every(obstacle => obstacle.typeId === family.obstacleTypes[step])).toBe(true);
      const block = Math.floor(pipe.index / 4);
      expect(pipe.stationSpacing).toBe(pipe.encounterFamily === "steady" && block >= 2 && block % 2 === 1
        ? WETLAND_DEFAULT_CONFIG.wetland!.recoverySpacing : family.stationSpacing[step]);
    }
    for (let index = 2; index < wetlandFixture.familySequence.length; index += 2)
      expect(wetlandFixture.familySequence[index]).not.toBe(wetlandFixture.familySequence[index - 2]);
    const pruned = { ...state, pipes: [], nextPipeX: 9_500_000, nextPipeIndex: 28 };
    const refilled = generateNext(pruned).state;
    expect(refilled.pipes[0]?.index).toBe(28);
    expect(refilled.pipes[0]?.x).toBe(9_500_000);
  });
});
