import type { SessionConfig } from "../../src/shared/config/schema.js";

export function createTestSession(overrides?: Partial<SessionConfig>): SessionConfig {
  return {
    apiToken: overrides?.apiToken ?? "",
    authScheme: overrides?.authScheme ?? "auto",
    baseUrl: overrides?.baseUrl ?? "https://api.clickup.com",
    defaultTeamId: overrides?.defaultTeamId,
    requestTimeout: overrides?.requestTimeout ?? 30,
    defaultHeaders: overrides?.defaultHeaders ?? {}
  };
}
