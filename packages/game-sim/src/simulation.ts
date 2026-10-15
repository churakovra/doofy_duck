import { configIdFor } from "./canonical.js";
import { bonusY, generateNext, worldSpeedAt } from "./generation.js";
import { deepFreeze, incrementCounter } from "./internal.js";
import { DEFAULT_CONFIG, validateConfig, validateDescriptor } from "./config.js";
import { mix32, SIMULATION_VERSION, GENERATOR_VERSION, type Collectible, type GameConfig, type InputFrame, type Phase, type RunDescriptor, type RunDescriptorIdentity, type RunState, type StepResult, type GameEvent } from "./types.js";

export function createRunDescriptor(
  identity: RunDescriptorIdentity,
  config: GameConfig = DEFAULT_CONFIG,
): RunDescriptor {
  return {
    ...identity,
    simulationVersion: SIMULATION_VERSION,
    generatorVersion: GENERATOR_VERSION,
    configId: configIdFor(config),
  };
}

export function createRun(
  descriptor: RunDescriptor,
  config: GameConfig = DEFAULT_CONFIG,
): RunState {
  validateDescriptor(descriptor);
  validateConfig(config);
  if (descriptor.configId !== configIdFor(config))
    throw Error("configId does not identify supplied config");
  const ownedConfig = cloneConfig(config);
  const s: RunState = {
    descriptor: deepFreeze({ ...descriptor }),
    config: deepFreeze(ownedConfig),
    phase: "READY",
    tick: 0,
    duck: {
      x: config.flight.duckX,
      y: Math.floor((ownedConfig.pipes.floorY + ownedConfig.pipes.ceilingY) / 2),
      vy: 0,
    },
    pipes: [],
    collectibles: [],
    score: 0,
    totals: {},
    rngState: descriptor.seed >>> 0,
    nextPipeIndex: 0,
    lastGapCenter: Math.floor((ownedConfig.pipes.gapMinCenter + ownedConfig.pipes.gapMaxCenter) / 2),
    nextInputSequence: 0,
    lastCollectiblePipe: -1000000,
    nextSpawnPipeIndex: 0,
    inputHistory: [],
    finalizationCount: 0,
  };
  return generateNext(s).state;
}
function cloneConfig(config: GameConfig): GameConfig {
  return {
    ...config,
    flight: { ...config.flight },
    pipes: { ...config.pipes },
    limits: { ...config.limits },
    collectibles: config.collectibles.map((definition) => ({ ...definition })),
  };
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
    if (!Number.isSafeInteger(f.sequence) || f.sequence !== expected || f.action !== "FLAP")
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
    speed = worldSpeedAt(input.config, input.tick + 1, input.score),
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
              y: bonusY(next.config, input.descriptor.seed, pipe, chosen.radius),
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
            [c.typeId]: incrementCounter(Object.hasOwn(next.totals, c.typeId) ? next.totals[c.typeId]! : 0, c.amount),
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
