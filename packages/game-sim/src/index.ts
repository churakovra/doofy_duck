export type Phase = "READY" | "RUNNING" | "PAUSED" | "DEAD";
export type Action = "FLAP";
export interface RunDescriptor {
  readonly runId: string;
  readonly seed: number;
  readonly simulationVersion: string;
  readonly generatorVersion: string;
  readonly configId: string;
}
export interface InputFrame {
  readonly sequence: number;
  readonly action: Action;
}
export interface FlightConfig {
  readonly gravity: number;
  readonly flapVelocity: number;
  readonly maxFallSpeed: number;
  readonly duckX: number;
  readonly duckHalfWidth: number;
  readonly duckHalfHeight: number;
}
export interface PipeConfig {
  readonly speed: number;
  readonly maxSpeed: number;
  readonly rampTicks: number;
  readonly spacing: number;
  readonly width: number;
  readonly gapHeight: number;
  readonly safeLeadIn: number;
  readonly horizon: number;
  readonly floorY: number;
  readonly ceilingY: number;
}
export interface LimitsConfig {
  readonly maxActivePipes: number;
  readonly maxActiveCollectibles: number;
}
export interface CollectibleDefinition {
  readonly typeId: string;
  readonly version: number;
  readonly weight: number;
  readonly minPipeIndex: number;
  readonly minSpacingPipes: number;
  readonly amount: number;
  readonly radius: number;
  readonly appearance: string;
}
export interface GameConfig {
  readonly flight: FlightConfig;
  readonly pipes: PipeConfig;
  readonly limits: LimitsConfig;
  readonly collectibles: readonly CollectibleDefinition[];
  readonly spawnNoneWeight: number;
}
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>))
      freeze(child);
  }
  return value;
};
export interface GapPattern {
  readonly id: string;
  readonly gaps: readonly number[];
}

/** Finite authored v1 sequences repeat in catalog order. */
export const PATTERN_CATALOG: readonly GapPattern[] = freeze([
  { id: "center", gaps: [280000, 280000, 280000, 280000] },
  { id: "rise-fall", gaps: [260000, 280000, 300000, 280000] },
  { id: "fall-rise", gaps: [300000, 280000, 260000, 280000] },
]);

export const DEFAULT_CONFIG: GameConfig = freeze({
  flight: {
    gravity: 80,
    flapVelocity: -4200,
    maxFallSpeed: 6000,
    duckX: 160000,
    duckHalfWidth: 12000,
    duckHalfHeight: 10000,
  },
  pipes: {
    speed: 2400,
    maxSpeed: 4800,
    rampTicks: 5400,
    spacing: 220000,
    width: 52000,
    gapHeight: 176000,
    safeLeadIn: 420000,
    horizon: 960000,
    floorY: 580000,
    ceilingY: 0,
  },
  limits: { maxActivePipes: 8, maxActiveCollectibles: 2 },
  collectibles: [
    {
      typeId: "FEATHER",
      version: 1,
      weight: 18,
      minPipeIndex: 2,
      minSpacingPipes: 3,
      amount: 1,
      radius: 7000,
      appearance: "feather-v1",
    },
    {
      typeId: "GAME_STAR",
      version: 1,
      weight: 4,
      minPipeIndex: 5,
      minSpacingPipes: 5,
      amount: 1,
      radius: 7000,
      appearance: "game-star-v1",
    },
  ],
  spawnNoneWeight: 78,
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
    p.spacing <= 0 ||
    p.width < p.maxSpeed ||
    p.width <= 0 ||
    p.gapHeight <= 2 * f.duckHalfHeight ||
    p.horizon < p.safeLeadIn ||
    p.floorY <= p.ceilingY + p.gapHeight ||
    PATTERN_CATALOG.some((pattern) =>
      pattern.gaps.some(
        (center) =>
          center - Math.floor(p.gapHeight / 2) < p.ceilingY ||
          center + Math.floor(p.gapHeight / 2) > p.floorY,
      ),
    )
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
    d.simulationVersion !== "1.1.0" ||
    d.generatorVersion !== "1.0.0" ||
    !d.configId
  )
    throw Error(
      "invalid descriptor, seed, or unsupported simulation version or generator version",
    );
  return d;
}
// MurmurHash3 32-bit finalizer. Multiplications wrap modulo 2^32.
export function mix32(input: number): number {
  let x = input >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}
export interface Duck {
  readonly x: number;
  readonly y: number;
  readonly vy: number;
}
export interface Pipe {
  readonly id: string;
  readonly index: number;
  readonly x: number;
  readonly gapCenter: number;
  readonly scored: boolean;
}
export interface Collectible {
  readonly id: string;
  readonly typeId: string;
  readonly x: number;
  readonly y: number;
  readonly amount: number;
  readonly radius: number;
  readonly collected: boolean;
}
export interface RunState {
  readonly descriptor: RunDescriptor;
  readonly config: GameConfig;
  readonly phase: Phase;
  readonly tick: number;
  readonly duck: Duck;
  readonly pipes: readonly Pipe[];
  readonly collectibles: readonly Collectible[];
  readonly score: number;
  readonly totals: Readonly<Record<string, number>>;
  readonly rngState: number;
  readonly nextPipeIndex: number;
  readonly nextInputSequence: number;
  readonly lastCollectiblePipe: number;
  readonly nextSpawnPipeIndex: number;
  readonly inputHistory: readonly InputFrame[];
  readonly finalizationCount: number;
}
export type GameEvent =
  | {
      readonly type: "RunStarted";
      readonly runId: string;
      readonly tick: number;
    }
  | {
      readonly type: "PipePassed";
      readonly runId: string;
      readonly pipeId: string;
      readonly score: number;
      readonly tick: number;
    }
  | {
      readonly type: "CurrencyCollected";
      readonly runId: string;
      readonly collectibleId: string;
      readonly typeId: string;
      readonly amount: number;
      readonly tick: number;
    }
  | {
      readonly type: "RunEnded";
      readonly runId: string;
      readonly score: number;
      readonly totals: Readonly<Record<string, number>>;
      readonly tick: number;
    };
export interface StepResult {
  readonly state: RunState;
  readonly events: readonly GameEvent[];
}
export const makeInput = (sequence: number, action: Action): InputFrame => ({
  sequence,
  action,
});
const deepFreeze = <T>(v: T): T => freeze(v);
export function canonicalJSON(value: unknown): string {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw Error("canonical numbers must be safe integers");
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw Error("unsupported canonical value");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(object[key])}`).join(",")}}`;
}

/** Collision-free local identity: custom IDs contain the complete canonical rules. */
export function configIdFor(config: GameConfig): string {
  validateConfig(config);
  const encode = (value: GameConfig) => canonicalJSON({ configuration: value, patterns: PATTERN_CATALOG });
  const content = encode(config);
  return content === encode(DEFAULT_CONFIG) ? "dd-v1-speed-v1" : `dd-v1-config:${content}`;
}

export function createRun(
  descriptor: RunDescriptor,
  config: GameConfig = DEFAULT_CONFIG,
): RunState {
  validateDescriptor(descriptor);
  validateConfig(config);
  if (descriptor.configId !== configIdFor(config))
    throw Error("configId does not identify supplied config");
  const s: RunState = {
    descriptor: deepFreeze({ ...descriptor }),
    config: deepFreeze(config),
    phase: "READY",
    tick: 0,
    duck: {
      x: config.flight.duckX,
      y: Math.floor((config.pipes.floorY + config.pipes.ceilingY) / 2),
      vy: 0,
    },
    pipes: [],
    collectibles: [],
    score: 0,
    totals: {},
    rngState: descriptor.seed >>> 0,
    nextPipeIndex: 0,
    nextInputSequence: 0,
    lastCollectiblePipe: -1000000,
    nextSpawnPipeIndex: 0,
    inputHistory: [],
    finalizationCount: 0,
  };
  return generateNext(s).state;
}
export function generateNext(s: RunState): StepResult {
  const pipes = [...s.pipes];
  let rng = s.rngState,
    index = s.nextPipeIndex;
  const spacing = s.config.pipes.spacing;
  let x = pipes.length
    ? pipes[pipes.length - 1]!.x + spacing
    : s.config.pipes.safeLeadIn;
  while (
    pipes.length < s.config.limits.maxActivePipes &&
    x <= s.config.pipes.horizon
  ) {
    rng = (rng + 0x9e3779b9) >>> 0;
    // Indexed sampling keeps the authored four-pipe block stable across horizon fills.
    const block = Math.floor(index / 4);
    const patternChoice = mix32((s.descriptor.seed ^ Math.imul(block + 1, 0x9e3779b9)) >>> 0);
    const pattern = PATTERN_CATALOG[patternChoice % PATTERN_CATALOG.length]!;
    const gapCenter = pattern.gaps[index % pattern.gaps.length]!;
    pipes.push({ id: `pipe-${index}`, index, x, gapCenter, scored: false });
    index = incrementCounter(index);
    x += spacing;
  }
  return {
    state: deepFreeze({ ...s, pipes, rngState: rng, nextPipeIndex: index }),
    events: [],
  };
}
export const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1;
/** Speed for a one-based active simulation tick; READY is still stationary. */
export function worldSpeedAt(config: GameConfig, tick: number): number {
  validateConfig(config);
  if (!integer(tick) || tick > MAX_COUNTER)
    throw Error("tick must be a safe simulation counter");
  if (tick <= 1) return config.pipes.speed;
  const elapsed = Math.min(tick - 1, config.pipes.rampTicks);
  return config.pipes.speed + Math.floor((config.pipes.maxSpeed - config.pipes.speed) * elapsed / config.pipes.rampTicks);
}
function incrementCounter(value: number, amount = 1): number {
  const next = value + amount;
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(next) || next > MAX_COUNTER)
    throw Error("simulation counter limit exceeded");
  return next;
}
export function step(
  input: RunState,
  frames: readonly InputFrame[],
): StepResult {
  if (input.phase === "DEAD" || input.phase === "PAUSED")
    return { state: input, events: [] };
  for (const counter of [input.tick, input.score, input.nextInputSequence, input.nextPipeIndex, input.nextSpawnPipeIndex]) incrementCounter(counter);
  if (!Array.isArray(frames) || frames.length > 64) throw Error("input batch limit exceeded");
  let expected = input.nextInputSequence;
  for (const f of frames) {
    if (!integer(f.sequence) || f.sequence !== expected || f.action !== "FLAP")
      throw Error("input sequence must be contiguous");
    expected = incrementCounter(expected);
  }
  const events: GameEvent[] = [];
  let phase: Phase = input.phase,
    y = input.duck.y,
    vy = input.duck.vy;
  if (phase === "READY") {
    if (!frames.length)
      return {
        state: deepFreeze({ ...input, nextInputSequence: expected }),
        events,
      };
    phase = "RUNNING";
    events.push({
      type: "RunStarted",
      runId: input.descriptor.runId,
      tick: input.tick + 1,
    });
  }
  if (frames.length) vy = input.config.flight.flapVelocity;
  vy = Math.min(
    input.config.flight.maxFallSpeed,
    vy + input.config.flight.gravity,
  );
  y += vy;
  const pc = input.config.pipes,
    f = input.config.flight,
    speed = worldSpeedAt(input.config, input.tick + 1),
    pipes = input.pipes.map((p) => ({ ...p, x: p.x - speed })),
    duck = { x: f.duckX, y, vy };
  const dead =
    y - f.duckHalfHeight <= pc.ceilingY ||
    y + f.duckHalfHeight >= pc.floorY ||
    pipes.some((p) => {
      const l = p.x - Math.floor(pc.width / 2),
        r = p.x + Math.floor(pc.width / 2),
        dl = duck.x - f.duckHalfWidth,
        dr = duck.x + f.duckHalfWidth;
      return (
        dr >= l &&
        dl <= r &&
        (y - f.duckHalfHeight <= p.gapCenter - Math.floor(pc.gapHeight / 2) ||
          y + f.duckHalfHeight >= p.gapCenter + Math.floor(pc.gapHeight / 2))
      );
    });
  let score = input.score,
    outPipes = pipes;
  if (dead) {
    phase = "DEAD";
    events.push({
      type: "RunEnded",
      runId: input.descriptor.runId,
      score,
      totals: input.totals,
      tick: input.tick + 1,
    });
  } else
    outPipes = pipes.map((p) => {
      if (
        !p.scored &&
        p.x + Math.floor(pc.width / 2) < duck.x - f.duckHalfWidth
      ) {
        score = incrementCounter(score);
        events.push({
          type: "PipePassed",
          runId: input.descriptor.runId,
          pipeId: p.id,
          score,
          tick: input.tick + 1,
        });
        return { ...p, scored: true };
      }
      return p;
    });
  let next: RunState = {
    ...input,
    phase,
    tick: input.tick + 1,
    duck,
    pipes: outPipes.filter((p) => p.x + pc.width >= -pc.width),
    score,
    nextInputSequence: expected,
    inputHistory: [],
    finalizationCount: dead
      ? input.finalizationCount + 1
      : input.finalizationCount,
  };
  if (phase === "RUNNING") {
    next = generateNext(next).state;
    let nextSpawnPipeIndex = next.nextSpawnPipeIndex;
    let rngState = next.rngState;
    const spawnedThisTick = new Set<string>();
    for (const pipe of next.pipes) {
      if (pipe.index < nextSpawnPipeIndex) continue;
      nextSpawnPipeIndex = incrementCounter(pipe.index);
      if (pipe.index < 2) continue;

      const definitions = next.config.collectibles.filter(
        (definition) =>
          pipe.index >= definition.minPipeIndex &&
          pipe.index - next.lastCollectiblePipe >= definition.minSpacingPipes,
      );
      const totalWeight =
        next.config.spawnNoneWeight +
        definitions.reduce((total, definition) => total + definition.weight, 0);
      if (!Number.isSafeInteger(totalWeight) || totalWeight < 0)
        throw Error("spawn table weight must have a nonnegative safe-integer total");
      const sample = mix32(rngState);
      rngState = (rngState + 0x9e3779b9) >>> 0;
      if (totalWeight === 0) continue; // No eligible type: consume the opportunity as NONE.
      const roll = sample % totalWeight;
      let cumulative = next.config.spawnNoneWeight;
      const chosen = roll < next.config.spawnNoneWeight ? undefined : definitions.find((definition) => {
        cumulative += definition.weight;
        return definition.weight > 0 && roll < cumulative;
      });
      if (chosen && next.collectibles.length < next.config.limits.maxActiveCollectibles) {
        const collectibleId = `collectible-${pipe.index}`;
        spawnedThisTick.add(collectibleId);
        next = {
          ...next,
          collectibles: [
            ...next.collectibles,
            {
              id: `collectible-${pipe.index}`,
              typeId: chosen.typeId,
              x: pipe.x,
              y: pipe.gapCenter,
              amount: chosen.amount,
              radius: chosen.radius,
              collected: false,
            },
          ],
          lastCollectiblePipe: pipe.index,
        };
      }
    }
    next = { ...next, rngState, nextSpawnPipeIndex };
    const kept: Collectible[] = [];
    for (const c of next.collectibles) {
      const moved = spawnedThisTick.has(c.id) ? c : { ...c, x: c.x - speed },
        hit =
          Math.abs(moved.x - duck.x) <= moved.radius + f.duckHalfWidth &&
          Math.abs(moved.y - y) <= moved.radius + f.duckHalfHeight;
      if (hit) {
        events.push({
          type: "CurrencyCollected",
          runId: input.descriptor.runId,
          collectibleId: c.id,
          typeId: c.typeId,
          amount: c.amount,
          tick: input.tick + 1,
        });
        next = {
          ...next,
          totals: {
            ...next.totals,
            [c.typeId]: incrementCounter(next.totals[c.typeId] ?? 0, c.amount),
          },
        };
      } else if (moved.x + moved.radius >= 0) kept.push(moved);
    }
    next = { ...next, collectibles: kept };
  }
  return { state: deepFreeze(next), events: Object.freeze(events) };
}
export function pauseRun(s: RunState): RunState {
  if (s.phase !== "RUNNING") throw Error("only running runs can pause");
  return deepFreeze({ ...s, phase: "PAUSED" });
}
export function resumeRun(s: RunState): RunState {
  if (s.phase !== "PAUSED") throw Error("only paused runs can resume");
  return deepFreeze({ ...s, phase: "RUNNING", inputHistory: [] });
}
export function restartRun(
  s: RunState,
  d: RunDescriptor,
  c: GameConfig = s.config,
): RunState {
  if (d.runId === s.descriptor.runId)
    throw Error("restart requires a new run ID");
  return createRun(d, c);
}
export const canonicalState = (s: RunState): string => canonicalJSON(s);
export abstract class CollectibleType {
  abstract readonly definition: CollectibleDefinition;
  get typeId(): string {
    return this.definition.typeId;
  }
  pickup(
    runId: string,
    collectibleId: string,
    tick: number,
  ): Extract<GameEvent, { type: "CurrencyCollected" }> {
    return {
      type: "CurrencyCollected",
      runId,
      collectibleId,
      typeId: this.typeId,
      amount: this.definition.amount,
      tick,
    };
  }
}
export class Feather extends CollectibleType {
  constructor(
    readonly definition: CollectibleDefinition = DEFAULT_CONFIG
      .collectibles[0]!,
  ) {
    super();
  }
}
export class GameStar extends CollectibleType {
  constructor(
    readonly definition: CollectibleDefinition = DEFAULT_CONFIG
      .collectibles[1]!,
  ) {
    super();
  }
}
class DefinedCollectible extends CollectibleType {
  constructor(readonly definition: CollectibleDefinition) {
    super();
  }
}
export function collectibleFromDefinition(
  d: CollectibleDefinition,
): CollectibleType {
  const checked = deepFreeze({ ...d });
  if (checked.typeId === "FEATHER") return new Feather(checked);
  if (checked.typeId === "GAME_STAR") return new GameStar(checked);
  return new DefinedCollectible(checked);
}
