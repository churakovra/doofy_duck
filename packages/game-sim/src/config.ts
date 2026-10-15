import { deepFreeze } from "./internal.js";
import { GENERATOR_VERSION, SIMULATION_VERSION, type FlightConfig, type GameConfig, type GapPattern, type PipeConfig, type RunDescriptor } from "./types.js";

export const PATTERN_CATALOG: readonly GapPattern[] = deepFreeze([
  { id: "center", gaps: [280000, 280000, 280000, 280000] },
  { id: "rise-fall", gaps: [260000, 280000, 300000, 280000] },
  { id: "fall-rise", gaps: [300000, 280000, 260000, 280000] },
]);

export const DEFAULT_CONFIG: GameConfig = deepFreeze({
  flight: {
    gravity: 320,
    flapVelocity: -5600,
    maxFallSpeed: 8500,
    duckX: 100000,
    duckHalfWidth: 12000,
    duckHalfHeight: 10000,
  },
  pipes: {
    speed: 3000,
    maxSpeed: 5800,
    rampTicks: 2700,
    speedEveryPipes: 10,
    speedStepPercent: 10,
    gapMinCenter: 160000,
    gapMaxCenter: 400000,
    maxGapDelta: 85000,
    spacing: 225000,
    width: 52000,
    gapHeight: 156000,
    safeLeadIn: 420000,
    horizon: 960000,
    floorY: 561000,
    ceilingY: 0,
  },
  limits: { maxActivePipes: 8, maxActiveCollectibles: 2 },
  collectibles: [
    {
      typeId: "FEATHER",
      version: 1,
      weight: 34,
      minPipeIndex: 1,
      minSpacingPipes: 1,
      amount: 1,
      radius: 7000,
      appearance: "feather-v1",
    },
    {
      typeId: "GAME_STAR",
      version: 1,
      weight: 8,
      minPipeIndex: 4,
      minSpacingPipes: 3,
      amount: 1,
      radius: 7000,
      appearance: "game-star-v1",
    },
  ],
  spawnNoneWeight: 58,
});
const integer = (v: unknown): v is number => Number.isSafeInteger(v);
export function validateConfig(c: GameConfig): GameConfig {
  const f = c?.flight,
    p = c?.pipes;
  if (!f || typeof f !== "object") throw Error("flight config is required");
  if (!p || typeof p !== "object") throw Error("pipe config is required");
  if (!c.limits || !Array.isArray(c.collectibles))
    throw Error("limits and collectible definitions are required");
  if (
    !integer(f.duckHalfWidth) ||
    f.duckHalfWidth <= 0 ||
    !integer(f.duckHalfHeight) ||
    f.duckHalfHeight <= 0
  )
    throw Error("duck geometry extents must be positive integers");
  if (!integer(f.gravity) || f.gravity <= 0)
    throw Error("gravity must be a positive safe integer");
  if (!integer(f.flapVelocity) || f.flapVelocity >= 0)
    throw Error("flapVelocity must be a negative safe integer");
  if (
    !integer(f.maxFallSpeed) ||
    f.maxFallSpeed <= 0 ||
    Math.abs(f.flapVelocity) > f.maxFallSpeed
  )
    throw Error("maxFallSpeed must bound flight velocity");
  for (const k of Object.keys(DEFAULT_CONFIG.flight) as (keyof FlightConfig)[])
    if (!integer(f[k]) || Math.abs(f[k]) > 10000000)
      throw Error(`invalid flight ${k}`);
  for (const k of Object.keys(DEFAULT_CONFIG.pipes) as (keyof PipeConfig)[])
    if (!integer(p[k]) || Math.abs(p[k]) > 10000000)
      throw Error(`invalid pipes ${k}`);
  if (
    p.speed <= 0 ||
    p.maxSpeed < p.speed ||
    p.rampTicks <= 0 ||
    (p.maxSpeed - p.speed) * p.rampTicks > Number.MAX_SAFE_INTEGER ||
    p.speedEveryPipes <= 0 || p.speedStepPercent < 0 ||
    p.gapMinCenter > p.gapMaxCenter || p.maxGapDelta <= 0 ||
    p.gapMinCenter - Math.floor(p.gapHeight / 2) < p.ceilingY ||
    p.gapMaxCenter + Math.floor(p.gapHeight / 2) > p.floorY ||
    p.spacing <= 0 ||
    p.width < p.maxSpeed ||
    p.width <= 0 ||
    p.gapHeight <= 2 * f.duckHalfHeight ||
    p.horizon < p.safeLeadIn ||
    p.floorY <= p.ceilingY + p.gapHeight
  )
    throw Error("invalid pipe geometry");
  if (
    !integer(c.limits.maxActivePipes) ||
    c.limits.maxActivePipes < 2 ||
    !integer(c.limits.maxActiveCollectibles) ||
    c.limits.maxActiveCollectibles < 0
  )
    throw Error("invalid runtime limits");
  if (!integer(c.spawnNoneWeight) || c.spawnNoneWeight < 0)
    throw Error("invalid no-item weight");
  const ids = new Set<string>();
  for (const d of c.collectibles) {
    if (
      typeof d.typeId !== "string" ||
      !d.typeId ||
      ids.has(d.typeId) ||
      !integer(d.version) ||
      d.version < 1 ||
      !integer(d.weight) ||
      d.weight < 0 ||
      !integer(d.minPipeIndex) ||
      d.minPipeIndex < 0 ||
      !integer(d.minSpacingPipes) ||
      d.minSpacingPipes < 0 ||
      !integer(d.amount) ||
      d.amount <= 0 ||
      !integer(d.radius) ||
      d.radius <= 0 ||
      d.radius >= Math.floor(p.gapHeight / 2) ||
      d.radius + f.duckHalfHeight + 2 >= Math.floor(p.gapHeight / 2) ||
      typeof d.appearance !== "string" ||
      !d.appearance
    )
      throw Error("invalid collectible definition");
    ids.add(d.typeId);
  }
  const configuredWeight =
    c.spawnNoneWeight + c.collectibles.reduce((total, definition) => total + definition.weight, 0);
  if (!Number.isSafeInteger(configuredWeight) || configuredWeight <= 0)
    throw Error("spawn table must have a positive safe-integer total weight");
  return c;
}
export function validateDescriptor(d: RunDescriptor): RunDescriptor {
  if (
    !d ||
    typeof d.runId !== "string" ||
    !d.runId.trim() ||
    !integer(d.seed) ||
    d.seed < 0 ||
    d.seed > 0xffffffff ||
    d.simulationVersion !== SIMULATION_VERSION ||
    d.generatorVersion !== GENERATOR_VERSION ||
    !d.configId
  )
    throw Error(
      "invalid descriptor, seed, or unsupported simulation version or generator version",
    );
  return d;
}
