import { fromEnv as loadAppConfig, type AppConfig as LegacyAppConfig } from "./schema.js";

export type AppConfig = {
  apiToken?: string;
  defaultTeamId?: number;
  primaryLanguage?: string;
  baseUrl?: string;
  requestTimeoutMs?: number;
  defaultHeadersJson?: string;
};

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number") {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function fromLegacy(config: LegacyAppConfig): AppConfig {
  const result: AppConfig = {};
  const apiToken = toOptionalString(config.apiToken);
  if (apiToken) {
    result.apiToken = apiToken;
  }
  const defaultTeamId = toOptionalNumber(config.defaultTeamId);
  if (defaultTeamId !== undefined) {
    result.defaultTeamId = defaultTeamId;
  }
  const primaryLanguage = toOptionalString(config.primaryLanguage);
  if (primaryLanguage) {
    result.primaryLanguage = primaryLanguage;
  }
  const baseUrl = toOptionalString(config.baseUrl);
  if (baseUrl) {
    result.baseUrl = baseUrl;
  }
  const requestTimeoutMs = toOptionalNumber(config.requestTimeoutMs);
  if (requestTimeoutMs !== undefined) {
    result.requestTimeoutMs = requestTimeoutMs;
  }
  const defaultHeadersJson = toOptionalString(config.defaultHeadersJson);
  if (defaultHeadersJson) {
    result.defaultHeadersJson = defaultHeadersJson;
  }
  return result;
}

export function mergeConfig(input: Partial<AppConfig>): AppConfig {
  const envDefaults = fromLegacy(loadAppConfig());
  const merged: AppConfig = { ...envDefaults };
  const apiToken = toOptionalString(input.apiToken);
  if (apiToken !== undefined) {
    merged.apiToken = apiToken;
  }
  const defaultTeamId = toOptionalNumber(input.defaultTeamId);
  if (defaultTeamId !== undefined) {
    merged.defaultTeamId = defaultTeamId;
  }
  const primaryLanguage = toOptionalString(input.primaryLanguage);
  if (primaryLanguage !== undefined) {
    merged.primaryLanguage = primaryLanguage;
  }
  const baseUrl = toOptionalString(input.baseUrl);
  if (baseUrl !== undefined) {
    merged.baseUrl = baseUrl;
  }
  const requestTimeoutMs = toOptionalNumber(input.requestTimeoutMs);
  if (requestTimeoutMs !== undefined) {
    merged.requestTimeoutMs = requestTimeoutMs;
  }
  const defaultHeadersJson = toOptionalString(input.defaultHeadersJson);
  if (defaultHeadersJson !== undefined) {
    merged.defaultHeadersJson = defaultHeadersJson;
  }
  return merged;
}

export function validateConfig(cfg: AppConfig): { ok: true } | { ok: false; message: string } {
  const apiToken = toOptionalString(cfg.apiToken);
  if (!apiToken) {
    return { ok: false, message: "Missing apiToken" };
  }
  return { ok: true };
}
