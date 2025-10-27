import { SessionConfig, AuthScheme } from "../../shared/config/schema.js";
import { getSessionId, getConnectionId, stableSessionIdentifier } from "../../shared/config/session.js";

const MAX_CACHE_SIZE = 256;
const connectionCache = new Map<string, string>();

function cacheConnectionIdentifier(connectionId: string): string {
  const cached = connectionCache.get(connectionId);
  if (cached) {
    return cached;
  }
  const identifier = stableSessionIdentifier(undefined, connectionId);
  connectionCache.set(connectionId, identifier);
  if (connectionCache.size > MAX_CACHE_SIZE) {
    const firstKey = connectionCache.keys().next().value;
    if (firstKey) {
      connectionCache.delete(firstKey);
    }
  }
  return identifier;
}

function resolveClientSessionId(): string {
  const sessionId = getSessionId();
  if (sessionId) {
    return stableSessionIdentifier(sessionId, undefined);
  }
  const connectionId = getConnectionId();
  if (!connectionId) {
    return stableSessionIdentifier(undefined, undefined);
  }
  return cacheConnectionIdentifier(connectionId);
}

const BEARER_PREFIX = /^bearer\s+/i;

function isLikelyJwt(token: string): boolean {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return false;
  }
  return segments.every(part => part.length > 0);
}

export function resolveAuthorizationValue(token: string, scheme: AuthScheme): string {
  const raw = token.trim();
  if (raw.length === 0) {
    return raw;
  }
  if (BEARER_PREFIX.test(raw)) {
    return raw;
  }
  if (scheme === "oauth") {
    return `Bearer ${raw}`;
  }
  if (scheme === "personal_token") {
    return raw;
  }
  if (isLikelyJwt(raw)) {
    return `Bearer ${raw}`;
  }
  return raw;
}

export function resolveAuthHeader(config: SessionConfig): string {
  return resolveAuthorizationValue(config.apiToken, config.authScheme);
}

export function buildClickUpHeaders(options: { session: SessionConfig; teamId?: number }): Record<string, string> {
  const headers: Record<string, string> = { ...options.session.defaultHeaders };
  headers.Authorization = resolveAuthHeader(options.session);
  const teamId = options.teamId ?? options.session.defaultTeamId;
  if (typeof teamId === "number" && Number.isFinite(teamId)) {
    const value = Math.trunc(teamId).toString(10);
    headers["Team-ID"] = value;
    headers["Team-Id"] = value;
  }
  headers["X-Client-Session-Id"] = resolveClientSessionId();
  return headers;
}
