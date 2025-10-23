import { describe, expect, it } from "vitest";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import "./setup.js";
import type { RuntimeConfig } from "../src/config/runtime.js";
import { PROJECT_NAME, CHARACTER_LIMIT } from "../src/config/constants.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { ApiCache } from "../src/infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../src/shared/KV.js";
import { registerTools } from "../src/mcp/tools/registerTools.js";
import { buildCatalogue } from "../src/mcp/tools/catalogue.js";
import type { ToolDef } from "../src/mcp/tools/catalogue.js";

type GatewayStub = Pick<ClickUpGateway, "search_docs" | "fetch_tasks_for_index" | "get_task_by_id">;

describe("tool catalogue", () => {
  const runtime: RuntimeConfig = { logLevel: "info", featurePersistence: false };
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
    return registerTools(server, runtime, { gateway: gateway as ClickUpGateway, cache });
  }

  it("Includes known tools and metadata", async () => {
    const tools = await createTools();
    const tool = tools.find(entry => entry.name === "tool_catalogue");
    if (!tool) {
      throw new Error("tool_catalogue not registered");
    }
    const result = await tool.execute({}, { server, runtime });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const data = result.data as any;
    expect(data.service).toBe(PROJECT_NAME);
    expect(Array.isArray(data.tools)).toBe(true);
    const names = data.tools.map((entry: any) => entry.name);
    expect(names).toContain("health");
    expect(names).toContain("clickup_doc_search");
    for (const entry of data.tools) {
      expect(typeof entry.annotations.readOnlyHint).toBe("boolean");
      expect(typeof entry.annotations.idempotentHint).toBe("boolean");
      expect(typeof entry.annotations.destructiveHint).toBe("boolean");
    }
  });

  it("Pagination flags for doc tools", async () => {
    const tools = await createTools();
    const tool = tools.find(entry => entry.name === "tool_catalogue");
    if (!tool) {
      throw new Error("tool_catalogue not registered");
    }
    const result = await tool.execute({}, { server, runtime });
    if (result.isError) {
      throw new Error("Expected catalogue success");
    }
    const data = result.data as any;
    const docItem = data.tools.find((entry: any) => entry.name === "clickup_doc_search");
    const taskItem = data.tools.find((entry: any) => entry.name === "clickup_task_fuzzy_search");
    if (!docItem || !taskItem) {
      throw new Error("Expected known tools in catalogue");
    }
    expect(docItem.pagination.supports).toBe(true);
    expect(docItem.pagination.fields).toEqual(expect.arrayContaining(["limit", "page"]));
    expect(taskItem.pagination.supports).toBe(false);
  });

  it("Truncation triggers", () => {
    const longDescription = "x".repeat(CHARACTER_LIMIT * 2);
    const tools: ToolDef[] = [
      { name: "very_long", description: longDescription, annotations: { readOnlyHint: true } }
    ];
    const { payload } = buildCatalogue(PROJECT_NAME, "0.0.0-test", CHARACTER_LIMIT, tools);
    expect(payload.truncated).toBe(true);
    expect(payload.guidance).toBe("Output trimmed to character_limit");
  });
});
