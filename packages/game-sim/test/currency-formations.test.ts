import { describe, expect, it } from "vitest";
import { createRun, createRunDescriptor, CURRENCY_FORMATIONS_DEFAULT_CONFIG as DEFAULT_CONFIG, CURRENCY_FORMATIONS_GENERATOR_VERSION as GENERATOR_VERSION, CURRENCY_FORMATIONS_SIMULATION_VERSION as SIMULATION_VERSION, step, validateConfig } from "../src/index.js";
import { currencyFormationPoints } from "../src/generation.js";

function spawned(seed: number) {
  let state = createRun(createRunDescriptor({ runId: `formations-${seed}`, seed }, DEFAULT_CONFIG), DEFAULT_CONFIG);
  for (let tick = 0; tick < 500 && state.phase !== "DEAD"; tick++) {
    const result = step(state, [{ sequence: state.nextInputSequence, action: "FLAP" }]);
    state = result.state;
    const feathers = state.collectibles.filter(item => item.typeId === "FEATHER");
    if (feathers.length >= 3) return { state, feathers: feathers.slice(0, 3) };
  }
  throw new Error("formation did not spawn in first 500 ticks");
}

function routeSide(state: ReturnType<typeof createRun>, members: ReturnType<typeof spawned>["feathers"]): "inside" | "outside" | "invalid" {
  const [, , block, stationStep] = members[0]!.id.split("-");
  const owner = state.pipes.find(pipe => pipe.index === Number(block) * 4 + Number(stationStep))!;
  const safeY = members.every(item => item.y - item.radius - state.config.flight.duckHalfHeight > owner.gapCenter - state.config.pipes.gapHeight / 2 &&
    item.y + item.radius + state.config.flight.duckHalfHeight < owner.gapCenter + state.config.pipes.gapHeight / 2);
  const inside = members.every(item => item.x + item.radius + state.config.flight.duckHalfWidth >= owner.x &&
    item.x - item.radius - state.config.flight.duckHalfWidth <= owner.x + state.config.pipes.width);
  const outside = members.every(item => item.x + item.radius + state.config.flight.duckHalfWidth < owner.x ||
    item.x - item.radius - state.config.flight.duckHalfWidth > owner.x + state.config.pipes.width);
  if (!safeY) return "invalid";
  return inside ? "inside" : outside ? "outside" : "invalid";
}

describe("currency formations", () => {
  it("issues a new config identity while retaining paired-route replay identity", () => {
    expect([SIMULATION_VERSION, GENERATOR_VERSION, DEFAULT_CONFIG.wetland?.catalogVersion]).toEqual(["2.3.0", "2.3.0", 4]);
  });

  it("spawns three individual unit FEATHER members with deterministic, seed-varied layouts", () => {
    const { state, feathers: first } = spawned(1);
    const repeat = spawned(1).feathers;
    const otherSeed = spawned(2).feathers;
    expect(first).toHaveLength(3);
    expect(first.map(item => [item.id, item.x, item.y, item.amount])).toEqual(repeat.map(item => [item.id, item.x, item.y, item.amount]));
    expect(new Set(first.map(item => item.id)).size).toBe(3);
    expect(first.every(item => item.amount === 1)).toBe(true);
    expect(first.map(item => [item.x, item.y])).not.toEqual(otherSeed.map(item => [item.x, item.y]));
    const repeatedX = first.filter(item => first.some(other => other !== item && other.x === item.x));
    expect(repeatedX).toHaveLength(2);
    if (repeatedX.length !== 2) return;
    const tail = repeatedX;
    const nose = first.find(item => item.x !== tail[0]!.x)!;
    expect(tail[0]!.x).toBe(tail[1]!.x);
    expect(Math.abs(tail[0]!.y - tail[1]!.y)).toBeGreaterThan(0);
    expect(Math.abs(nose.x - tail[0]!.x)).toBeGreaterThan(0);
    expect(Math.abs((tail[0]!.x - nose.x) * (tail[1]!.y - nose.y) -
      (tail[1]!.x - nose.x) * (tail[0]!.y - nose.y))).toBeGreaterThan(0);
    expect(first.every(item => item.y - item.radius - state.config.flight.duckHalfHeight > state.config.pipes.ceilingY &&
      item.y + item.radius + state.config.flight.duckHalfHeight < state.config.pipes.floorY)).toBe(true);
    expect(routeSide(state, first)).not.toBe("invalid");

    const samples = Array.from({ length: 12 }, (_, seed) => spawned(seed + 1));
    const orientations = new Set(samples.map(({ feathers }) => feathers[0]!.x < feathers[2]!.x));
    const routeSides = new Set(samples.map(({ state: sampleState, feathers }) => routeSide(sampleState, feathers)));
    expect(routeSides).toEqual(new Set(["inside", "outside"]));
    expect(orientations).toEqual(new Set([true, false]));
  });

  it("keeps each member on the existing individual pickup event path", () => {
    const { state, feathers } = spawned(3);
    const target = feathers[1]!;
    const readyToCollect = { ...state,
      duck: { ...state.duck, x: state.config.flight.duckX, y: target.y, vy: 0 },
      collectibles: state.collectibles.map(item => item.id === target.id
        ? { ...item, x: state.config.flight.duckX + state.config.pipes.speed }
        : { ...item, x: 1_000_000 }),
    };
    const result = step(readyToCollect, []);
    expect(result.events.filter(event => event.type === "CurrencyCollected")).toEqual([
      expect.objectContaining({ collectibleId: target.id, typeId: "FEATHER", amount: 1 }),
    ]);
    expect(result.state.totals.FEATHER).toBe(1);
  });

  it("spawns scheduled GAME_STAR as five individually identified unit pickups within the pipe opening", () => {
    let state = createRun(createRunDescriptor({ runId: "formation-star", seed: 8 }, DEFAULT_CONFIG), DEFAULT_CONFIG);
    state = step(state, [{ sequence: state.nextInputSequence, action: "FLAP" }]).state;
    for (let tick = 0; tick < 5000; tick++) {
      state = { ...state, phase: "RUNNING", duck: { ...state.duck, y: 280_000, vy: 0 } };
      state = step(state, []).state;
      const stars = state.collectibles.filter(item => item.typeId === "GAME_STAR");
      if (stars.length) {
        expect(stars).toHaveLength(5);
        expect(stars.every(item => item.amount === 1)).toBe(true);
        expect(new Set(stars.map(item => item.id)).size).toBe(5);
        const owner = state.pipes.find(pipe => pipe.index === Number(stars[0]!.id.split("-")[1]));
        expect(owner).toBeDefined();
        expect(stars.every(item => item.y - item.radius - state.config.flight.duckHalfHeight > owner!.gapCenter - state.config.pipes.gapHeight / 2 &&
          item.y + item.radius + state.config.flight.duckHalfHeight < owner!.gapCenter + state.config.pipes.gapHeight / 2)).toBe(true);
        return;
      }
    }
    throw new Error("scheduled Star formation did not spawn in 5000 ticks");
  });

  it("varies scheduled Star formation orientation and obstacle side by seed and event", () => {
    const state = createRun(createRunDescriptor({ runId: "star-variation", seed: 1 }, DEFAULT_CONFIG), DEFAULT_CONFIG);
    const pipe = state.pipes.find(item => item.index === 1)!;
    const radius = state.config.collectibles.find(item => item.typeId === "GAME_STAR")!.radius;
    const describe = (seed: number, eventOrdinal: number) => {
      const points = currencyFormationPoints(DEFAULT_CONFIG, seed, pipe, radius, true, eventOrdinal);
      const center = points.reduce((sum, point) => sum + point.x, 0) / points.length;
      const obstacleSide = center < pipe.x ? "left" : center > pipe.x + DEFAULT_CONFIG.pipes.width ? "right" : "inside";
      const orientation = points.map(point => `${Math.round(point.x - center)},${Math.round(point.y - points.reduce((sum, item) => sum + item.y, 0) / points.length)}`).join(";");
      expect(points.every(point => point.y - radius - state.config.flight.duckHalfHeight > pipe.gapCenter - state.config.pipes.gapHeight / 2 &&
        point.y + radius + state.config.flight.duckHalfHeight < pipe.gapCenter + state.config.pipes.gapHeight / 2 &&
        (point.x + radius + state.config.flight.duckHalfWidth < pipe.x ||
          point.x - radius - state.config.flight.duckHalfWidth > pipe.x + state.config.pipes.width))).toBe(true);
      return { obstacleSide, orientation };
    };
    const bySeed = Array.from({ length: 8 }, (_, seed) => describe(seed + 1, 0));
    const byEvent = Array.from({ length: 8 }, (_, eventOrdinal) => describe(1, eventOrdinal));
    for (const variants of [bySeed, byEvent]) {
      expect(new Set(variants.map(item => item.obstacleSide))).toEqual(new Set(["left", "right"]));
      expect(new Set(variants.map(item => item.orientation)).size).toBeGreaterThan(1);
    }
  });

  it("rejects catalog-4 gaps too narrow for safe currency formations", () => {
    const narrow = { ...DEFAULT_CONFIG, pipes: { ...DEFAULT_CONFIG.pipes, gapHeight: 60_000 } };
    expect(() => validateConfig(narrow)).toThrow();
    expect(() => createRun(createRunDescriptor({ runId: "narrow-formation", seed: 2 }), narrow)).toThrow();
  });

  it("rejects FEATHER formations that can intersect the next station's lower pipe", () => {
    const config = {
      ...DEFAULT_CONFIG,
      pipes: { ...DEFAULT_CONFIG.pipes, width: 140_000 },
      collectibles: DEFAULT_CONFIG.collectibles.map(item => item.typeId === "FEATHER" ? { ...item, radius: 50_000 } : item),
      wetland: {
        ...DEFAULT_CONFIG.wetland!,
        families: DEFAULT_CONFIG.wetland!.families.map(family => family.id === "slalom"
          ? { ...family, gapCenters: [280_000, 330_000, 250_000, 320_000] }
          : family),
      },
    };
    const owner = { id: "pipe-113", index: 113, x: 0, gapCenter: 330_000, scored: false,
      stationStep: 1, stationSpacing: 240_000, encounterFamily: "slalom" as const };
    const members = currencyFormationPoints(config, 1, owner, 50_000, false, owner.index);
    const nextStation = { x: 240_000, lowerPipeTop: 328_000 };
    const overlapsNextLowerPipe = members.some(point =>
      point.x + 50_000 + config.flight.duckHalfWidth >= nextStation.x &&
      point.y + 50_000 + config.flight.duckHalfHeight >= nextStation.lowerPipeTop);
    expect(members[0]).toEqual({ x: 238_002, y: expect.any(Number) });
    expect(overlapsNextLowerPipe).toBe(true);
    expect(() => validateConfig(config)).toThrow(/currency formation clearance/);
  });
});
