import { CHARACTER_LIMIT } from "./constants.js";

export type RuntimeConfig = { logLevel: "debug" | "info" | "warn" | "error"; featurePersistence: boolean };

const allowedLevels = new Set<RuntimeConfig["logLevel"]>(["debug", "info", "warn", "error"]);

function resolveLogLevel(value: string | undefined): RuntimeConfig["logLevel"] {
  if (value && allowedLevels.has(value as RuntimeConfig["logLevel"])) {
    return value as RuntimeConfig["logLevel"];
  }
  return "info";
}

export function loadRuntimeConfig(): RuntimeConfig {
  const logLevel = resolveLogLevel(process.env.LOG_LEVEL);
  const featurePersistence = process.env.FEATURE_PERSISTENCE === "true";
  return { logLevel, featurePersistence };
}

export function characterLimit(): number {
  return CHARACTER_LIMIT;
}
