import { DEFAULT_CONFIG, PATTERN_CATALOG, validateConfig } from "./config.js";
import { DEFAULT_CONFIG_ID, type GameConfig, type RunState } from "./types.js";

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
  const encode = (value: GameConfig) => canonicalJSON({ configuration: { ...value, challenges: value.challenges ?? null }, patterns: PATTERN_CATALOG });
  const content = encode(config);
  return content === encode(DEFAULT_CONFIG) ? DEFAULT_CONFIG_ID : `dd-v1-config:${content}`;
}

export const canonicalState = (s: RunState): string => canonicalJSON(s);
