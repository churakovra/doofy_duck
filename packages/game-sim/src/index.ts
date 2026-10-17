export {
  DEFAULT_CONFIG,
  LEGACY_DEFAULT_CONFIG,
  PATTERN_CATALOG,
  validateConfig,
  validateDescriptor,
} from "./config.js";
export { MAX_COUNTER } from "./internal.js";
export {
  DEFAULT_CONFIG_ID,
  GENERATOR_VERSION,
  LEGACY_DEFAULT_CONFIG_ID,
  LEGACY_GENERATOR_VERSION,
  LEGACY_SIMULATION_VERSION,
  SIMULATION_VERSION,
  makeInput,
  mix32,
} from "./types.js";
export type {
  Action,
  ChallengeBand,
  ChallengeFamily,
  ChallengeSet,
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
  StarScheduleConfig,
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
