import { CHARACTER_LIMIT } from "./constants.js";

export type RuntimeConfig = { logLevel: "debug" | "info" | "warn" | "error"; featurePersistence: boolean };

const allowedLevels = new Set<RuntimeConfig["logLevel"]>(["debug", "info", "warn", "error"]);
const DEFAULT_ATTACHMENT_MB = 8;
const DEFAULT_BULK_CONCURRENCY = 10;

function resolveLogLevel(value: string | undefined): RuntimeConfig["logLevel"] {
  if (value && allowedLevels.has(value as RuntimeConfig["logLevel"])) {
    return value as RuntimeConfig["logLevel"];
  }
  return "info";
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

export function loadRuntimeConfig(): RuntimeConfig {
  const logLevel = resolveLogLevel(process.env.LOG_LEVEL);
  const featurePersistence = process.env.FEATURE_PERSISTENCE === "true";
  return { logLevel, featurePersistence };
}

export function characterLimit(): number {
  return CHARACTER_LIMIT;
}

export function maxAttachmentBytes(): number {
  const limitMb = parsePositiveInt(process.env.MAX_ATTACHMENT_MB) ?? DEFAULT_ATTACHMENT_MB;
  return limitMb * 1024 * 1024;
}

export function maxBulkConcurrency(): number {
  const limit = parsePositiveInt(process.env.MAX_BULK_CONCURRENCY) ?? DEFAULT_BULK_CONCURRENCY;
  return Math.max(1, limit);
}
