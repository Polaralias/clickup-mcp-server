import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

type LogExtras = Record<string, unknown> | undefined;

type LogContext = { correlationId: string };

const levelWeights: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let currentThreshold = levelWeights.info;

const context = new AsyncLocalStorage<LogContext>();

const SENSITIVE_KEY_PATTERN = /(token|secret|key|authorization|password)/i;
const SENSITIVE_VALUE_PATTERN =
  /(sk_[a-z0-9_-]{8,}|rk_[a-z0-9_-]{8,}|pk_[a-z0-9_-]{8,}|bearer\s+[a-z0-9._-]{8,}|(?:token|key|secret)[=:]\s*[a-z0-9._-]{8,})/gi;

export function configureLogging(options: { level: LogLevel }): void {
  currentThreshold = levelWeights[options.level];
}

export function withCorrelationId<T>(correlationId: string, fn: () => T): T {
  return context.run({ correlationId }, fn);
}

export function newCorrelationId(): string {
  return randomUUID();
}

export function getCorrelationId(): string | undefined {
  return context.getStore()?.correlationId;
}

export function logInfo(subsystem: string, msg: string, extras?: LogExtras): void {
  writeLog("info", subsystem, msg, extras);
}

export function logWarn(subsystem: string, msg: string, extras?: LogExtras): void {
  writeLog("warn", subsystem, msg, extras);
}

export function logError(subsystem: string, msg: string, extras?: LogExtras): void {
  writeLog("error", subsystem, msg, extras);
}

export function logDebug(subsystem: string, msg: string, extras?: LogExtras): void {
  writeLog("debug", subsystem, msg, extras);
}

export function createLogger(subsystem: string) {
  return {
    debug(message: string, extras?: LogExtras) {
      logDebug(subsystem, message, extras);
    },
    info(message: string, extras?: LogExtras) {
      logInfo(subsystem, message, extras);
    },
    warn(message: string, extras?: LogExtras) {
      logWarn(subsystem, message, extras);
    },
    error(message: string, extras?: LogExtras) {
      logError(subsystem, message, extras);
    }
  };
}

function shouldLog(level: LogLevel): boolean {
  return levelWeights[level] >= currentThreshold;
}

function writeLog(level: LogLevel, subsystem: string, message: string, extras?: LogExtras): void {
  if (!shouldLog(level)) {
    return;
  }
  const ts = new Date().toISOString();
  const base: Record<string, unknown> = {
    ts,
    level,
    subsystem,
    msg: maskSensitiveString(message)
  };
  const correlationId = getCorrelationId();
  if (correlationId) {
    base.correlationId = correlationId;
  }
  const sanitizedExtras = sanitizeExtras(extras);
  const payload = sanitizedExtras ? { ...sanitizedExtras, ...base } : base;
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sanitizeExtras(extras?: LogExtras): Record<string, unknown> | undefined {
  if (!extras) {
    return undefined;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extras)) {
    sanitized[key] = sanitizeValue(value, key);
  }
  return sanitized;
}

function sanitizeValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (key && SENSITIVE_KEY_PATTERN.test(key)) {
      return "***REDACTED***";
    }
    return maskSensitiveString(value);
  }
  if (Array.isArray(value)) {
    return value.map(entry => sanitizeValue(entry));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      result[childKey] = sanitizeValue(childValue, childKey);
    }
    return result;
  }
  return value;
}

function maskSensitiveString(value: string): string {
  if (!value) {
    return value;
  }
  SENSITIVE_VALUE_PATTERN.lastIndex = 0;
  if (SENSITIVE_VALUE_PATTERN.test(value)) {
    SENSITIVE_VALUE_PATTERN.lastIndex = 0;
    return value.replace(SENSITIVE_VALUE_PATTERN, "***REDACTED***");
  }
  return value;
}
