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

describe("resolve tools", () => {
  const runtime: RuntimeConfig = { logLevel: "info", featurePersistence: false, transport: { kind: "stdio" } };
  const server = {} as McpServer;

  function baseGateway(overrides: Partial<GatewayStub>): GatewayStub {
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

  it("resolve exact path to IDs", async () => {
    const gateway = baseGateway({
      async list_spaces(teamId, page) {
        expect(teamId).toBe(11);
        expect(page).toBe(0);
        return { total: 1, spaces: [{ id: "S1", name: "Alpha" }] };
      },
      async list_folders(spaceId) {
        expect(spaceId).toBe("S1");
        return { total: 1, folders: [{ id: "F1", name: "Team" }] };
      },
      async list_lists_under(parentType, parentId) {
        if (parentType === "space") {
          return { total: 0, lists: [] };
        }
        expect(parentType).toBe("folder");
        expect(parentId).toBe("F1");
        return { total: 1, lists: [{ id: "L1", name: "Stories" }] };
      }
    });
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
    const tool = tools.find(entry => entry.name === "clickup_resolve_path_to_ids");
    if (!tool) {
      throw new Error("Tool not found");
    }
    const result = await tool.execute({ teamId: 11, path: "Alpha/Team/Stories" }, { server, runtime });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const data = result.data as any;
    expect(data.space.id).toBe("S1");
    expect(data.folder.id).toBe("F1");
    expect(data.list.id).toBe("L1");
  });

  it("resolve ambiguous space returns disambiguation", async () => {
    const gateway = baseGateway({
      async list_spaces() {
        return {
          total: 2,
          spaces: [
            { id: "S1", name: "Alpha" },
            { id: "S2", name: "alpha" }
          ]
        };
      }
    });
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
    const tool = tools.find(entry => entry.name === "clickup_resolve_path_to_ids");
    if (!tool) {
      throw new Error("Tool not found");
    }
    const result = await tool.execute({ teamId: 1, path: "Alpha" }, { server, runtime });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const data = result.data as any;
    expect(data.space).toBeUndefined();
    expect(data.disambiguation.space.length).toBe(2);
    expect(data.guidance).toContain("Multiple matches");
  });

  it("resolve path with missing folder returns space and guidance", async () => {
    const gateway = baseGateway({
      async list_spaces() {
        return { total: 1, spaces: [{ id: "S2", name: "Beta" }] };
      },
      async list_folders(spaceId) {
        expect(spaceId).toBe("S2");
        return { total: 1, folders: [{ id: "F2", name: "Roadmap" }] };
      },
      async list_lists_under(parentType, parentId) {
        if (parentType === "space") {
          return { total: 0, lists: [] };
        }
        expect(parentType).toBe("folder");
        expect(parentId).toBe("F2");
        return { total: 1, lists: [{ id: "L2", name: "Ideas" }] };
      }
    });
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
    const tool = tools.find(entry => entry.name === "clickup_resolve_path_to_ids");
    if (!tool) {
      throw new Error("Tool not found");
    }
    const result = await tool.execute({ teamId: 2, path: "Beta/Missing" }, { server, runtime });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const data = result.data as any;
    expect(data.space.id).toBe("S2");
    expect(data.folder).toBeUndefined();
    expect(data.disambiguation.folder.length).toBeGreaterThan(0);
    expect(data.guidance).toContain("Folder");
  });
});
