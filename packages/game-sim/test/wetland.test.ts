import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PRIOR_DEFAULT_CONFIG,
  WETLAND_DEFAULT_CONFIG,
  VARIED_OBSTACLE_DEFAULT_CONFIG,
  CURRENCY_FORMATIONS_DEFAULT_CONFIG as DEFAULT_CONFIG,
  CURRENCY_FORMATIONS_CONFIG_ID,
  CURRENCY_FORMATIONS_SIMULATION_VERSION,
  CURRENCY_FORMATIONS_GENERATOR_VERSION,
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
  validateConfig,
} from "../src/index.js";
import { wetlandRewardPoint } from "../src/generation.js";
import type { EncounterFamilyId, GameConfig, GameEvent, InputFrame, RunState } from "../src/index.js";

type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

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
  it("issues paired routes while retaining frozen varied and 2.0 wetland identities", () => {
    expect([SIMULATION_VERSION, GENERATOR_VERSION, DEFAULT_CONFIG_ID]).toEqual([
      "3.3.0", "3.3.0", "dd-v3-random-pipes-v1",
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
      simulationVersion: CURRENCY_FORMATIONS_SIMULATION_VERSION, generatorVersion: CURRENCY_FORMATIONS_GENERATOR_VERSION, configId: CURRENCY_FORMATIONS_CONFIG_ID });
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
    let state = createRun(createRunDescriptor({ runId: "wetland-refill", seed: 32 }, DEFAULT_CONFIG), DEFAULT_CONFIG);
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
