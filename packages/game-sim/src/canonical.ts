import { VARIED_BASE_DEFAULT_CONFIG, BONUS_SEGMENTS_DEFAULT_CONFIG, BONUS_SEGMENTS_V2_DEFAULT_CONFIG, VARIED_PIPES_DEFAULT_CONFIG, PRESSURE_PIPES_DEFAULT_CONFIG, DENSE_PIPES_DEFAULT_CONFIG, BASE_BONUS_DEFAULT_CONFIG, COIN_COURSE_DEFAULT_CONFIG, CURRENCY_FORMATIONS_DEFAULT_CONFIG, DEFAULT_CONFIG, LEGACY_DEFAULT_CONFIG, PATTERN_CATALOG, PAIRED_ROUTES_DEFAULT_CONFIG, PRIOR_DEFAULT_CONFIG, VARIED_OBSTACLE_DEFAULT_CONFIG, WETLAND_DEFAULT_CONFIG, validateConfig } from "./config.js";
import { VARIED_BASE_CONFIG_ID, BONUS_SEGMENTS_CONFIG_ID, BONUS_SEGMENTS_V2_CONFIG_ID, VARIED_PIPES_CONFIG_ID, PRESSURE_PIPES_CONFIG_ID, DENSE_PIPES_CONFIG_ID, BASE_BONUS_CONFIG_ID, COIN_COURSE_CONFIG_ID, CURRENCY_FORMATIONS_CONFIG_ID, DEFAULT_CONFIG_ID, LEGACY_DEFAULT_CONFIG_ID, PAIRED_ROUTES_CONFIG_ID, PRIOR_DEFAULT_CONFIG_ID, VARIED_OBSTACLE_DEFAULT_CONFIG_ID, WETLAND_DEFAULT_CONFIG_ID, type GameConfig, type RunState } from "./types.js";

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
  if (content === encode(COIN_COURSE_DEFAULT_CONFIG)) return COIN_COURSE_CONFIG_ID;
  if (content === encode(CURRENCY_FORMATIONS_DEFAULT_CONFIG)) return CURRENCY_FORMATIONS_CONFIG_ID;
  if (content === encode(BONUS_SEGMENTS_DEFAULT_CONFIG)) return BONUS_SEGMENTS_CONFIG_ID;
  if (content === encode(BONUS_SEGMENTS_V2_DEFAULT_CONFIG)) return BONUS_SEGMENTS_V2_CONFIG_ID;
  if (content === encode(VARIED_PIPES_DEFAULT_CONFIG)) return VARIED_PIPES_CONFIG_ID;
  if (content === encode(PRESSURE_PIPES_DEFAULT_CONFIG)) return PRESSURE_PIPES_CONFIG_ID;
  if (content === encode(DENSE_PIPES_DEFAULT_CONFIG)) return DENSE_PIPES_CONFIG_ID;
  if (content === encode(BASE_BONUS_DEFAULT_CONFIG)) return BASE_BONUS_CONFIG_ID;
  if (content === encode(VARIED_BASE_DEFAULT_CONFIG)) return VARIED_BASE_CONFIG_ID;
  if (content === encode(DEFAULT_CONFIG)) return DEFAULT_CONFIG_ID;
  if (content === encode(PAIRED_ROUTES_DEFAULT_CONFIG)) return PAIRED_ROUTES_CONFIG_ID;
  if (content === encode(VARIED_OBSTACLE_DEFAULT_CONFIG)) return VARIED_OBSTACLE_DEFAULT_CONFIG_ID;
  if (content === encode(PRIOR_DEFAULT_CONFIG)) return PRIOR_DEFAULT_CONFIG_ID;
  if (content === encode(LEGACY_DEFAULT_CONFIG)) return LEGACY_DEFAULT_CONFIG_ID;
  if (content === encode(WETLAND_DEFAULT_CONFIG)) return WETLAND_DEFAULT_CONFIG_ID;
  return `dd-v1-config:${content}`;
}

export const canonicalState = (s: RunState): string => canonicalJSON(s);
