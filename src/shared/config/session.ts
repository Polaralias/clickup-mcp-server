import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import { SessionConfig, AuthScheme, normaliseBaseUrl } from "./schema.js";

export type SessionScope = {
  config: SessionConfig;
  sessionId?: string;
  connectionId?: string;
};

const storage = new AsyncLocalStorage<SessionScope>();

const AUTH_SCHEMES: AuthScheme[] = ["auto", "personal_token", "oauth"];

function toOptionalString(value: string | null): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseAuthScheme(value: string | null): AuthScheme | undefined {
  const raw = toOptionalString(value);
  if (!raw) {
    return undefined;
  }
  if ((AUTH_SCHEMES as string[]).includes(raw)) {
    return raw as AuthScheme;
  }
  return undefined;
}

function parseInteger(value: string | null): number | undefined {
  const raw = toOptionalString(value);
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function parseTimeoutSeconds(value: string | null): number | undefined {
  const parsed = parseInteger(value);
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseHeaders(value: string | null): Record<string, string> | undefined {
  const raw = toOptionalString(value);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const entries: Record<string, string> = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (typeof entry === "string") {
        entries[key] = entry;
      } else if (entry !== undefined && entry !== null) {
        entries[key] = String(entry);
      }
    }
    return entries;
  } catch {
    return undefined;
  }
}

function resolveSessionId(headerValue: string | undefined): string | undefined {
  const trimmed = headerValue?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

function resolveConnectionId(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

export function mapQueryToSessionConfig(base: SessionConfig, query: URLSearchParams): SessionConfig {
  const apiToken = toOptionalString(query.get("api_token") ?? query.get("apiToken"));
  const authScheme = parseAuthScheme(query.get("auth_scheme") ?? query.get("authScheme"));
  const baseUrl = toOptionalString(query.get("base_url") ?? query.get("baseUrl"));
  const defaultTeamId = parseInteger(query.get("default_team_id") ?? query.get("defaultTeamId"));
  const requestTimeout = parseTimeoutSeconds(
    query.get("request_timeout") ?? query.get("requestTimeout")
  );
  const headers = parseHeaders(query.get("default_headers") ?? query.get("defaultHeaders"));
  const mergedHeaders = { ...base.defaultHeaders, ...(headers ?? {}) };
  return {
    apiToken: apiToken ?? base.apiToken,
    authScheme: authScheme ?? base.authScheme,
    baseUrl: baseUrl ? normaliseBaseUrl(baseUrl) : base.baseUrl,
    defaultTeamId: defaultTeamId ?? base.defaultTeamId,
    requestTimeout: requestTimeout ?? base.requestTimeout,
    defaultHeaders: mergedHeaders
  };
}

export function runWithSessionScope<T>(scope: SessionScope, fn: () => T): T {
  return storage.run(scope, fn);
}

export function withSessionScope<T>(scope: SessionScope, fn: () => T): T {
  const store = storage.getStore();
  if (store) {
    return fn();
  }
  return runWithSessionScope(scope, fn);
}

export function getSessionScope(): SessionScope {
  const store = storage.getStore();
  if (!store) {
    throw new Error("Session context unavailable");
  }
  return store;
}

export function getSessionConfig(): SessionConfig {
  return getSessionScope().config;
}

export function getSessionId(): string | undefined {
  return storage.getStore()?.sessionId;
}

export function getConnectionId(): string | undefined {
  return storage.getStore()?.connectionId;
}

export function deriveSessionScope(
  base: SessionConfig,
  query: URLSearchParams,
  options: { headerSessionId?: string; connectionId?: string }
): SessionScope {
  const config = mapQueryToSessionConfig(base, query);
  const sessionId = resolveSessionId(options.headerSessionId);
  const connectionId = resolveConnectionId(options.connectionId);
  return { config, sessionId, connectionId };
}

export function generateConnectionKey(remoteAddress: string | undefined, remotePort: number | undefined): string {
  const address = remoteAddress ?? "";
  const port = typeof remotePort === "number" ? remotePort.toString(10) : "";
  if (!address && !port) {
    return randomUUID();
  }
  return `${address}:${port}`;
}

export function stableSessionIdentifier(sessionId?: string, connectionId?: string): string {
  if (sessionId) {
    return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
  }
  const key = connectionId ?? `proc:${process.pid}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}
