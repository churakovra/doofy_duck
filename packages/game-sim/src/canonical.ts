import { BUILTIN_RULESETS, CUSTOM_CONFIG_PREFIX, PATTERN_CATALOG, validateConfig } from "./config.js";
import type { GameConfig, RunState } from "./types.js";

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

function encodeConfig(config: GameConfig): string {
  const normalized = { ...config, challenges: config.challenges ?? null } as GameConfig & { starSchedule?: GameConfig["starSchedule"] };
  if (normalized.starSchedule == null) delete normalized.starSchedule;
  return canonicalJSON({ configuration: normalized, patterns: PATTERN_CATALOG });
}

const builtInConfigIds = new Map<string, string>();
for (const { config, configId } of BUILTIN_RULESETS) {
  const content = encodeConfig(config);
  if (!builtInConfigIds.has(content)) builtInConfigIds.set(content, configId);
}

/** Collision-free local identity: custom IDs contain the complete canonical rules. */
export function configIdFor(config: GameConfig): string {
  validateConfig(config);
  const content = encodeConfig(config);
  return builtInConfigIds.get(content) ?? `${CUSTOM_CONFIG_PREFIX}${content}`;
}

export const canonicalState = (s: RunState): string => canonicalJSON(s);
