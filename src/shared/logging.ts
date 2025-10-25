import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { redactString, redactUnknown } from "./redaction.js";
import { captureDiagnosticsLog } from "./diagnostics/registry.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

type LogExtras = Record<string, unknown> | undefined;

type LogContext = { correlationId: string };

const levelWeights: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let currentThreshold = levelWeights.info;

const context = new AsyncLocalStorage<LogContext>();

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
    msg: redactString(message)
  };
  const correlationId = getCorrelationId();
  if (correlationId) {
    base.correlationId = correlationId;
  }
  const sanitizedExtras = sanitizeExtras(extras);
  const payload = sanitizedExtras ? { ...sanitizedExtras, ...base } : base;
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  captureDiagnosticsLog({
    ts,
    level,
    subsystem,
    msg: base.msg as string,
    correlationId,
    extras: sanitizedExtras
  });
}

function sanitizeExtras(extras?: LogExtras): Record<string, unknown> | undefined {
  if (!extras) {
    return undefined;
  }
  return redactUnknown(extras) as Record<string, unknown>;
}
