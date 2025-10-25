import { describe, expect, it } from "vitest";
import "./setup.js";
import { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import type { ClickUpGatewayConfig } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { HttpClient } from "../src/infrastructure/http/HttpClient.js";
import type { HttpRequest, HttpResponse } from "../src/infrastructure/http/HttpClient.js";
import { ApiCache } from "../src/infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../src/shared/KV.js";

describe("ClickUpGateway", () => {
  const config: ClickUpGatewayConfig = {
    baseUrl: "https://api.clickup.com",
    token: "tok123",
    authScheme: "personal_token",
    timeoutMs: 5000,
    defaultTeamId: 101
  };

  it("uses cache when searching docs", async () => {
    const kv = makeMemoryKV();
    const cache = new ApiCache(kv);
    const calls: HttpRequest[] = [];
    const client = new HttpClient({
      baseUrl: config.baseUrl,
      transport: async request => {
        calls.push(request);
        const response: HttpResponse = {
          status: 200,
          headers: {},
          data: { total: 1, items: [{ id: "d1" }] }
        };
        return response;
      }
    });
    const gateway = new ClickUpGateway(client, cache, config);
    const first = await gateway.search_docs(7, "roadmap", 20, 0);
    const second = await gateway.search_docs(7, "roadmap", 20, 0);
    expect(first).toEqual({ total: 1, items: [{ id: "d1" }] });
    expect(second).toEqual(first);
    expect(calls.length).toBe(1);
  });

  it("forwards content_format and isolates cache entries per format", async () => {
    const kv = makeMemoryKV();
    const cache = new ApiCache(kv);
    const calls: HttpRequest[] = [];
    const responses: HttpResponse[] = [
      { status: 200, headers: {}, data: { total: 0, items: [], format: "md" } },
      { status: 200, headers: {}, data: { total: 0, items: [], format: "html" } }
    ];
    const client = new HttpClient({
      baseUrl: config.baseUrl,
      transport: async request => {
        calls.push(request);
        const response = responses.shift();
        if (!response) {
          throw new Error("No more responses");
        }
        return response;
      }
    });
    const gateway = new ClickUpGateway(client, cache, config);
    const mdFirst = await gateway.search_docs(7, "roadmap", 20, 0, { content_format: "text/md" });
    const mdSecond = await gateway.search_docs(7, "roadmap", 20, 0, { content_format: "text/md" });
    const html = await gateway.search_docs(7, "roadmap", 20, 0, { content_format: "text/html" });
    expect(mdFirst).toEqual({ total: 0, items: [], format: "md" });
    expect(mdSecond).toEqual(mdFirst);
    expect(html).toEqual({ total: 0, items: [], format: "html" });
    expect(calls.length).toBe(2);
    const firstUrl = new URL(calls[0].url);
    const secondUrl = new URL(calls[1].url);
    expect(firstUrl.searchParams.get("content_format")).toBe("text/md");
    expect(secondUrl.searchParams.get("content_format")).toBe("text/html");
  });

  it("paginates task fetch and stops when empty", async () => {
    const kv = makeMemoryKV();
    const cache = new ApiCache(kv);
    const calls: HttpRequest[] = [];
    const responses: HttpResponse[] = [
      { status: 200, headers: {}, data: { tasks: Array.from({ length: 100 }, (_, index) => ({ id: `t${index}` })) } },
      { status: 200, headers: {}, data: { tasks: [] } }
    ];
    const client = new HttpClient({
      baseUrl: config.baseUrl,
      transport: async request => {
        calls.push(request);
        const response = responses.shift();
        if (!response) {
          throw new Error("No more responses");
        }
        return response;
      }
    });
    const gateway = new ClickUpGateway(client, cache, config);
    const tasks = await gateway.fetch_tasks_for_index();
    expect(tasks.length).toBe(100);
    expect(calls.length).toBe(2);
  });

  it("forwards personal token when auto scheme chooses it", async () => {
    const kv = makeMemoryKV();
    const cache = new ApiCache(kv);
    const calls: HttpRequest[] = [];
    const client = new HttpClient({
      baseUrl: config.baseUrl,
      transport: async request => {
        calls.push(request);
        const response: HttpResponse = { status: 200, headers: {}, data: { id: "task" } };
        return response;
      }
    });
    const autoConfig: ClickUpGatewayConfig = { ...config, authScheme: "auto", token: "tok123" };
    const gateway = new ClickUpGateway(client, cache, autoConfig);
    const task = await gateway.get_task_by_id("task123");
    expect(task).toEqual({ id: "task" });
    expect(calls.length).toBe(1);
    expect(calls[0].headers?.Authorization).toBe("tok123");
  });
});
