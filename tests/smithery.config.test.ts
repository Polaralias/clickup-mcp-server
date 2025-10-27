import { afterAll, beforeEach, describe, expect, it } from "vitest";
import createServer from "../src/index.js";
import { getServerContext } from "../src/server/factory.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.CLICKUP_TOKEN;
  delete process.env.CLICKUP_DEFAULT_TEAM_ID;
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("smithery command context", () => {
  it("prefers auth secrets when available", async () => {
    const server = createServer({
      auth: {
        CLICKUP_TOKEN: "token-from-auth",
      },
    });

    const context = getServerContext(server);
    expect(context.session.apiToken).toBe("token-from-auth");

    await server.close();
  });

  it("unwraps structured secret values", async () => {
    const server = createServer({
      auth: {
        CLICKUP_TOKEN: { value: "structured-token" },
        CLICKUP_DEFAULT_TEAM_ID: 345,
      },
    });

    const context = getServerContext(server);
    expect(context.session.apiToken).toBe("structured-token");
    expect(context.session.defaultTeamId).toBe(345);

    await server.close();
  });

  it("accepts auth scheme overrides from Smithery config", async () => {
    const server = createServer({
      auth: {
        CLICKUP_TOKEN: "token-from-auth",
      },
      config: {
        authScheme: "oauth",
      },
    });

    const context = getServerContext(server);
    expect(context.session.authScheme).toBe("oauth");

    await server.close();
  });
});
