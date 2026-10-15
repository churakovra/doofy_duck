export {
  DEFAULT_CONFIG,
  PATTERN_CATALOG,
  validateConfig,
  validateDescriptor,
} from "./config.js";
export { MAX_COUNTER } from "./internal.js";
export {
  DEFAULT_CONFIG_ID,
  GENERATOR_VERSION,
  SIMULATION_VERSION,
  makeInput,
  mix32,
} from "./types.js";
export type {
  Action,
  Collectible,
  CollectibleDefinition,
  Duck,
  FlightConfig,
  GameConfig,
  GameEvent,
  GapPattern,
  InputFrame,
  LimitsConfig,
  Phase,
  Pipe,
  PipeConfig,
  RunDescriptor,
  RunDescriptorIdentity,
  RunState,
  StepResult,
} from "./types.js";
export { canonicalJSON, canonicalState, configIdFor } from "./canonical.js";
export { generateNext, worldSpeedAt } from "./generation.js";
export {
  createRun,
  createRunDescriptor,
  pauseRun,
  restartRun,
  resumeRun,
  step,
} from "./simulation.js";
export {
  CollectibleType,
  Feather,
  GameStar,
  collectibleFromDefinition,
} from "./collectibles.js";
