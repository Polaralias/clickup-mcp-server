import type { SessionConfig } from "../../src/shared/config/schema.js";

const baseSession: SessionConfig = {
  apiToken: "token",
  authScheme: "auto",
  baseUrl: "https://api.clickup.com",
  defaultTeamId: 0,
  requestTimeout: 30,
  defaultHeaders: {}
};

export function createTestSession(overrides?: Partial<SessionConfig>): SessionConfig {
  return {
    ...baseSession,
    ...overrides,
    defaultHeaders: { ...baseSession.defaultHeaders, ...(overrides?.defaultHeaders ?? {}) }
  };
}
