export type Phase = "READY" | "RUNNING" | "PAUSED" | "DEAD";
export type Action = "FLAP";
export interface RunDescriptor {
  readonly runId: string;
  readonly seed: number;
  readonly simulationVersion: string;
  readonly generatorVersion: string;
  readonly configId: string;
}
export const SIMULATION_VERSION = "1.4.0";
export const GENERATOR_VERSION = "1.3.0";
export const DEFAULT_CONFIG_ID = "dd-v1-star-interval-v1";
export const LEGACY_SIMULATION_VERSION = "1.3.0";
export const LEGACY_GENERATOR_VERSION = "1.2.0";
export const LEGACY_DEFAULT_CONFIG_ID = "dd-v1-stepped-v1";
export interface RunDescriptorIdentity {
  readonly runId: string;
  readonly seed: number;
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
  readonly speedEveryPipes: number;
  readonly speedStepPercent: number;
  readonly gapMinCenter: number;
  readonly gapMaxCenter: number;
  readonly maxGapDelta: number;
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
  readonly starSchedule?: StarScheduleConfig | null;
  readonly challenges?: ChallengeSet | null;
}
export interface StarScheduleConfig {
  readonly minIntervalPipes: number;
  readonly maxIntervalPipes: number;
}
export type ChallengeBand = "intro" | "cruise" | "pressure" | "recovery";
export interface ChallengeFamily {
  readonly id: string;
  readonly band: ChallengeBand;
  readonly gapCenters: readonly number[];
}
export interface ChallengeSet {
  readonly pipesPerFamily: number;
  readonly introFamilyId: string;
  readonly cruiseFamilyIds: readonly string[];
  readonly pressureFamilyIds: readonly string[];
  readonly recoveryFamilyId: string;
  readonly families: readonly ChallengeFamily[];
}
export interface GapPattern {
  readonly id: string;
  readonly gaps: readonly number[];
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
  readonly challengeId?: string;
  readonly challengeStep?: number;
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
  readonly lastGapCenter: number;
  readonly nextInputSequence: number;
  readonly lastCollectiblePipe: number;
  readonly nextSpawnPipeIndex: number;
  readonly nextStarPipeIndex?: number;
  readonly starScheduleOrdinal?: number;
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
