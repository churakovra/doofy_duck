import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COIN_COURSE_CONFIG_ID, COIN_COURSE_DEFAULT_CONFIG, COIN_COURSE_GENERATOR_VERSION,
  CURRENCY_FORMATIONS_DEFAULT_CONFIG,
  COIN_COURSE_SIMULATION_VERSION, canonicalState, createRun, createRunDescriptor,
  makeInput, pauseRun, resumeRun, restartRun, step, validateConfig,
} from "../src/index.js";
import { currencyFormationPoints, generateNext, isCoinCourseBlock } from "../src/generation.js";
import { worldSpeedAt } from "../src/generation.js";
import type { RunState } from "../src/index.js";

const courseSeed = Array.from({ length: 32 }, (_, seed) => seed).find(seed => isCoinCourseBlock(seed, 2))!;

function preparedBlock(seed: number, block: number): RunState {
  const state = createRun(createRunDescriptor({ runId: `coin-course-${seed}-${block}`, seed }, COIN_COURSE_DEFAULT_CONFIG));
  return generateNext({ ...state, pipes: [], nextPipeIndex: block * 4, nextPipeX: 100_000,
    lastGapCenter: 280_000 }).state;
}

function firstCourseBlock(seed: number): number {
  return [2, 4, 6].find(block => isCoinCourseBlock(seed, block))!;
}

function canFlyCourse(seed: number, block: number, entryY: number, entryVy: number, startTick: number): boolean {
  const generated = preparedBlock(seed, block).pipes.slice(0, 4);
  const pipes = generated.map((pipe, index) => ({ ...pipe, x: 450_000 + [0, 180_000, 360_000, 720_000][index]! }));
  const { config } = createRun(createRunDescriptor({ runId: "coin-course-physics", seed }, COIN_COURSE_DEFAULT_CONFIG));
  let beam = [{ y: entryY, vy: entryVy }];
  let traveled = 0;
  for (let tick = 1; tick < 500; tick++) {
    traveled += worldSpeedAt(config, startTick + tick, 0);
    const unique = new Map<string, { y: number; vy: number }>();
    for (const node of beam) for (const flap of [false, true]) {
      const vy = Math.min(config.flight.maxFallSpeed, (flap ? config.flight.flapVelocity : node.vy) + config.flight.gravity);
      const y = node.y + vy;
      if (y - config.flight.duckHalfHeight <= config.pipes.ceilingY || y + config.flight.duckHalfHeight >= config.pipes.floorY) continue;
      const dead = pipes.some(pipe => (pipe.obstacles ?? []).some(obstacle => {
        const x = pipe.x - traveled;
        const left = x + obstacle.xOffset - Math.floor(obstacle.width / 2);
        const right = x + obstacle.xOffset + Math.floor(obstacle.width / 2);
        return right >= config.flight.duckX - config.flight.duckHalfWidth &&
          left <= config.flight.duckX + config.flight.duckHalfWidth &&
          y + config.flight.duckHalfHeight >= obstacle.y && y - config.flight.duckHalfHeight <= obstacle.y + obstacle.height;
      }));
      if (!dead) unique.set(`${y}:${vy}`, { y, vy });
    }
    if (pipes.every(pipe => pipe.x - traveled + config.pipes.width / 2 < config.flight.duckX - config.flight.duckHalfWidth)) return true;
    beam = [...unique.values()];
    if (beam.length === 0) return false;
    if (beam.length > 100) {
      const target = pipes.find(pipe => pipe.x - traveled + config.pipes.width / 2 >= config.flight.duckX)?.gapCenter ?? 280_000;
      beam = beam.sort((a, b) => Math.abs(a.y - target) + Math.abs(a.vy) * 4 - Math.abs(b.y - target) - Math.abs(b.vy) * 4).slice(0, 100);
    }
  }
  return false;
}

describe("occasional coin course", () => {
  it("uses a deterministic staggered schedule with normal blocks between courses", () => {
    const first = 2 + 2 * ((awaitMix(courseSeed)) % 3);
    expect(isCoinCourseBlock(courseSeed, first)).toBe(true);
    expect(isCoinCourseBlock(courseSeed, first + 6)).toBe(true);
    expect(isCoinCourseBlock(courseSeed, first + 1)).toBe(false);
    expect(isCoinCourseBlock(courseSeed, first + 2)).toBe(false);
    expect(isCoinCourseBlock(courseSeed, first + 5)).toBe(false);
    expect(isCoinCourseBlock(courseSeed, first + 7)).toBe(false);
    const course = preparedBlock(courseSeed, first).pipes;
    expect(course.slice(0, 4).map(pipe => pipe.x)).toEqual([100_000, 280_000, 460_000, 820_000]);
    expect(course.slice(0, 4).every(pipe => pipe.obstacles?.length === 2)).toBe(true);
    expect(course.slice(0, 2).every(pipe => pipe.stationSpacing === 180_000)).toBe(true);
    expect(course[2]!.stationSpacing).toBe(360_000);
    const regular = preparedBlock(courseSeed, first + 1).pipes;
    expect(regular[0]!.stationSpacing).not.toBe(180_000);
  }, 30_000);

  it("places three safe FEATHER pickups beyond the third gate and resumes normal stations", () => {
    const first = 2 + 2 * ((awaitMix(courseSeed)) % 3);
    const blockState = preparedBlock(courseSeed, first);
    const third = first * 4 + 2;
    const initial: RunState = { ...blockState, phase: "RUNNING", nextSpawnPipeIndex: third,
      duck: { ...blockState.duck, y: 280_000, vy: 0 } };
    const result = step(initial, [makeInput(initial.nextInputSequence, "FLAP")]);
    const coins = result.state.collectibles.filter(item => item.typeId === "FEATHER");
    expect(coins).toHaveLength(3);
    expect(new Set(coins.map(item => item.id)).size).toBe(3);
    const gate = result.state.pipes.find(pipe => pipe.index === third)!;
    expect(coins.every(item => item.x - item.radius - result.state.config.flight.duckHalfWidth >
      gate.x + result.state.config.pipes.width / 2)).toBe(true);
    expect(coins.every(item => item.y - item.radius - result.state.config.flight.duckHalfHeight >
      gate.gapCenter - result.state.config.pipes.gapHeight / 2 &&
      item.y + item.radius + result.state.config.flight.duckHalfHeight <
      gate.gapCenter + result.state.config.pipes.gapHeight / 2)).toBe(true);
    expect(coins.every(item => item.amount === 1)).toBe(true);
    expect(result.state.pipes.find(pipe => pipe.index === third + 1)?.x).toBeGreaterThan(gate.x);
    expect(result.state.phase).toBe("RUNNING");
  });

  it("uses ordinary catalog-4 formation geometry outside courses and the course trail only on schedule", () => {
    const first = firstCourseBlock(courseSeed);
    const coursePipe = preparedBlock(courseSeed, first).pipes[2]!;
    const ordinaryPipe = preparedBlock(courseSeed, first + 1).pipes[2]!;
    const radius = COIN_COURSE_DEFAULT_CONFIG.collectibles.find(item => item.typeId === "FEATHER")!.radius;

    const ordinaryCourseConfigPoints = currencyFormationPoints(
      COIN_COURSE_DEFAULT_CONFIG, courseSeed, ordinaryPipe, radius,
    );
    const catalog4Points = currencyFormationPoints(
      CURRENCY_FORMATIONS_DEFAULT_CONFIG, courseSeed, ordinaryPipe, radius,
    );
    expect(isCoinCourseBlock(courseSeed, Math.floor(ordinaryPipe.index / 4))).toBe(false);
    expect(ordinaryCourseConfigPoints).toEqual(catalog4Points);

    const scheduledPoints = currencyFormationPoints(COIN_COURSE_DEFAULT_CONFIG, courseSeed, coursePipe, radius);
    expect(isCoinCourseBlock(courseSeed, Math.floor(coursePipe.index / 4))).toBe(true);
    expect(scheduledPoints.map(point => point.x)).toEqual([
      coursePipe.x + 70_000, coursePipe.x + 100_000, coursePipe.x + 130_000,
    ]);
    expect(scheduledPoints).not.toEqual(currencyFormationPoints(
      CURRENCY_FORMATIONS_DEFAULT_CONFIG, courseSeed, coursePipe, radius,
    ));
  });

  it("validates the close gate and coin/Star clearance and capacity", () => {
    expect(validateConfig(COIN_COURSE_DEFAULT_CONFIG)).toBe(COIN_COURSE_DEFAULT_CONFIG);
    expect(() => validateConfig({ ...COIN_COURSE_DEFAULT_CONFIG,
      pipes: { ...COIN_COURSE_DEFAULT_CONFIG.pipes, width: 100_000 },
    })).toThrow(/currency formation clearance/);
    expect(() => validateConfig({ ...COIN_COURSE_DEFAULT_CONFIG,
      limits: { ...COIN_COURSE_DEFAULT_CONFIG.limits, maxActiveCollectibles: 28 },
    })).toThrow();
  });

  it("replays pause/resume and restart without course pickup duplication", () => {
    const first = 2 + 2 * ((awaitMix(courseSeed)) % 3);
    const blockState = preparedBlock(courseSeed, first);
    const third = first * 4 + 2;
    const initial: RunState = { ...blockState, phase: "RUNNING", nextSpawnPipeIndex: third,
      duck: { ...blockState.duck, y: 280_000, vy: 0 } };
    const direct = step(initial, [makeInput(initial.nextInputSequence, "FLAP")]).state;
    const resumed = step(resumeRun(pauseRun(initial)), [makeInput(initial.nextInputSequence, "FLAP")]).state;
    expect(canonicalState(resumed)).toBe(canonicalState(direct));
    const restarted = restartRun(initial, createRunDescriptor({ runId: "coin-course-restarted", seed: courseSeed }, COIN_COURSE_DEFAULT_CONFIG));
    expect(restarted.collectibles).toEqual([]);
    expect(restarted.pipes.map(pipe => pipe.index)).toEqual([0, 1]);
    expect(new Set(restarted.collectibles.map(item => item.id)).size).toBe(restarted.collectibles.length);
  });

  it("has physics witnesses from varied entry states at initial and maximum speed", () => {
    const courseSeeds = [2, 4, 6].map(target => Array.from({ length: 128 }, (_, seed) => seed)
      .find(seed => firstCourseBlock(seed) === target)!);
    for (const seed of courseSeeds) {
      const block = firstCourseBlock(seed);
      for (const startTick of [0, COIN_COURSE_DEFAULT_CONFIG.pipes.rampTicks]) {
        for (const [y, vy] of [[275_000, -500], [280_000, 0], [285_000, 500]] as const) {
          expect(canFlyCourse(seed, block, y, vy, startTick), `seed=${seed} block=${block} tick=${startTick} entry=${y}/${vy}`).toBe(true);
        }
      }
    }
  }, 30_000);

  it("replays the independent JSON contract for the new identity", () => {
    const fixture = JSON.parse(readFileSync("contracts/simulation/coin-course-v1.json", "utf8"));
    expect(fixture).toMatchObject({ fixtureRevision: "coin-course-1", configId: COIN_COURSE_CONFIG_ID,
      simulationVersion: COIN_COURSE_SIMULATION_VERSION, generatorVersion: COIN_COURSE_GENERATOR_VERSION });
    for (const example of fixture.cases) {
      let state = example.initialState as RunState;
      expect(canonicalState(state)).toBe(canonicalState(example.initialState));
      for (const operation of example.operations) {
        const result = step(state, operation.frames);
        expect(canonicalState(result.state)).toBe(canonicalState(operation.expectedState));
        expect(result.events).toEqual(operation.expectedEvents);
        state = result.state;
      }
    }
  });
});

function awaitMix(seed: number): number {
  // Keep the same unsigned Murmur finalizer as the schedule's independent salt.
  let x = (seed ^ 0x6d2b79f5) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x % 3;
}
