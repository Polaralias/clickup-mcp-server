import { afterAll, beforeEach, describe, expect, it } from "vitest";
import createServer from "../src/index.js";
import { createToolGate } from "../src/shared/config/toolGate.js";
import { getServerContext, waitForServerReady } from "../src/server/factory.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MCP_TOOLS_ALLOW;
  delete process.env.MCP_TOOLS_ALLOW_LIST;
  delete process.env.MCP_TOOL_ALLOW;
  delete process.env.MCP_TOOL_ALLOW_LIST;
  delete process.env.MCP_TOOLS_DENY;
  delete process.env.MCP_TOOLS_DENY_LIST;
  delete process.env.MCP_TOOL_DENY;
  delete process.env.MCP_TOOL_DENY_LIST;
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("tool gate helper", () => {
  it("parses allow and deny lists from the environment", () => {
    const gate = createToolGate({
      env: {
        MCP_TOOLS_ALLOW: "alpha,beta",
        MCP_TOOLS_DENY: "gamma"
      }
    });
    expect(gate.allowList).toEqual(["alpha", "beta"]);
    expect(gate.denyList).toEqual(["gamma"]);
    const tools = [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }];
    const filtered = gate.filter(tools);
    expect(filtered.map(tool => tool.name)).toEqual(["alpha", "beta"]);
  });

  it("prefers explicit overrides over environment values", () => {
    const gate = createToolGate({
      env: {
        MCP_TOOLS_ALLOW: "alpha,beta",
        MCP_TOOLS_DENY: "gamma"
      },
      overrides: {
        allow: ["delta"],
        deny: ["beta"]
      }
    });
    expect(gate.allowList).toEqual(["delta"]);
    expect(gate.denyList).toEqual(["beta"]);
    const tools = [{ name: "delta" }, { name: "beta" }];
    const filtered = gate.filter(tools);
    expect(filtered.map(tool => tool.name)).toEqual(["delta"]);
  });
});

describe("tool gate integration", () => {
  it("filters tools using an allow list from the environment", async () => {
    process.env.MCP_TOOLS_ALLOW = "health,tool_catalogue";
    const server = await createServer();
    await waitForServerReady(server);
    const context = getServerContext(server);
    expect(context.tools.map(tool => tool.name)).toEqual(["health", "tool_catalogue"]);
    const catalogue = context.toolMap.get("tool_catalogue");
    expect(catalogue).toBeDefined();
    if (!catalogue) {
      throw new Error("tool_catalogue not available");
    }
    const outcome = await catalogue.execute({}, { server: context.notifier, runtime: context.runtime });
    if (outcome.isError) {
      throw new Error("tool_catalogue returned error");
    }
    const catalogueNames = outcome.data.tools.map(entry => entry.name);
    expect(catalogueNames).toEqual(["health", "tool_catalogue"]);
    await server.close();
  });

  it("applies smithery config overrides when gating tools", async () => {
    const server = await createServer({
      config: {
        allowTools: ["health", "tool_catalogue"],
        denyTools: ["health"]
      }
    });
    await waitForServerReady(server);
    const context = getServerContext(server);
    expect(context.tools.map(tool => tool.name)).toEqual(["tool_catalogue"]);
    await server.close();
  });
});
