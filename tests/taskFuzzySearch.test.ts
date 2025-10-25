import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import "./setup.js";
import type { RuntimeConfig } from "../src/config/runtime.js";
import { ApiCache } from "../src/infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../src/shared/KV.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { TaskSearchIndex } from "../src/application/services/TaskSearchIndex.js";
import { registerTools } from "../src/mcp/tools/registerTools.js";

type GatewayStub = Pick<ClickUpGateway, "search_docs" | "fetch_tasks_for_index" | "get_task_by_id">;

describe("task fuzzy search tools", () => {
  const runtime: RuntimeConfig = { logLevel: "info", featurePersistence: false, transport: { kind: "stdio" } };
  const server = {} as McpServer;
 
   afterEach(() => {
     vi.restoreAllMocks();
   });
 
   it("Index builds and search maps fields", async () => {
     const tasks = [
       {
         id: "T1",
         name: "Alpha task",
         description: "First task",
         url: "https://example.com/T1",
         list: { id: "L1", name: "List One" },
         space: { id: "S1", name: "Space One" },
         status: "open",
         priority: "urgent",
         assignees: [{ id: 101, username: "alice" }],
         date_updated: String(Date.now())
       },
       {
         id: "T2",
         name: "Beta note",
         url: "https://example.com/T2",
         status: "closed",
         date_updated: String(Date.now() - 1000)
       }
     ];
     const gateway: GatewayStub = {
       async search_docs() {
         return {};
       },
       async fetch_tasks_for_index(scope) {
         expect(scope).toBeUndefined();
         return tasks;
       },
       async get_task_by_id() {
         return {};
       }
     };
     const cache = new ApiCache(makeMemoryKV());
     const tools = await registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
     const tool = tools.find(entry => entry.name === "clickup_task_fuzzy_search");
     if (!tool) {
       throw new Error("Tool not found");
     }
     const result = await tool.execute({ query: "alpha", limit: 5 }, { server, runtime });
     expect(result.isError).toBe(false);
     if (result.isError) {
       throw new Error("Expected success result");
     }
    const data = result.data as {
      totalIndexed: number;
      results: Array<{
        taskId: string;
        name?: string | null;
        url: string;
        score: number | null;
      }>;
    };
     expect(data.totalIndexed).toBe(2);
     expect(data.results.length).toBeGreaterThanOrEqual(1);
     const hit = data.results[0];
     expect(hit.taskId).toBe("T1");
     expect(hit.name).toBe("Alpha task");
     expect(hit.url).toBe("https://example.com/T1");
     expect(hit.score).not.toBeNull();
   });
 
   it("ID fallback when not in results", async () => {
     const gateway: GatewayStub = {
       async search_docs() {
         return {};
       },
       async fetch_tasks_for_index() {
         return [];
       },
       async get_task_by_id(taskId) {
         expect(taskId).toBe("ABC1234");
         return {
           id: "ABC1234",
           name: "Lookup",
           url: "https://example.com/ABC1234",
           status: "open",
           date_updated: String(Date.now())
         };
       }
     };
     const cache = new ApiCache(makeMemoryKV());
     const tools = await registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
     const tool = tools.find(entry => entry.name === "clickup_task_fuzzy_search");
     if (!tool) {
       throw new Error("Tool not found");
     }
     const result = await tool.execute({ query: "ABC1234", limit: 5 }, { server, runtime });
     expect(result.isError).toBe(false);
     if (result.isError) {
       throw new Error("Expected success result");
     }
    const first = (result.data as { results: Array<{ taskId: string; matchedFields: string[]; score: number | null }> }).results[0];
     expect(first.taskId).toBe("ABC1234");
     expect(first.matchedFields).toContain("id");
     expect(first.score).toBeNull();
   });
 
   it("Deterministic sorting and union in bulk", async () => {
    const searchSpy = vi.spyOn(TaskSearchIndex.prototype, "search");
    searchSpy.mockImplementation((query: string, limit: number) => {
      void limit;
      if (query === "q1") {
        return [
          {
            item: {
              taskId: "T1",
               name: "Task One",
               url: "https://example.com/T1",
               updatedAt: "2025-01-01T00:00:00.000Z"
             },
             score: 0.6
           },
           {
             item: {
               taskId: "T2",
               name: "Task Two",
               url: "https://example.com/T2",
               updatedAt: "2025-01-02T00:00:00.000Z"
             },
             score: 0.4
           }
         ];
       }
       if (query === "q2") {
         return [
           {
             item: {
               taskId: "T2",
               name: "Task Two",
               url: "https://example.com/T2",
               updatedAt: "2025-01-03T00:00:00.000Z"
             },
             score: 0.3
           }
         ];
       }
       return [];
     });
     const gateway: GatewayStub = {
       async search_docs() {
         return {};
       },
       async fetch_tasks_for_index() {
         return [];
       },
       async get_task_by_id() {
         return {};
       }
     };
     const cache = new ApiCache(makeMemoryKV());
     const tools = await registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
     const tool = tools.find(entry => entry.name === "clickup_bulk_task_fuzzy_search");
     if (!tool) {
       throw new Error("Tool not found");
     }
     const result = await tool.execute(
       { queries: ["q1", "Q1", "q2"], options: { limit: 10, concurrency: 2 } },
       { server, runtime }
     );
     expect(result.isError).toBe(false);
     if (result.isError) {
       throw new Error("Expected success result");
     }
    const union = (result.data as {
      union: {
        results: Array<{ taskId: string }>;
        dedupedCount: number;
      };
    }).union;
     expect(union.results[0].taskId).toBe("T2");
     expect(union.dedupedCount).toBe(2);
   });
 
   it("Index TTL respected", async () => {
     let calls = 0;
     const gateway: GatewayStub = {
       async search_docs() {
         return {};
       },
       async fetch_tasks_for_index() {
         calls += 1;
         return [
           {
             id: "T1",
             name: "Gamma",
             url: "https://example.com/T1",
             date_updated: String(Date.now())
           }
         ];
       },
       async get_task_by_id() {
         return {};
       }
     };
     const cache = new ApiCache(makeMemoryKV());
     const tools = await registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
     const tool = tools.find(entry => entry.name === "clickup_task_fuzzy_search");
     if (!tool) {
       throw new Error("Tool not found");
     }
     await tool.execute({ query: "gamma", limit: 5 }, { server, runtime });
     await tool.execute({ query: "gamma", limit: 5 }, { server, runtime });
     expect(calls).toBe(1);
   });
 
   it("Truncation sets flags", async () => {
     const longName = "long ".repeat(6000);
     const gateway: GatewayStub = {
       async search_docs() {
         return {};
       },
       async fetch_tasks_for_index() {
         return [
           {
             id: "T1",
             name: longName,
             url: "https://example.com/T1",
             date_updated: String(Date.now())
           }
         ];
       },
       async get_task_by_id() {
         return {};
       }
     };
     const cache = new ApiCache(makeMemoryKV());
     const tools = await registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
     const tool = tools.find(entry => entry.name === "clickup_task_fuzzy_search");
     if (!tool) {
       throw new Error("Tool not found");
     }
     const result = await tool.execute({ query: "long", limit: 1 }, { server, runtime });
     expect(result.isError).toBe(false);
     if (result.isError) {
       throw new Error("Expected success result");
     }
    const data = result.data as { truncated?: boolean; guidance?: string };
     expect(data.truncated).toBe(true);
     expect(data.guidance).toBe("Output trimmed to character_limit");
   });
 });
