import { DEFAULT_CONFIG, LEGACY_DEFAULT_CONFIG, PATTERN_CATALOG, PRIOR_DEFAULT_CONFIG, validateConfig } from "./config.js";
import { DEFAULT_CONFIG_ID, LEGACY_DEFAULT_CONFIG_ID, PRIOR_DEFAULT_CONFIG_ID, type GameConfig, type RunState } from "./types.js";

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
  const encode = (value: GameConfig) => {
    const normalized = { ...value, challenges: value.challenges ?? null } as GameConfig & { starSchedule?: GameConfig["starSchedule"] };
    if (normalized.starSchedule == null) delete normalized.starSchedule;
    return canonicalJSON({ configuration: normalized, patterns: PATTERN_CATALOG });
  };
  const content = encode(config);
  if (content === encode(DEFAULT_CONFIG)) return DEFAULT_CONFIG_ID;
  if (content === encode(PRIOR_DEFAULT_CONFIG)) return PRIOR_DEFAULT_CONFIG_ID;
  if (content === encode(LEGACY_DEFAULT_CONFIG)) return LEGACY_DEFAULT_CONFIG_ID;
  return `dd-v1-config:${content}`;
}

export const canonicalState = (s: RunState): string => canonicalJSON(s);
