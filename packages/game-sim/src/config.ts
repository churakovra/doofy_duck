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
    maxSpeed: 4800,
    rampTicks: 2700,
    speedEveryPipes: 10,
    speedStepPercent: 10,
    gapMinCenter: 160000,
    gapMaxCenter: 400000,
    maxGapDelta: 85000,
    spacing: 300000,
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
  challenges: {
    pipesPerFamily: 4,
    introFamilyId: "intro-steady",
    cruiseFamilyIds: ["cruise-steady", "cruise-rise", "cruise-dip", "cruise-offset"],
    pressureFamilyIds: ["pressure-rise", "pressure-dip", "pressure-offset"],
    recoveryFamilyId: "recovery-steady",
    families: [
      { id: "intro-steady", band: "intro", gapCenters: [280000, 280000, 280000, 280000] },
      { id: "cruise-steady", band: "cruise", gapCenters: [280000, 280000, 280000, 280000] },
      { id: "cruise-rise", band: "cruise", gapCenters: [265000, 275000, 290000, 305000] },
      { id: "cruise-dip", band: "cruise", gapCenters: [295000, 285000, 270000, 255000] },
      { id: "cruise-offset", band: "cruise", gapCenters: [300000, 300000, 270000, 270000] },
      { id: "pressure-rise", band: "pressure", gapCenters: [280000, 230000, 190000, 270000] },
      { id: "pressure-dip", band: "pressure", gapCenters: [280000, 320000, 350000, 280000] },
      { id: "pressure-offset", band: "pressure", gapCenters: [280000, 330000, 300000, 220000] },
      { id: "recovery-steady", band: "recovery", gapCenters: [280000, 280000, 280000, 280000] },
    ],
  },
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
  if (c.challenges !== undefined && c.challenges !== null) {
    const set = c.challenges;
    if (!integer(set.pipesPerFamily) || set.pipesPerFamily < 1 || set.pipesPerFamily > 16 ||
        !Array.isArray(set.cruiseFamilyIds) || set.cruiseFamilyIds.length < 2 ||
        !Array.isArray(set.pressureFamilyIds) || set.pressureFamilyIds.length < 1 ||
        !Array.isArray(set.families)) throw Error("invalid challenge set");
    const families = new Map<string, (typeof set.families)[number]>();
    for (const family of set.families) {
      if (!family.id.trim() || families.has(family.id) || !["intro", "cruise", "pressure", "recovery"].includes(family.band) ||
          family.gapCenters.length !== set.pipesPerFamily || family.gapCenters.some((center: number) =>
            !integer(center) || center < p.gapMinCenter || center > p.gapMaxCenter ||
            center - Math.floor(p.gapHeight / 2) < p.ceilingY || center + Math.floor(p.gapHeight / 2) > p.floorY))
        throw Error("invalid challenge family geometry");
      for (let i = 1; i < family.gapCenters.length; i++)
        if (Math.abs(family.gapCenters[i]! - family.gapCenters[i - 1]!) > p.maxGapDelta)
          throw Error("challenge family exceeds gap delta");
      families.set(family.id, family);
    }
    const hasBand = (id: string, band: string) => families.get(id)?.band === band;
    if (!hasBand(set.introFamilyId, "intro") || !hasBand(set.recoveryFamilyId, "recovery") ||
        set.cruiseFamilyIds.some(id => !hasBand(id, "cruise")) ||
        set.pressureFamilyIds.some(id => !hasBand(id, "pressure")))
      throw Error("challenge family references have invalid bands");
    const references = [set.introFamilyId, set.recoveryFamilyId, ...set.cruiseFamilyIds, ...set.pressureFamilyIds];
    if (new Set(set.cruiseFamilyIds).size !== set.cruiseFamilyIds.length ||
        new Set(set.pressureFamilyIds).size !== set.pressureFamilyIds.length ||
        references.some(id => typeof id !== "string" || !id.trim()))
      throw Error("challenge family references must be unique nonempty IDs");
    const family = (id: string) => families.get(id)!;
    const midpoint = Math.floor((p.gapMinCenter + p.gapMaxCenter) / 2);
    const introFirst = family(set.introFamilyId).gapCenters[0]!;
    if (introFirst < Math.max(p.gapMinCenter, midpoint - 35000) || introFirst > Math.min(p.gapMaxCenter, midpoint + 35000))
      throw Error("intro lead-in geometry must honor the initial gap bound");
    const checkBoundaries = (fromFamilies: readonly (typeof set.families)[number][], toFamilies: readonly (typeof set.families)[number][]) => {
      for (const from of fromFamilies) for (const to of toFamilies)
        if (Math.abs(to.gapCenters[0]! - from.gapCenters[set.pipesPerFamily - 1]!) > p.maxGapDelta)
          throw Error("challenge family boundary exceeds gap delta");
    };
    const cruise = set.cruiseFamilyIds.map(family);
    const pressure = set.pressureFamilyIds.map(family);
    checkBoundaries([family(set.introFamilyId)], cruise);
    for (let i = 0; i < cruise.length; i++)
      checkBoundaries([cruise[i]!], [cruise[(i + 1) % cruise.length]!, ...pressure]);
    checkBoundaries(pressure, [family(set.recoveryFamilyId)]);
    checkBoundaries([family(set.recoveryFamilyId)], pressure);
  }
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
