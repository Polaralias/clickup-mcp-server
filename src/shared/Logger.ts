import type { RuntimeConfig } from "../config/runtime.js";

type LogLevel = RuntimeConfig["logLevel"];

type Extras = Record<string, unknown> | undefined;

const levelWeights: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level: LogLevel) {
  const threshold = levelWeights[level];
  const shouldLog = (entryLevel: LogLevel) => levelWeights[entryLevel] >= threshold;
  const write = (entryLevel: LogLevel, msg: string, extras?: Record<string, unknown>) => {
    if (!shouldLog(entryLevel)) {
      return;
    }
    const ts = new Date().toISOString();
    const payload = extras ? { ts, level: entryLevel, msg, ...extras } : { ts, level: entryLevel, msg };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  };
  return {
    debug(message: string, extras?: Extras) {
      write("debug", message, extras);
    },
    info(message: string, extras?: Extras) {
      write("info", message, extras);
    },
    warn(message: string, extras?: Extras) {
      write("warn", message, extras);
    },
    error(message: string, extras?: Extras) {
      write("error", message, extras);
    }
  };
}
