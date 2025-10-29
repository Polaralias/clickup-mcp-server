import { describe, expect, it } from "vitest";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import "./setup.js";
import type { RuntimeConfig } from "../src/config/runtime.js";
import { ApiCache } from "../src/infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../src/shared/KV.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { registerTools } from "../src/mcp/tools/registerTools.js";

type GatewayStub = Pick<
  ClickUpGateway,
  | "search_docs"
  | "fetch_tasks_for_index"
  | "get_task_by_id"
  | "list_workspaces"
  | "list_spaces"
  | "list_folders"
  | "list_lists_under"
  | "list_tags_for_space"
  | "list_members"
>;

describe("members tools", () => {
  const runtime: RuntimeConfig = {
    logLevel: "info",
    featurePersistence: false,
    transport: { kind: "stdio" },
    httpInitializeTimeoutMs: 45_000
  };
  const server = {} as McpServer;

  function buildGateway(overrides: Partial<GatewayStub>): GatewayStub {
    return {
      async search_docs() {
        return { total: 0, items: [] };
      },
      async fetch_tasks_for_index() {
        return [];
      },
      async get_task_by_id() {
        return {};
      },
      async list_workspaces() {
        return { teams: [] };
      },
      async list_spaces() {
        return { spaces: [] };
      },
      async list_folders() {
        return { folders: [] };
      },
      async list_lists_under() {
        return { lists: [] };
      },
      async list_tags_for_space() {
        return { tags: [] };
      },
      async list_members() {
        return { members: [] };
      },
      ...overrides
    };
  }

  it("list members maps email and username with nulls", async () => {
    const gateway = buildGateway({
      async list_members(teamId, page, limit) {
        expect(teamId).toBe(5);
        expect(page).toBe(0);
        expect(limit).toBe(20);
        return {
          total: 1,
          members: [
            {
              user: { id: 9, username: "Alpha", email: "", initials: "A" }
            }
          ]
        };
      }
    });
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
    const tool = tools.find(entry => entry.name === "clickup_list_members");
    if (!tool) {
      throw new Error("Tool not found");
    }
    const result = await tool.execute({ teamId: 5, limit: 20, page: 0 }, { server, runtime });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const data = result.data as any;
    expect(data.results[0].username).toBe("Alpha");
    expect(data.results[0].email).toBeNull();
    expect(data.results[0].initials).toBe("A");
  });

  it("resolve members returns up to five substring matches", async () => {
    const members = [
      { user: { id: 1, username: "Alpha", email: "alpha@example.com", initials: "AA" } },
      { user: { id: 2, username: "Alfred", email: "alfred@example.com", initials: "AB" } },
      { user: { id: 3, username: "Alice", email: "alice@example.com", initials: "AC" } },
      { user: { id: 4, username: "Alana", email: "alana@example.com", initials: "AD" } },
      { user: { id: 5, username: "Alonzo", email: "alonzo@example.com", initials: "AE" } },
      { user: { id: 6, username: "Albert", email: "albert@example.com", initials: "AF" } }
    ];
    const gateway = buildGateway({
      async list_members(teamId, page, limit) {
        expect(teamId).toBe(5);
        expect(page).toBe(0);
        expect(limit).toBe(100);
        return { total: members.length, members };
      }
    });
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
    const tool = tools.find(entry => entry.name === "clickup_resolve_members");
    if (!tool) {
      throw new Error("Tool not found");
    }
    const result = await tool.execute({ teamId: 5, queries: ["al"] }, { server, runtime });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const data = result.data as any;
    expect(data.resolved.length).toBe(1);
    const matches = data.resolved[0].matches;
    expect(matches.length).toBe(5);
    for (const match of matches) {
      expect(match.username.toLowerCase()).toContain("al");
    }
  });
});
