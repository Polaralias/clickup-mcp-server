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

function toOptionalString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
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

function parseDefaultHeaders(value: string | undefined): Record<string, string> {
  const raw = toOptionalString(value);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
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
    return {};
  }
}

function resolveAuthScheme(value: string | undefined): AuthScheme {
  if (value === "oauth" || value === "personal_token" || value === "auto") {
    return value;
  }
  return "auto";
}

function parseTimeoutSeconds(value: string | undefined): number {
  const parsed = parseOptionalInteger(value);
  if (parsed === undefined) {
    return 30;
  }
  if (parsed <= 0) {
    return 30;
  }
  return Math.ceil(parsed / 1000);
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

export function fromEnv(): SessionConfig {
  const apiToken = toOptionalString(process.env.CLICKUP_TOKEN) ?? "";
  const authScheme = resolveAuthScheme(process.env.CLICKUP_AUTH_SCHEME);
  const baseUrl = normaliseBaseUrl(process.env.CLICKUP_BASE_URL);
  const defaultTeamId = parseOptionalInteger(process.env.CLICKUP_DEFAULT_TEAM_ID);
  const requestTimeout = parseTimeoutSeconds(process.env.REQUEST_TIMEOUT_MS);
  const defaultHeaders = parseDefaultHeaders(process.env.DEFAULT_HEADERS_JSON);
  const language = toOptionalString(process.env.CLICKUP_PRIMARY_LANGUAGE);
  if (language && !defaultHeaders["Accept-Language"]) {
    defaultHeaders["Accept-Language"] = language;
  }
  return {
    apiToken,
    authScheme,
    baseUrl,
    defaultTeamId,
    requestTimeout,
    defaultHeaders
  };
}

export function validateOrThrow(config: SessionConfig): void {
  if (!config.apiToken) {
    throw new Error("Missing ClickUp API token");
  }
}
