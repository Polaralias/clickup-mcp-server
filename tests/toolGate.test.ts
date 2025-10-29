import { describe, expect, it } from "vitest";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import "./setup.js";
import type { RuntimeConfig } from "../src/config/runtime.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { ApiCache } from "../src/infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../src/shared/KV.js";
import { registerTools } from "../src/mcp/tools/registerTools.js";
import { createToolGate, filterToolsInPlace, TOOL_ALLOW_ENV_KEY } from "../src/shared/config/toolGate.js";

type GatewayStub = Pick<ClickUpGateway, "search_docs" | "fetch_tasks_for_index" | "get_task_by_id">;

describe("tool gating", () => {
  const runtime: RuntimeConfig = {
    logLevel: "info",
    featurePersistence: false,
    transport: { kind: "stdio" },
    httpInitializeTimeoutMs: 45_000
  };
  const server = {} as McpServer;

  async function createTools() {
    const gateway: GatewayStub = {
      async search_docs() {
        return { total: 0, items: [] };
      },
      async fetch_tasks_for_index() {
        return [];
      },
      async get_task_by_id() {
        return {};
      }
    };
    const cache = new ApiCache(makeMemoryKV());
    return registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
  }

  it("applies allow lists", async () => {
    const tools = await createTools();
    const gate = createToolGate({ allowList: ["health", "tool_catalogue"] });
    const { kept, skipped } = filterToolsInPlace(tools, gate);
    expect(skipped.some(entry => entry.tool.name === "clickup_doc_search")).toBe(true);
    expect(skipped.every(entry => entry.reason === "not_allowed" || entry.reason === "denied")).toBe(true);
    const names = kept.map(tool => tool.name);
    expect(names).toEqual(["health", "tool_catalogue"]);
    const catalogue = kept.find(tool => tool.name === "tool_catalogue");
    if (!catalogue) {
      throw new Error("Expected tool_catalogue to remain available");
    }
    const result = await catalogue.execute({}, { server, runtime });
    if (result.isError) {
      throw new Error("Expected catalogue success");
    }
    const data = result.data as { tools: Array<{ name: string }> };
    expect(data.tools.map(entry => entry.name)).toEqual(["health", "tool_catalogue"]);
  });

  it("applies deny lists even when allowed", async () => {
    const tools = await createTools();
    const gate = createToolGate({
      allowList: ["health", "tool_catalogue"],
      denyList: ["tool_catalogue"]
    });
    const { kept, skipped } = filterToolsInPlace(tools, gate);
    expect(kept.map(tool => tool.name)).toEqual(["health"]);
    const denied = skipped.find(entry => entry.tool.name === "tool_catalogue");
    expect(denied?.reason).toBe("denied");
  });

  it("falls back to environment lists and honours overrides", async () => {
    const env = {
      ...process.env,
      [TOOL_ALLOW_ENV_KEY]: "health tool_catalogue"
    };
    const toolsFromEnv = await createTools();
    const gateFromEnv = createToolGate({ env });
    const { kept: keptFromEnv } = filterToolsInPlace(toolsFromEnv, gateFromEnv);
    expect(keptFromEnv.map(tool => tool.name)).toEqual(["health", "tool_catalogue"]);

    const overrideTools = await createTools();
    const overrideGate = createToolGate({ env, allowList: ["health"], denyList: ["clickup_doc_search"] });
    const { kept: keptOverride, skipped: skippedOverride } = filterToolsInPlace(overrideTools, overrideGate);
    expect(keptOverride.map(tool => tool.name)).toEqual(["health"]);
    expect(skippedOverride.some(entry => entry.tool.name === "clickup_doc_search" && entry.reason === "denied")).toBe(true);
    expect(skippedOverride.some(entry => entry.tool.name === "tool_catalogue" && entry.reason === "not_allowed")).toBe(true);
  });
});
