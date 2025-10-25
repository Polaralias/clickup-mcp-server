import { describe, expect, it, vi } from "vitest";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import "./setup.js";
import type { RuntimeConfig } from "../src/config/runtime.js";
import { ApiCache } from "../src/infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../src/shared/KV.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { registerTools } from "../src/mcp/tools/registerTools.js";

type GatewayStub = Pick<ClickUpGateway, "search_docs" | "fetch_tasks_for_index" | "get_task_by_id" | "get_doc_page">;

describe("doc search tools", () => {
  const runtime: RuntimeConfig = { logLevel: "info", featurePersistence: false };
  const server = {} as McpServer;

  it("Single search maps fields and pagination", async () => {
    const gateway: GatewayStub = {
      async search_docs(workspaceId, query, limit, page) {
        expect(workspaceId).toBe(1);
        expect(query).toBe("q");
        expect(limit).toBe(1);
        expect(page).toBe(0);
        return {
          total: 3,
          items: [
            {
              doc_id: "D1",
              page_id: "P1",
              title: "A",
              snippet: "s",
              url: "u",
              score: 0.9,
              updated_at: "2025-01-02T00:00:00.000Z",
              visibility: "PUBLIC"
            }
          ]
        };
      },
      async fetch_tasks_for_index() {
        return [];
      },
      async get_task_by_id() {
        return {};
      },
      async get_doc_page() {
        return {};
      }
    };
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(server, runtime, { gateway: gateway as ClickUpGateway, cache });
    const tool = tools.find(entry => entry.name === "clickup_doc_search");
    if (!tool) {
      throw new Error("Tool not found");
    }
    const result = await tool.execute({ workspaceId: 1, query: "q", limit: 1, page: 0 }, { server, runtime });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const data = result.data as any;
    expect(data.total).toBe(3);
    expect(data.page).toBe(0);
    expect(data.limit).toBe(1);
    expect(data.hasMore).toBe(true);
    expect(data.results.length).toBe(1);
    const item = data.results[0];
    expect(item.docId).toBe("D1");
    expect(item.pageId).toBe("P1");
    expect(item.title).toBe("A");
    expect(item.snippet).toBe("s");
    expect(item.url).toBe("u");
    expect(item.score).toBe(0.9);
    expect(item.updatedAt).toBe("2025-01-02T00:00:00.000Z");
    expect(item.visibility).toBe("PUBLIC");
  });

  it("expands inline page content when requested", async () => {
    const get_doc_page = vi
      .fn()
      .mockResolvedValueOnce({ content: "<p>One</p>" })
      .mockResolvedValueOnce({ content: "<p>Two</p>" });
    const gateway: GatewayStub = {
      async search_docs() {
        return {
          total: 3,
          items: [
            { doc_id: "D1", page_id: "P1", title: "First", snippet: "a", url: "u1" },
            { doc_id: "D2", page_id: "P2", title: "Second", snippet: "b", url: "u2" },
            { doc_id: "D3", page_id: "P3", title: "Third", snippet: "c", url: "u3" }
          ]
        };
      },
      async fetch_tasks_for_index() {
        return [];
      },
      async get_task_by_id() {
        return {};
      },
      get_doc_page
    };
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(server, runtime, { gateway: gateway as ClickUpGateway, cache });
    const tool = tools.find(entry => entry.name === "clickup_doc_search");
    if (!tool) {
      throw new Error("Tool not found");
    }
    const result = await tool.execute(
      {
        workspaceId: 1,
        query: "expand",
        limit: 3,
        page: 0,
        expandPages: true,
        pageBody: { contentFormat: "text/html", limit: 2 }
      },
      { server, runtime }
    );
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    expect(get_doc_page).toHaveBeenCalledTimes(2);
    expect(get_doc_page).toHaveBeenNthCalledWith(1, 1, "D1", "P1", "text/html");
    expect(get_doc_page).toHaveBeenNthCalledWith(2, 1, "D2", "P2", "text/html");
    const items = result.data.results as any[];
    expect(items[0].content).toBe("<p>One</p>");
    expect(items[1].content).toBe("<p>Two</p>");
    expect(items[2].content).toBeUndefined();
  });

  it("Bulk search deduplicates and sorts", async () => {
    const gateway: GatewayStub = {
      async search_docs(_workspaceId, query) {
        if (query === "q1") {
          return {
            total: 2,
            items: [
              { doc_id: "D1", page_id: "P1", title: "Page1", snippet: "first", url: "u1", score: 0.6, updated_at: "2025-01-01T00:00:00.000Z" },
              { doc_id: "D2", page_id: "P2", title: "Page2", snippet: "second", url: "u2", score: 0.2, updated_at: "2025-01-01T00:00:00.000Z" }
            ]
          };
        }
        if (query === "q2") {
          return {
            total: 1,
            items: [
              { doc_id: "D2", page_id: "P2", title: "Page2", snippet: "better", url: "u2", score: 0.8, updated_at: "2025-01-02T00:00:00.000Z" }
            ]
          };
        }
        return { total: 0, items: [] };
      },
      async fetch_tasks_for_index() {
        return [];
      },
      async get_task_by_id() {
        return {};
      },
      async get_doc_page() {
        return {};
      }
    };
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(server, runtime, { gateway: gateway as ClickUpGateway, cache });
    const tool = tools.find(entry => entry.name === "clickup_bulk_doc_search");
    if (!tool) {
      throw new Error("Tool not found");
    }
    const result = await tool.execute(
      { workspaceId: 1, queries: ["Q1", "q1", "q2"], options: { limit: 10, concurrency: 3 } },
      { server, runtime }
    );
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const data = result.data as any;
    expect(Object.keys(data.perQuery).sort()).toEqual(["q1", "q2"]);
    expect(data.union.results.length).toBe(2);
    expect(data.union.dedupedCount).toBe(2);
    expect(data.union.results[0].pageId).toBe("P2");
    expect(data.union.results[1].pageId).toBe("P1");
  });

  it("Truncation sets flags", async () => {
    const longSnippet = "x".repeat(30000);
    const gateway: GatewayStub = {
      async search_docs() {
        return {
          total: 1,
          items: [
            {
              doc_id: "D1",
              page_id: "P1",
              title: "Long",
              snippet: longSnippet,
              url: "u",
              score: 0.1,
              updated_at: "2025-01-01T00:00:00.000Z"
            }
          ]
        };
      },
      async fetch_tasks_for_index() {
        return [];
      },
      async get_task_by_id() {
        return {};
      },
      async get_doc_page() {
        return {};
      }
    };
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(server, runtime, { gateway: gateway as ClickUpGateway, cache });
    const tool = tools.find(entry => entry.name === "clickup_doc_search");
    if (!tool) {
      throw new Error("Tool not found");
    }
    const result = await tool.execute({ workspaceId: 1, query: "long", limit: 1, page: 0 }, { server, runtime });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const data = result.data as any;
    expect(data.truncated).toBe(true);
    expect(typeof data.guidance).toBe("string");
    expect(data.guidance).toBe("contentFormat:text/md; Output trimmed to character_limit");
  });

  it("Bulk options map to processor retries", async () => {
    let attempts = 0;
    const gateway: GatewayStub = {
      async search_docs(workspaceId, query, limit, page) {
        expect(workspaceId).toBe(1);
        expect(limit).toBe(10);
        expect(page).toBe(0);
        if (query === "retry") {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("temporary");
          }
          return {
            total: 1,
            items: [
              {
                doc_id: "D1",
                page_id: "P1",
                title: "Doc",
                snippet: "content",
                url: "u1",
                score: 0.5,
                updated_at: "2025-01-01T00:00:00.000Z"
              }
            ]
          };
        }
        return { total: 0, items: [] };
      },
      async fetch_tasks_for_index() {
        return [];
      },
      async get_task_by_id() {
        return {};
      },
      async get_doc_page() {
        return {};
      }
    };
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(server, runtime, { gateway: gateway as ClickUpGateway, cache });
    const tool = tools.find(entry => entry.name === "clickup_bulk_doc_search");
    if (!tool) {
      throw new Error("Tool not found");
    }
    const events: { event: string }[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void) => {
      const text =
        typeof chunk === "string"
          ? chunk
          : Buffer.from(chunk).toString(typeof encoding === "string" ? encoding : "utf8");
      for (const line of text.split("\n")) {
        if (!line) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as { msg?: string; event?: string };
          if (parsed.msg === "batch_event" && typeof parsed.event === "string") {
            events.push({ event: parsed.event });
          }
        } catch {}
      }
      const callback = typeof encoding === "function" ? encoding : cb;
      if (callback) {
        callback(null);
      }
      return true;
    }) as unknown as typeof process.stdout.write;
    try {
      const promise = tool.execute(
        {
          workspaceId: 1,
          queries: ["retry"],
          options: { limit: 10, retryCount: 1, retryDelayMs: 200, exponentialBackoff: true, concurrency: 1 }
        },
        { server, runtime }
      );
      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;
      expect(result.isError).toBe(false);
      if (result.isError) {
        throw new Error("Expected success result");
      }
      const data = result.data as any;
      expect(Object.keys(data.perQuery)).toEqual(["retry"]);
      expect(data.union.results.length).toBe(1);
      expect(attempts).toBe(2);
      const retried = events.filter(entry => entry.event === "retried");
      expect(retried.length).toBe(1);
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
