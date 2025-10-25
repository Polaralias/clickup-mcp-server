export type AppConfig = {
  apiToken?: string;
  authScheme?: string;
  baseUrl?: string;
  defaultTeamId?: number;
  requestTimeout?: number;
  defaultHeaders?: Record<string, string>;
};

function toOptionalString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
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

function parseHeaderMap(value: string | undefined): Record<string, string> | undefined {
  const raw = toOptionalString(value);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const normalised: Record<string, string> = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (typeof entry === "string") {
        normalised[key] = entry;
      } else if (entry !== undefined && entry !== null) {
        normalised[key] = String(entry);
      }
    }
    return Object.keys(normalised).length > 0 ? normalised : undefined;
  } catch {
    return undefined;
  }
}

export function fromEnv(): AppConfig {
  const apiToken = toOptionalString(process.env.CLICKUP_TOKEN);
  const defaultTeamId = parseOptionalNumber(process.env.CLICKUP_DEFAULT_TEAM_ID);
  const authScheme = toOptionalString(process.env.CLICKUP_AUTH_SCHEME);
  const baseUrl = toOptionalString(process.env.CLICKUP_BASE_URL);
  const requestTimeout = parseOptionalNumber(process.env.REQUEST_TIMEOUT_MS);
  const primaryLanguage = toOptionalString(process.env.CLICKUP_PRIMARY_LANGUAGE);
  const headers = parseHeaderMap(process.env.DEFAULT_HEADERS_JSON) ?? {};
  if (primaryLanguage && !headers["Accept-Language"]) {
    headers["Accept-Language"] = primaryLanguage;
  }
  const defaultHeaders = Object.keys(headers).length > 0 ? headers : undefined;
  return { apiToken, authScheme, baseUrl, defaultTeamId, requestTimeout, defaultHeaders };
}

export function validateOrThrow(config: AppConfig): void {
  if (!config.apiToken) {
    throw new Error("Missing ClickUp API token");
  }
  const teamId = config.defaultTeamId;
  if (teamId === undefined || !Number.isFinite(teamId)) {
    throw new Error("Missing or invalid default team id");
  }
}
