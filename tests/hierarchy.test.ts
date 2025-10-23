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

describe("hierarchy tools", () => {
  const runtime: RuntimeConfig = { logLevel: "info", featurePersistence: false };
  const server = {} as McpServer;

  function buildBaseGateway(overrides: Partial<GatewayStub>): GatewayStub {
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

  it("spaces list maps fields, computes hasMore using limit", async () => {
    const gateway = buildBaseGateway({
      async list_spaces(teamId, page, limit, includeArchived) {
        expect(teamId).toBe(7);
        expect(page).toBe(0);
        expect(limit).toBe(1);
        expect(includeArchived).toBe(false);
        return {
          total: 3,
          spaces: [
            {
              id: "S1",
              name: "Alpha",
              private: true,
              archived: false
            }
          ]
        };
      }
    });
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
    const tool = tools.find(entry => entry.name === "clickup_list_spaces");
    if (!tool) {
      throw new Error("Tool not found");
    }
    const result = await tool.execute({ teamId: 7, limit: 1, page: 0 }, { server, runtime });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const data = result.data as any;
    expect(data.total).toBe(3);
    expect(data.page).toBe(0);
    expect(data.limit).toBe(1);
    expect(data.hasMore).toBe(true);
    expect(data.results[0].private).toBe(true);
    expect(data.results[0].archived).toBe(false);
  });

  it("lists under folder maps IDs and names", async () => {
    const gateway = buildBaseGateway({
      async list_lists_under(parentType, parentId, page, limit, includeArchived) {
        expect(parentType).toBe("folder");
        expect(parentId).toBe("F1");
        expect(page).toBe(0);
        expect(limit).toBe(2);
        expect(includeArchived).toBe(false);
        return {
          total: 1,
          lists: [
            {
              id: "L1",
              name: "Main",
              folder_id: "F1",
              space_id: "S1",
              archived: false
            }
          ]
        };
      }
    });
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
    const tool = tools.find(entry => entry.name === "clickup_list_lists");
    if (!tool) {
      throw new Error("Tool not found");
    }
    const result = await tool.execute(
      { parentType: "folder", parentId: "F1", limit: 2, page: 0, includeArchived: false },
      { server, runtime }
    );
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const data = result.data as any;
    expect(data.results[0].folderId).toBe("F1");
    expect(data.results[0].spaceId).toBe("S1");
    expect(data.results[0].name).toBe("Main");
  });

  it("tags for space returns array of names and colours", async () => {
    const gateway = buildBaseGateway({
      async list_tags_for_space(spaceId) {
        expect(spaceId).toBe("S1");
        return {
          spaceId: "S1",
          tags: [
            { name: "Urgent", tag_fg: "#fff", tag_bg: "#000" },
            { name: "Backlog" }
          ]
        };
      }
    });
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
    const tool = tools.find(entry => entry.name === "clickup_list_tags_for_space");
    if (!tool) {
      throw new Error("Tool not found");
    }
    const result = await tool.execute({ spaceId: "S1" }, { server, runtime });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const data = result.data as any;
    expect(data.spaceId).toBe("S1");
    expect(data.results.length).toBe(2);
    expect(data.results[0].tag_fg).toBe("#fff");
    expect(data.results[1].tag_bg).toBeUndefined();
  });

  it("overview builds tree and truncates long names", async () => {
    const longName = "x".repeat(28000);
    const gateway = buildBaseGateway({
      async list_spaces() {
        return { total: 1, spaces: [{ id: "S1", name: "Planning" }] };
      },
      async list_folders(spaceId) {
        expect(spaceId).toBe("S1");
        return { total: 1, folders: [{ id: "F1", name: "Sprint" }] };
      },
      async list_lists_under(parentType, parentId) {
        if (parentType === "space") {
          expect(parentId).toBe("S1");
          return { total: 1, lists: [{ id: "LR", name: longName, folder_id: null }] };
        }
        expect(parentType).toBe("folder");
        expect(parentId).toBe("F1");
        return { total: 1, lists: [{ id: "L1", name: "Stories" }] };
      }
    });
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(server, runtime, { gateway: gateway as unknown as ClickUpGateway, cache });
    const tool = tools.find(entry => entry.name === "clickup_get_workspace_overview");
    if (!tool) {
      throw new Error("Tool not found");
    }
    const result = await tool.execute({ teamId: 9 }, { server, runtime });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const data = result.data as any;
    expect(data.spaces.length).toBe(1);
    const space = data.spaces[0];
    expect(space.folders.length).toBe(2);
    const rootFolder = space.folders.find((folder: any) => folder.id === "");
    expect(rootFolder).toBeDefined();
    if (rootFolder) {
      expect(rootFolder.name).toBe("Direct lists");
      expect(rootFolder.lists.length).toBe(1);
      expect(rootFolder.lists[0].name.length).toBeLessThan(longName.length);
    }
    const sprintFolder = space.folders.find((folder: any) => folder.id === "F1");
    expect(sprintFolder).toBeDefined();
    if (sprintFolder) {
      expect(sprintFolder.lists[0].name).toBe("Stories");
    }
    expect(data.truncated).toBe(true);
    expect(data.guidance).toBe("Output trimmed to character_limit");
  });
});
