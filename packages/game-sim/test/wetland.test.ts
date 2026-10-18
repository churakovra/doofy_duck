import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PRIOR_DEFAULT_CONFIG,
  WETLAND_DEFAULT_CONFIG,
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
import type { EncounterFamilyId, GameConfig, GameEvent, InputFrame, RunState } from "../src/index.js";

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? Mutable<U>[] : T[K] extends object ? Mutable<T[K]> : T[K] };

function safeIntervals(state: RunState, station: RunState["pipes"][number]): [number, number][] {
  const { flight, pipes } = state.config;
  const min = pipes.ceilingY + flight.duckHalfHeight + 1;
  const max = pipes.floorY - flight.duckHalfHeight - 1;
  const blocked = (station.obstacles ?? []).map(obstacle => [
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
  return safe.map(([a, b]): [number, number] => [a + 25000, b - 25000]).filter(([a, b]) => a <= b);
}

function nearestSafeY(state: RunState, station: RunState["pipes"][number]): number {
  const preferredY = 280_000;
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

function runRewardWitness(seed: number, entryY: number, entryVy: number, scoreTarget: number, starIndex?: number) {
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
        expect(station.x, `${station.stationId} observation is screen-visible`).toBeLessThanOrEqual(360_000);
        observedStations.set(station.stationId, {
          readyAt: state.tick + 18, y: nearestSafeY(state, station),
          type: station.obstacles?.[0]?.typeId ?? "pipes", gap: station.gapCenter,
        });
      }
    }
    for (const item of state.collectibles) {
      if (!observedRewards.has(item.id) && item.x <= 360_000 && item.x >= state.duck.x - 40_000) {
        expect(item.x, `${item.id} observation is screen-visible`).toBeLessThanOrEqual(360_000);
        const stationIndex = item.id.startsWith("star-") ? Number(item.id.slice(5)) : Number(item.id.split("-")[2]) * 4 + Number(item.id.split("-")[3]);
        const owner = state.pipes.find(station => station.index === stationIndex);
        observedRewards.set(item.id, {
          readyAt: state.tick + 18, y: item.y, type: owner?.obstacles?.[0]?.typeId ?? "pipes", gap: owner?.gapCenter ?? item.y,
        });
      }
    }
    const reward = state.collectibles.filter(item => !item.collected && observedRewards.has(item.id) && state.tick >= observedRewards.get(item.id)!.readyAt)
      .filter(item => item.x >= state.duck.x - 40_000).sort((a, b) => a.x - b.x)[0];
    const station = state.pipes.find(item => item.stationId && item.x >= state.duck.x - 40_000 && item.x <= 360_000 &&
      observedStations.has(item.stationId) && state.tick >= observedStations.get(item.stationId)!.readyAt);
    const target = reward?.id ?? station?.stationId ?? "";
    if (reward) expect(state.tick, `${reward.id} 18-tick reaction`).toBeGreaterThanOrEqual(observedRewards.get(reward.id)!.readyAt);
    if (!reward && station) expect(state.tick, `${station.stationId} 18-tick reaction`).toBeGreaterThanOrEqual(observedStations.get(station.stationId!)!.readyAt);
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
    name: string; accepted: boolean; noStars?: boolean; withChallenges?: boolean;
    removeFeather?: boolean; recoverySpacing?: number;
    limits?: Partial<GameConfig["limits"]>; flight?: Partial<GameConfig["flight"]>;
    pipes?: Partial<GameConfig["pipes"]>;
    coin?: { family: EncounterFamilyId; step: number; xOffset?: number; yOffset?: number };
    starRoute?: { xOffset?: number; yOffset?: number };
  }[];
};

describe("wetland station contract", () => {
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
    for (const example of validationFixture.cases) {
      const config = structuredClone(WETLAND_DEFAULT_CONFIG) as Mutable<GameConfig>;
      if (example.withChallenges) Object.assign(config, { challenges: PRIOR_DEFAULT_CONFIG.challenges });
      if (example.noStars) Object.assign(config, { starSchedule: null });
      if (example.removeFeather) Object.assign(config, { collectibles: config.collectibles.filter(item => item.typeId !== "FEATHER") });
      if (example.recoverySpacing !== undefined) Object.assign(config.wetland!, { recoverySpacing: example.recoverySpacing });
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
  });
  it("replays reviewed raw full-state and event vectors", () => {
    for (const example of wetlandFixture.cases) {
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
    expect(createRunDescriptor({ runId: "wetland", seed: 4 })).toMatchObject({
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
      const result = runRewardWitness(0, y, vy, block * 4 + 5);
      expect(result.state.phase, `block=${block} entry=${y}/${vy}`).toBe("RUNNING");
      expect(result.state.score, `block=${block}`).toBeGreaterThanOrEqual(block * 4 + 5);
      expect(expected.every(id => result.collected.has(id)), `block=${block} entry=${y}/${vy}`).toBe(true);
    }
  }, 30_000);

  it("collects each authored Star variant and survives its next exit after the 18-tick observation delay", () => {
    const variants = [
      { station: 12, y: 260_000, vy: -1_000 }, { station: 13, y: 260_000, vy: -1_000 },
      { station: 14, y: 260_000, vy: -1_000 }, { station: 15, y: 270_000, vy: 0 },
    ];
    for (const { station, y, vy } of variants) {
      const result = runRewardWitness(0, y, vy, station + 2, station);
      expect(result.collected.has(`star-${station}`), `station=${station} entry=${y}/${vy}`).toBe(true);
      expect(result.state.phase, `station=${station}`).toBe("RUNNING");
      expect(result.state.score, `station=${station}`).toBeGreaterThanOrEqual(station + 2);
    }
  }, 30_000);

  it("witnesses mature visible targets through 33 scored stations across all pressure edges and entry variants", () => {
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
