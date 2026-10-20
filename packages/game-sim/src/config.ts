import { deepFreeze } from "./internal.js";
import { DEFAULT_CONFIG_ID, GENERATOR_VERSION, PAIRED_ROUTES_CONFIG_ID, PAIRED_ROUTES_GENERATOR_VERSION, PAIRED_ROUTES_SIMULATION_VERSION, LEGACY_DEFAULT_CONFIG_ID, LEGACY_GENERATOR_VERSION, LEGACY_SIMULATION_VERSION, PRIOR_DEFAULT_CONFIG_ID, PRIOR_GENERATOR_VERSION, PRIOR_SIMULATION_VERSION, SIMULATION_VERSION, VARIED_OBSTACLE_DEFAULT_CONFIG_ID, VARIED_OBSTACLE_GENERATOR_VERSION, VARIED_OBSTACLE_SIMULATION_VERSION, WETLAND_DEFAULT_CONFIG_ID, WETLAND_GENERATOR_VERSION, WETLAND_SIMULATION_VERSION, type FlightConfig, type GameConfig, type GapPattern, type PipeConfig, type RunDescriptor } from "./types.js";

export const PATTERN_CATALOG: readonly GapPattern[] = deepFreeze([
  { id: "center", gaps: [280000, 280000, 280000, 280000] },
  { id: "rise-fall", gaps: [260000, 280000, 300000, 280000] },
  { id: "fall-rise", gaps: [300000, 280000, 260000, 280000] },
]);

export const LEGACY_DEFAULT_CONFIG: GameConfig = deepFreeze({
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
export const PRIOR_DEFAULT_CONFIG: GameConfig = deepFreeze({
  ...LEGACY_DEFAULT_CONFIG,
  limits: { ...LEGACY_DEFAULT_CONFIG.limits, maxActiveCollectibles: 3 },
  collectibles: LEGACY_DEFAULT_CONFIG.collectibles.map(definition =>
    definition.typeId === "GAME_STAR" ? { ...definition, weight: 0 } : definition,
  ),
  spawnNoneWeight: 66,
  starSchedule: {
    minIntervalPipes: 8,
    maxIntervalPipes: 16,
  },
});
export const WETLAND_DEFAULT_CONFIG: GameConfig = deepFreeze({
  ...PRIOR_DEFAULT_CONFIG,
  limits: { ...PRIOR_DEFAULT_CONFIG.limits, maxActiveCollectibles: 10 },
  challenges: null,
  wetland: {
    catalogVersion: 1,
    stationSpacing: [240000, 300000, 360000],
    recoverySpacing: 360000,
    starRoute: { xOffset: 100000, yOffset: 70000 },
    introFamilies: ["steady", "quick-pairs"],
    pressureFamilies: ["dive-climb", "climb-dive", "slalom"],
    families: [
      { id: "steady", gapCenters: [280000, 280000, 280000, 250000], obstacleTypes: ["pipes", "vine", "rock", "debris"], stationSpacing: [300000, 300000, 300000, 300000], rewardRoute: [{ xOffset: -16000, yOffset: 0 }, { xOffset: 16000, yOffset: 18000 }, { xOffset: -16000, yOffset: 18000 }, { xOffset: 16000, yOffset: 68000 }] },
      { id: "quick-pairs", gapCenters: [280000, 280000, 280000, 280000], obstacleTypes: ["pipes", "pipes", "vine", "vine"], stationSpacing: [240000, 240000, 360000, 360000], rewardRoute: [{ xOffset: 16000, yOffset: 0 }, { xOffset: -16000, yOffset: -18000 }, { xOffset: 16000, yOffset: 18000 }, { xOffset: -16000, yOffset: 0 }] },
      { id: "dive-climb", gapCenters: [300000, 330000, 260000, 230000], obstacleTypes: ["rock", "debris", "vine", "pipes"], stationSpacing: [300000, 360000, 300000, 240000], rewardRoute: [{ xOffset: -16000, yOffset: -18000 }, { xOffset: 16000, yOffset: -68000 }, { xOffset: -16000, yOffset: 18000 }, { xOffset: 16000, yOffset: 0 }] },
      { id: "climb-dive", gapCenters: [260000, 230000, 300000, 330000], obstacleTypes: ["vine", "debris", "pipes", "rock"], stationSpacing: [300000, 360000, 300000, 240000], rewardRoute: [{ xOffset: 16000, yOffset: 18000 }, { xOffset: -16000, yOffset: 68000 }, { xOffset: 16000, yOffset: -18000 }, { xOffset: -16000, yOffset: 0 }] },
      { id: "slalom", gapCenters: [280000, 330000, 260000, 320000], obstacleTypes: ["vine", "pipes", "rock", "debris"], stationSpacing: [300000, 240000, 360000, 300000], rewardRoute: [{ xOffset: -16000, yOffset: 0 }, { xOffset: 16000, yOffset: -18000 }, { xOffset: -16000, yOffset: 18000 }, { xOffset: 16000, yOffset: -68000 }] },
    ],
  },
});
export const VARIED_OBSTACLE_DEFAULT_CONFIG: GameConfig = deepFreeze({
  ...WETLAND_DEFAULT_CONFIG,
  pipes: {
    ...WETLAND_DEFAULT_CONFIG.pipes,
    gapMinCenter: 78_000,
    gapMaxCenter: 483_000,
    maxGapDelta: 120_000,
  },
  wetland: {
    ...WETLAND_DEFAULT_CONFIG.wetland!,
    catalogVersion: 2,
    geometry: {
      halfPipeMinPercent: 70,
      halfPipeMaxPercent: 90,
      floatingBarMinWidth: 90_000,
      floatingBarMaxWidth: 216_000,
      floatingBarHeight: 42_000,
    },
    introLaneCenters: [280_000, 340_000, 400_000, 483_000],
    families: WETLAND_DEFAULT_CONFIG.wetland!.families.map(family => ({
      ...family,
      gapCenters: [480_000, 480_000, 480_000, 480_000],
      ...(family.id === "steady" ? { obstacleTypes: ["pipes", "pipes", "pipes", "pipes"] } : {}),
    })),
  },
});
export const PAIRED_ROUTES_DEFAULT_CONFIG: GameConfig = deepFreeze({
  ...WETLAND_DEFAULT_CONFIG,
  wetland: {
    ...WETLAND_DEFAULT_CONFIG.wetland!,
    catalogVersion: 3,
    starRoute: { ...WETLAND_DEFAULT_CONFIG.wetland!.starRoute, yOffset: 35_000 },
    families: WETLAND_DEFAULT_CONFIG.wetland!.families.map(family => ({
      ...family,
      obstacleTypes: ["pipes", "pipes", "pipes", "pipes"],
    })),
  },
});
export const DEFAULT_CONFIG: GameConfig = deepFreeze({
  ...PAIRED_ROUTES_DEFAULT_CONFIG,
  limits: { ...PAIRED_ROUTES_DEFAULT_CONFIG.limits, maxActiveCollectibles: 29 },
  wetland: { ...PAIRED_ROUTES_DEFAULT_CONFIG.wetland!, catalogVersion: 4 },
});
const integer = (v: unknown): v is number => Number.isSafeInteger(v);
function variedRecoveryCentersValid(p: PipeConfig): boolean {
  const offset = p.gapMinCenter - 78_000;
  return [[100_000, 220_000, 340_000, 460_000], [430_000, 310_000, 190_000, 78_000]].every(recipe =>
    recipe.map(center => center + offset).every((center, index, centers) =>
      center >= p.gapMinCenter && center <= p.gapMaxCenter &&
      (index === 0 || Math.abs(center - centers[index - 1]!) <= p.maxGapDelta)));
}
function wetlandResolvedY(c: GameConfig, center: number, obstacleType: string, offset: number, radius: number): number {
  if (obstacleType === "debris") {
    const clearance = 21000 + c.flight.duckHalfHeight + 1;
    const minY = c.pipes.ceilingY + c.flight.duckHalfHeight;
    const maxY = c.pipes.floorY - c.flight.duckHalfHeight;
    const upperReach = center - minY;
    const lowerReach = maxY - center;
    let direction = Math.sign(offset);
    if (direction > 0 && lowerReach < clearance) direction = -1;
    if (direction < 0 && upperReach < clearance) direction = 1;
    const reach = direction > 0 ? lowerReach : upperReach;
    return center + direction * Math.max(clearance, Math.min(Math.abs(offset), reach));
  }
  const openingOffset = Math.floor(c.pipes.gapHeight / 2) - c.flight.duckHalfHeight - radius - 2;
  return center + Math.sign(offset) * Math.min(Math.abs(offset), openingOffset);
}
function wetlandObstacles(c: GameConfig, center: number, type: string): { x: number; y: number; width: number; height: number }[] {
  const { pipes } = c;
  const top = center - Math.floor(pipes.gapHeight / 2);
  const bottom = center + Math.floor(pipes.gapHeight / 2);
  if (type === "pipes") return [
    { x: 0, y: pipes.ceilingY, width: pipes.width, height: top - pipes.ceilingY },
    { x: 0, y: bottom, width: pipes.width, height: pipes.floorY - bottom },
  ];
  if (type === "vine") return [{ x: 0, y: pipes.ceilingY, width: pipes.width, height: top - pipes.ceilingY }];
  if (type === "rock") return [{ x: 0, y: bottom, width: pipes.width, height: pipes.floorY - bottom }];
  return [{ x: 0, y: center - 21000, width: pipes.width, height: 42000 }];
}
function validWetlandRoutePoint(point: { xOffset: number; yOffset: number }, star = false): boolean {
  return Number.isSafeInteger(point.xOffset) && Number.isSafeInteger(point.yOffset) &&
    (star ? point.xOffset > 0 && point.xOffset <= 120_000 && point.yOffset > 0 && point.yOffset <= 70_000
      : point.xOffset !== 0 && Math.abs(point.xOffset) <= 120_000 && Math.abs(point.yOffset) <= 70_000);
}
function validateWetlandRoute(c: GameConfig, center: number, type: string, point: { xOffset: number; yOffset: number }, radius: number, star = false): boolean {
  if (!Number.isSafeInteger(point.xOffset) || !Number.isSafeInteger(point.yOffset) ||
      (star ? point.xOffset <= 0 || point.xOffset > 120000 || point.yOffset <= 0 || point.yOffset > 70000
        : point.xOffset === 0 || Math.abs(point.xOffset) > 120000 || Math.abs(point.yOffset) > 70000)) return false;
  const y = wetlandResolvedY(c, center, type, point.yOffset, radius);
  const { flight, pipes } = c;
  if (y <= pipes.ceilingY + flight.duckHalfHeight || y >= pipes.floorY - flight.duckHalfHeight) return false;
  return wetlandObstacles(c, center, type).every(obstacle => {
    const overlapsX = Math.abs(point.xOffset - obstacle.x) <= flight.duckHalfWidth + Math.floor(obstacle.width / 2);
    const overlapsY = y + flight.duckHalfHeight >= obstacle.y && y - flight.duckHalfHeight <= obstacle.y + obstacle.height;
    return !overlapsX || !overlapsY;
  });
}
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
  if (c.starSchedule !== undefined && c.starSchedule !== null) {
    const schedule = c.starSchedule;
    const starDefinition = c.collectibles.find(definition => definition.typeId === "GAME_STAR");
    const stationMinSpacing = c.wetland?.stationSpacing ? Math.min(...c.wetland.stationSpacing) : p.spacing;
    if (!integer(schedule.minIntervalPipes) || schedule.minIntervalPipes < 8 ||
        !integer(schedule.maxIntervalPipes) || schedule.maxIntervalPipes < schedule.minIntervalPipes ||
        schedule.maxIntervalPipes > 16 || !starDefinition || starDefinition.weight !== 0 ||
        c.limits.maxActiveCollectibles < 3 ||
        !Number.isSafeInteger(stationMinSpacing * schedule.minIntervalPipes) ||
        stationMinSpacing * schedule.minIntervalPipes <= p.horizon + (starDefinition?.radius ?? 0) + p.maxSpeed)
      throw Error("invalid scheduled Star capacity or interval geometry");
  }
  if (c.wetland != null && c.challenges != null) throw Error("wetland and legacy challenge modes are mutually exclusive");
  if (c.wetland != null && (![1, 2, 3, 4].includes(c.wetland.catalogVersion) || c.wetland.recoverySpacing !== 360000 || !Array.isArray(c.wetland.stationSpacing) ||
      c.wetland.stationSpacing.length !== 3 || c.wetland.stationSpacing.some(value => !integer(value) || value <= 0) ||
      !Array.isArray(c.wetland.introFamilies) || c.wetland.introFamilies.join(",") !== "steady,quick-pairs" ||
      !Array.isArray(c.wetland.pressureFamilies) || c.wetland.pressureFamilies.join(",") !== "dive-climb,climb-dive,slalom" ||
      !Array.isArray(c.wetland.families) || c.wetland.families.length !== 5 ||
      c.wetland.stationSpacing.join(",") !== "240000,300000,360000" ||
      !c.wetland.starRoute || !Number.isSafeInteger(c.wetland.starRoute.xOffset) || !Number.isSafeInteger(c.wetland.starRoute.yOffset) ||
      (c.wetland.catalogVersion === 1 && c.wetland.geometry !== undefined) ||
      (c.wetland.catalogVersion === 1 && c.wetland.introLaneCenters !== undefined) ||
      ([3, 4].includes(c.wetland.catalogVersion) && (c.wetland.geometry !== undefined || c.wetland.introLaneCenters !== undefined)) ||
      (c.wetland.catalogVersion === 2 && (!c.wetland.geometry || !integer(c.wetland.geometry.halfPipeMinPercent) || c.wetland.geometry.halfPipeMinPercent < 70 || c.wetland.geometry.halfPipeMinPercent > 88 ||
        !integer(c.wetland.geometry.halfPipeMaxPercent) || c.wetland.geometry.halfPipeMaxPercent < c.wetland.geometry.halfPipeMinPercent || c.wetland.geometry.halfPipeMaxPercent > 90 ||
        c.wetland.geometry.floatingBarMinWidth !== 90_000 || c.wetland.geometry.floatingBarMaxWidth !== 216_000 || c.wetland.geometry.floatingBarHeight !== 42_000 ||
        !variedRecoveryCentersValid(p) ||
        !Array.isArray(c.wetland.introLaneCenters) || c.wetland.introLaneCenters.length !== 4 ||
        c.wetland.introLaneCenters.some(center => !integer(center) || center < p.gapMinCenter || center > p.gapMaxCenter) ||
        c.wetland.introLaneCenters.some((center, index) => index > 0 && Math.abs(center - c.wetland!.introLaneCenters![index - 1]!) > p.maxGapDelta))) ||
      c.wetland.families.some(family => family.gapCenters.length !== 4 || family.obstacleTypes.length !== 4 || family.stationSpacing.length !== 4 || family.rewardRoute.length !== 4 ||
        family.gapCenters.some((center: number) => !integer(center) || center < p.gapMinCenter || center > p.gapMaxCenter) ||
        (c.wetland!.catalogVersion >= 3 && family.gapCenters.some((center: number) =>
          center - Math.floor(p.gapHeight / 2) <= p.ceilingY || center + Math.floor(p.gapHeight / 2) >= p.floorY)) ||
        family.rewardRoute.some((point: { xOffset: number; yOffset: number }, index: number) => c.wetland!.catalogVersion === 2
          ? !validWetlandRoutePoint(point)
          : !validateWetlandRoute(c, family.gapCenters[index]!, family.obstacleTypes[index]!, point, c.collectibles.find(item => item.typeId === "FEATHER")?.radius ?? 0)) ||
        family.obstacleTypes.some((type: string, index: number) => c.wetland!.catalogVersion === 2
          ? !validWetlandRoutePoint(c.wetland!.starRoute, true)
          : !validateWetlandRoute(c, family.gapCenters[index]!, type, c.wetland!.starRoute, c.collectibles.find(item => item.typeId === "GAME_STAR")?.radius ?? 0, true)) ||
        family.obstacleTypes.some((type: string) => !["pipes", "vine", "rock", "debris"].includes(type)) ||
        (c.wetland!.catalogVersion >= 3 && family.obstacleTypes.some((type: string) => type !== "pipes")) ||
        family.stationSpacing.some((spacing: number) => !integer(spacing) || !c.wetland!.stationSpacing.includes(spacing)) ||
        family.gapCenters.some((center: number, index: number) => index > 0 && Math.abs(center - family.gapCenters[index - 1]!) > p.maxGapDelta)) || c.limits.maxActiveCollectibles < 10))
    throw Error("invalid wetland encounter catalog");
  if (c.wetland != null) {
    if (c.wetland.catalogVersion === 4) {
      const featherRadius = c.collectibles.find(item => item.typeId === "FEATHER")?.radius ?? 0;
      const starRadius = c.collectibles.find(item => item.typeId === "GAME_STAR")?.radius ?? 0;
      const starHalfOpening = Math.floor(c.pipes.gapHeight / 2) - c.flight.duckHalfHeight - starRadius - 2;
      const featherHalfOpening = Math.floor(c.pipes.gapHeight / 2) - c.flight.duckHalfHeight - featherRadius - 2;
      const minWetlandSpacing = Math.min(...c.wetland.stationSpacing);
      const starSideClearance = 44_000 + 2 * c.flight.duckHalfWidth + 2 * starRadius + 2;
      const starLeftBound = 44_000 + c.flight.duckHalfWidth + starRadius + 2;
      const featherSideClearance = 36_000 + 2 * c.flight.duckHalfWidth + 2 * featherRadius + 2;
      if (starHalfOpening < 22_000 || featherHalfOpening < 15_000 ||
          minWetlandSpacing - c.pipes.width < starSideClearance ||
          minWetlandSpacing - c.pipes.width < featherSideClearance || c.pipes.safeLeadIn < starLeftBound)
        throw Error("invalid currency formation clearance");
    }
    const families = new Map(c.wetland.families.map(family => [family.id, family]));
    const intro = c.wetland.introFamilies.map(id => families.get(id));
    const pressure = c.wetland.pressureFamilies.map(id => families.get(id));
    const recovery = families.get("steady");
    const requiredObstacleTypes = new Set(c.wetland.families.flatMap(family => family.obstacleTypes));
    const requiredCollectibleCapacity = c.wetland.catalogVersion === 4
      ? c.limits.maxActivePipes * 3 + (c.starSchedule ? 5 : 0)
      : c.limits.maxActivePipes + (c.starSchedule ? 1 : 0);
    if (new Set(c.wetland.families.map(family => family.id)).size !== 5 ||
        c.wetland.families.map(family => family.id).sort().join(",") !== "climb-dive,dive-climb,quick-pairs,slalom,steady" ||
        (c.wetland.catalogVersion < 3 && !["pipes", "vine", "rock", "debris"].every(type => requiredObstacleTypes.has(type as "pipes" | "vine" | "rock" | "debris"))) ||
        !Number.isSafeInteger(requiredCollectibleCapacity) || c.limits.maxActiveCollectibles < requiredCollectibleCapacity || !recovery ||
        !c.collectibles.some(item => item.typeId === "FEATHER") ||
        [...intro, ...pressure].some(family => !family) ||
        intro.some((family, index) => index > 0 && Math.abs(family!.gapCenters[0]! - intro[index - 1]!.gapCenters[3]!) > p.maxGapDelta) ||
        pressure.some(family => Math.abs(family!.gapCenters[0]! - intro[intro.length - 1]!.gapCenters[3]!) > p.maxGapDelta) ||
        pressure.some(from => pressure.some(to => from !== to && Math.abs(to!.gapCenters[0]! - from!.gapCenters[3]!) > p.maxGapDelta)) ||
        pressure.some(family => Math.abs(recovery.gapCenters[0]! - family!.gapCenters[3]!) > p.maxGapDelta || Math.abs(family!.gapCenters[0]! - recovery.gapCenters[3]!) > p.maxGapDelta))
      throw Error("wetland family boundary exceeds gap delta");
  }
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
  const supportedRules =
    (d?.simulationVersion === SIMULATION_VERSION && d?.generatorVersion === GENERATOR_VERSION) ||
    (d?.simulationVersion === PAIRED_ROUTES_SIMULATION_VERSION && d?.generatorVersion === PAIRED_ROUTES_GENERATOR_VERSION) ||
    (d?.simulationVersion === VARIED_OBSTACLE_SIMULATION_VERSION && d?.generatorVersion === VARIED_OBSTACLE_GENERATOR_VERSION) ||
    (d?.simulationVersion === PRIOR_SIMULATION_VERSION && d?.generatorVersion === PRIOR_GENERATOR_VERSION) ||
    (d?.simulationVersion === LEGACY_SIMULATION_VERSION && d?.generatorVersion === LEGACY_GENERATOR_VERSION) ||
    (d?.simulationVersion === WETLAND_SIMULATION_VERSION && d?.generatorVersion === WETLAND_GENERATOR_VERSION);
  const supportedConfig = d?.configId === DEFAULT_CONFIG_ID || d?.configId === PAIRED_ROUTES_CONFIG_ID ||
    d?.configId === VARIED_OBSTACLE_DEFAULT_CONFIG_ID ||
    d?.configId === PRIOR_DEFAULT_CONFIG_ID ||
    d?.configId === WETLAND_DEFAULT_CONFIG_ID ||
    d?.configId === LEGACY_DEFAULT_CONFIG_ID ||
    (typeof d?.configId === "string" && d.configId.startsWith("dd-v1-config:") && d.configId.length > "dd-v1-config:".length);
  if (
    !d ||
    typeof d.runId !== "string" ||
    !d.runId.trim() ||
    !integer(d.seed) ||
    d.seed < 0 ||
    d.seed > 0xffffffff ||
    !supportedRules ||
    !supportedConfig ||
    (d.configId === DEFAULT_CONFIG_ID && d.simulationVersion !== SIMULATION_VERSION) ||
    (d.configId === PAIRED_ROUTES_CONFIG_ID && d.simulationVersion !== PAIRED_ROUTES_SIMULATION_VERSION) ||
    (d.configId === VARIED_OBSTACLE_DEFAULT_CONFIG_ID && d.simulationVersion !== VARIED_OBSTACLE_SIMULATION_VERSION) ||
    (d.configId === PRIOR_DEFAULT_CONFIG_ID && d.simulationVersion !== PRIOR_SIMULATION_VERSION) ||
    (d.configId === WETLAND_DEFAULT_CONFIG_ID && d.simulationVersion !== WETLAND_SIMULATION_VERSION) ||
    (d.configId === LEGACY_DEFAULT_CONFIG_ID && d.simulationVersion !== LEGACY_SIMULATION_VERSION)
  )
    throw Error(
      "invalid descriptor, seed, config ID, or unsupported simulation version or generator version",
    );
  return d;
}
