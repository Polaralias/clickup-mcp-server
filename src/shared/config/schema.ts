import { URL } from "node:url";

export type AuthScheme = "auto" | "personal_token" | "oauth";

export type SessionConfig = {
  apiToken: string;
  authScheme: AuthScheme;
  baseUrl: string;
  defaultTeamId?: number;
  requestTimeout: number;
  defaultHeaders: Record<string, string>;
};

export type AppConfig = {
  apiToken: string;
  defaultTeamId?: number;
  primaryLanguage?: string;
  baseUrl?: string;
  requestTimeoutMs?: number;
  defaultHeadersJson?: string;
};

function toOptionalString(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalInteger(value: string | undefined | null): number | undefined {
  const raw = toOptionalString(value);
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return parsed;
}

function parseHeaders(value: string | undefined, language: string | undefined): Record<string, string> {
  const entries: Record<string, string> = {};
  const source = toOptionalString(value);
  if (source) {
    try {
      const parsed = JSON.parse(source) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, entry] of Object.entries(parsed)) {
          if (typeof entry === "string") {
            entries[key] = entry;
          } else if (entry !== undefined && entry !== null) {
            entries[key] = String(entry);
          }
        }
      }
    } catch {
      return entries;
    }
  }
  if (language && !entries["Accept-Language"]) {
    entries["Accept-Language"] = language;
  }
  return entries;
}

export function normaliseBaseUrl(value: string | undefined): string {
  const fallback = "https://api.clickup.com/api/v2";
  const raw = toOptionalString(value);
  if (!raw) {
    return fallback;
  }
  const prefixed = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(prefixed);
  } catch {
    return fallback;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    url.pathname = "/api/v2";
  } else if (segments[0] === "api") {
    if (segments.length === 1) {
      segments.push("v2");
    }
    url.pathname = `/${segments.join("/")}`;
  } else {
    url.pathname = `/${segments.join("/")}`;
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

function resolveRequestTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 30;
  }
  return Math.ceil(value / 1000);
}

type EnvSource = Record<string, string | undefined>;

function resolveEnv(source?: EnvSource): EnvSource {
  return source ?? process.env;
}

function readEnv(env: EnvSource, key: string): string | undefined {
  return env[key];
}

export function fromEnv(env?: EnvSource): AppConfig {
  const source = resolveEnv(env);
  const apiToken = toOptionalString(readEnv(source, "CLICKUP_TOKEN")) ?? "";
  const defaultTeamId = parseOptionalInteger(readEnv(source, "CLICKUP_DEFAULT_TEAM_ID"));
  const primaryLanguage = toOptionalString(readEnv(source, "CLICKUP_PRIMARY_LANGUAGE"));
  const baseUrl = toOptionalString(readEnv(source, "CLICKUP_BASE_URL"));
  const requestTimeoutMs = parseOptionalInteger(readEnv(source, "REQUEST_TIMEOUT_MS"));
  const defaultHeadersJson = toOptionalString(readEnv(source, "DEFAULT_HEADERS_JSON"));
  return {
    apiToken,
    defaultTeamId,
    primaryLanguage,
    baseUrl,
    requestTimeoutMs,
    defaultHeadersJson
  };
}

export function validateOrThrow(config: AppConfig): void {
  if (!config.apiToken || config.apiToken.trim().length === 0) {
    throw new Error("Missing ClickUp API token");
  }
  if (config.defaultTeamId !== undefined && !Number.isFinite(config.defaultTeamId)) {
    throw new Error("Invalid ClickUp default team id");
  }
}

export function toSessionConfig(config: AppConfig): SessionConfig {
  const baseUrl = normaliseBaseUrl(config.baseUrl);
  const requestTimeout = resolveRequestTimeout(config.requestTimeoutMs);
  const defaultHeaders = parseHeaders(config.defaultHeadersJson, config.primaryLanguage);
  return {
    apiToken: config.apiToken,
    authScheme: "auto",
    baseUrl,
    defaultTeamId: Number.isFinite(config.defaultTeamId ?? NaN)
      ? config.defaultTeamId
      : undefined,
    requestTimeout,
    defaultHeaders
  };
}
