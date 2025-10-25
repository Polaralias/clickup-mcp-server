import { CHARACTER_LIMIT } from "./constants.js";

export type StdioTransportConfig = { kind: "stdio" };

export type HttpTransportConfig = {
  kind: "http";
  host: string;
  port: number;
  corsAllowOrigin: string;
  corsAllowHeaders: string;
  corsAllowMethods: string;
  enableJsonResponse: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  enableDnsRebindingProtection: boolean;
};

export type RuntimeConfig = {
  logLevel: "debug" | "info" | "warn" | "error";
  featurePersistence: boolean;
  transport: StdioTransportConfig | HttpTransportConfig;
};

const allowedLevels = new Set<RuntimeConfig["logLevel"]>(["debug", "info", "warn", "error"]);
const DEFAULT_ATTACHMENT_MB = 8;
const DEFAULT_BULK_CONCURRENCY = 10;
const DEFAULT_HTTP_PORT = 3000;
const DEFAULT_HTTP_HOST = "0.0.0.0";

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

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  if (value.trim().length === 0) {
    return defaultValue;
  }
  const normalized = value.toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const items = value
    .split(",")
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
  return items.length > 0 ? items : undefined;
}

function resolveHttpTransport(): HttpTransportConfig {
  const host = process.env.MCP_HTTP_HOST?.trim() || DEFAULT_HTTP_HOST;
  const port = parsePositiveInt(process.env.MCP_HTTP_PORT ?? process.env.PORT) ?? DEFAULT_HTTP_PORT;
  const corsAllowOrigin = process.env.MCP_HTTP_CORS_ALLOW_ORIGIN?.trim() || "*";
  const corsAllowHeaders =
    process.env.MCP_HTTP_CORS_ALLOW_HEADERS?.trim() ||
    "Content-Type, MCP-Session-Id, MCP-Protocol-Version";
  const corsAllowMethods = process.env.MCP_HTTP_CORS_ALLOW_METHODS?.trim() || "GET,POST,DELETE,OPTIONS";
  const enableJsonResponse = parseBoolean(process.env.MCP_HTTP_ENABLE_JSON_RESPONSE, true);
  const allowedHosts = parseList(process.env.MCP_HTTP_ALLOWED_HOSTS);
  const allowedOrigins = parseList(process.env.MCP_HTTP_ALLOWED_ORIGINS);
  const enableDnsRebindingProtection = parseBoolean(process.env.MCP_HTTP_ENABLE_DNS_REBINDING_PROTECTION, false);
  return {
    kind: "http",
    host,
    port,
    corsAllowOrigin,
    corsAllowHeaders,
    corsAllowMethods,
    enableJsonResponse,
    allowedHosts,
    allowedOrigins,
    enableDnsRebindingProtection
  };
}

function resolveTransport(): RuntimeConfig["transport"] {
  const value = process.env.MCP_TRANSPORT?.trim().toLowerCase();
  if (value === "http") {
    return resolveHttpTransport();
  }
  return { kind: "stdio" };
}

export function loadRuntimeConfig(): RuntimeConfig {
  const logLevel = resolveLogLevel(process.env.LOG_LEVEL);
  const featurePersistence = process.env.FEATURE_PERSISTENCE === "true";
  const transport = resolveTransport();
  return { logLevel, featurePersistence, transport };
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
