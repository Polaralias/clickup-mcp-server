import { describe, expect, it, vi } from "vitest";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import "./setup.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { StartTimer } from "../src/application/usecases/time/StartTimer.js";
import { StopTimer } from "../src/application/usecases/time/StopTimer.js";
import { CreateEntry } from "../src/application/usecases/time/CreateEntry.js";
import { UpdateEntry } from "../src/application/usecases/time/UpdateEntry.js";
import { DeleteEntry } from "../src/application/usecases/time/DeleteEntry.js";
import { ListEntries } from "../src/application/usecases/time/ListEntries.js";
import { registerTools } from "../src/mcp/tools/registerTools.js";
import { ApiCache } from "../src/infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../src/shared/KV.js";
import type { RuntimeConfig } from "../src/config/runtime.js";

type StartGatewayStub = Pick<ClickUpGateway, "start_timer">;
type StopGatewayStub = Pick<ClickUpGateway, "stop_timer">;
type CreateGatewayStub = Pick<ClickUpGateway, "create_time_entry">;
type UpdateGatewayStub = Pick<ClickUpGateway, "update_time_entry">;
type DeleteGatewayStub = Pick<ClickUpGateway, "delete_time_entry">;
type ListGatewayStub = Pick<ClickUpGateway, "list_time_entries">;

type RegisterGatewayStub = Pick<
  ClickUpGateway,
  | "search_docs"
  | "fetch_tasks_for_index"
  | "get_task_by_id"
  | "update_task"
  | "set_task_custom_field"
  | "add_task_comment"
  | "create_task"
  | "move_task"
  | "duplicate_task"
  | "delete_task"
  | "search_tasks"
  | "comment_task"
  | "attach_file_to_task"
  | "add_task_tags"
  | "remove_task_tags"
  | "list_workspaces"
  | "list_spaces"
  | "list_folders"
  | "list_lists_under"
  | "list_tags_for_space"
  | "list_members"
  | "start_timer"
  | "stop_timer"
  | "create_time_entry"
  | "update_time_entry"
  | "delete_time_entry"
  | "list_time_entries"
  | "list_view_tasks"
>;

function buildGatewayStub(overrides: Partial<RegisterGatewayStub> = {}): RegisterGatewayStub {
  const base: RegisterGatewayStub = {
    search_docs: vi.fn().mockResolvedValue({ total: 0, items: [] }),
    fetch_tasks_for_index: vi.fn().mockResolvedValue([]),
    get_task_by_id: vi.fn().mockResolvedValue({}),
    update_task: vi.fn().mockResolvedValue({}),
    set_task_custom_field: vi.fn().mockResolvedValue({}),
    add_task_comment: vi.fn().mockResolvedValue({}),
    create_task: vi.fn().mockResolvedValue({}),
    move_task: vi.fn().mockResolvedValue({}),
    duplicate_task: vi.fn().mockResolvedValue({}),
    delete_task: vi.fn().mockResolvedValue({}),
    search_tasks: vi.fn().mockResolvedValue({ tasks: [], total_tasks: 0, page: 0, limit: 50 }),
    comment_task: vi.fn().mockResolvedValue({}),
    attach_file_to_task: vi.fn().mockResolvedValue({}),
    add_task_tags: vi.fn().mockResolvedValue({}),
    remove_task_tags: vi.fn().mockResolvedValue({}),
    list_workspaces: vi.fn().mockResolvedValue({ teams: [], total: 0 }),
    list_spaces: vi.fn().mockResolvedValue({ spaces: [], total: 0 }),
    list_folders: vi.fn().mockResolvedValue({ folders: [], total: 0 }),
    list_lists_under: vi.fn().mockResolvedValue({ lists: [], total: 0 }),
    list_tags_for_space: vi.fn().mockResolvedValue({ tags: [] }),
    list_members: vi.fn().mockResolvedValue({ members: [], total: 0 }),
    start_timer: vi.fn().mockResolvedValue({}),
    stop_timer: vi.fn().mockResolvedValue({}),
    create_time_entry: vi.fn().mockResolvedValue({}),
    update_time_entry: vi.fn().mockResolvedValue({}),
    delete_time_entry: vi.fn().mockResolvedValue({}),
    list_time_entries: vi.fn().mockResolvedValue({ time_entries: [], total: 0, page: 0, limit: 50 }),
    list_view_tasks: vi.fn().mockResolvedValue({ tasks: [] })
  };
  return { ...base, ...overrides };
}

describe("Time tools", () => {
  it("Start timer success", async () => {
    const start_timer = vi.fn().mockResolvedValue({ entryId: "E1" });
    const gateway: StartGatewayStub = { start_timer };
    const usecase = new StartTimer(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, { taskId: "T1" });
    expect(start_timer).toHaveBeenCalledWith("T1", {});
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    if ("dryRun" in result.data) {
      throw new Error("Expected execution result");
    }
    expect(result.data.taskId).toBe("T1");
    expect(result.data.started).toBe(true);
    expect(result.data.running).toBe(true);
    expect(result.data.entryId).toBe("E1");
  });

  it("Start timer conflict handled", async () => {
    const start_timer = vi.fn().mockRejectedValue({ status: 400, data: { err: "already running" } });
    const gateway: StartGatewayStub = { start_timer };
    const usecase = new StartTimer(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, { taskId: "T2" });
    expect(result.isError).toBe(true);
    if (!result.isError) {
      throw new Error("Expected error result");
    }
    expect(result.code).toBe("INVALID_PARAMETER");
    expect(result.message).toBe("A timer is already running for this user. Stop it first.");
  });

  it("Stop timer success", async () => {
    const stop_timer = vi.fn().mockResolvedValue({ entryId: "E2" });
    const gateway: StopGatewayStub = { stop_timer };
    const usecase = new StopTimer(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, { taskId: "T3" });
    expect(stop_timer).toHaveBeenCalledWith("T3");
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    if ("dryRun" in result.data) {
      throw new Error("Expected execution result");
    }
    expect(result.data.taskId).toBe("T3");
    expect(result.data.stopped).toBe(true);
    expect(result.data.running).toBe(false);
    expect(result.data.entryId).toBe("E2");
  });

  it("Create entry validates times and maps fields", async () => {
    const create_time_entry = vi.fn().mockResolvedValue({ entryId: "NE1" });
    const gateway: CreateGatewayStub = { create_time_entry };
    const usecase = new CreateEntry(gateway as unknown as ClickUpGateway);
    const invalid = await usecase.execute({}, {
      taskId: "T4",
      start: "2025-01-01T10:00:00.000Z",
      end: "2025-01-01T09:00:00.000Z",
      billable: true
    });
    expect(invalid.isError).toBe(true);
    expect(create_time_entry).not.toHaveBeenCalled();
    const result = await usecase.execute({}, {
      taskId: "T4",
      memberId: 7,
      start: "2025-01-01T09:00:00.000Z",
      end: "2025-01-01T10:30:00.000Z",
      description: "Worked",
      billable: true
    });
    expect(create_time_entry).toHaveBeenCalledTimes(1);
    const body = create_time_entry.mock.calls[0][1] as Record<string, unknown>;
    expect(body.start).toBe(String(Date.parse("2025-01-01T09:00:00.000Z")));
    expect(body.end).toBe(String(Date.parse("2025-01-01T10:30:00.000Z")));
    expect(body.description).toBe("Worked");
    expect(body.billable).toBe(true);
    expect(body.assignee).toBe(7);
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    if ("dryRun" in result.data) {
      throw new Error("Expected execution result");
    }
    expect(result.data.taskId).toBe("T4");
    expect(result.data.entryId).toBe("NE1");
  });

  it("Update entry time validation", async () => {
    const update_time_entry = vi.fn().mockResolvedValue({});
    const gateway: UpdateGatewayStub = { update_time_entry };
    const usecase = new UpdateEntry(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, {
      entryId: "EE1",
      start: "2025-01-02T11:00:00.000Z",
      end: "2025-01-01T11:00:00.000Z"
    });
    expect(result.isError).toBe(true);
    expect(update_time_entry).not.toHaveBeenCalled();
  });

  it("Delete entry is destructive", async () => {
    const delete_time_entry = vi.fn().mockResolvedValue({});
    const gateway: DeleteGatewayStub = { delete_time_entry };
    const usecase = new DeleteEntry(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, { entryId: "DE1", confirm: "yes" });
    expect(delete_time_entry).toHaveBeenCalledWith("DE1");
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    if ("dryRun" in result.data) {
      throw new Error("Expected execution result");
    }
    expect(result.data.entryId).toBe("DE1");

    const runtime: RuntimeConfig = { logLevel: "info", featurePersistence: false };
    const server = {} as McpServer;
    const cache = new ApiCache(makeMemoryKV());
    const registerGateway = buildGatewayStub();
    const tools = await registerTools(server, runtime, {
      gateway: registerGateway as unknown as ClickUpGateway,
      cache
    });
    const tool = tools.find(entry => entry.name === "clickup_delete_time_entry");
    if (!tool) {
      throw new Error("Delete time entry tool not registered");
    }
    expect(tool.annotations.destructiveHint).toBe(true);
    expect(tool.annotations.idempotentHint).toBe(false);
  });

  it("List entries maps and aggregates", async () => {
    const longText = "A".repeat(30000);
    const list_time_entries = vi.fn().mockResolvedValue({
      total: 3,
      page: 0,
      limit: 2,
      time_entries: [
        {
          id: "E2",
          task_id: "T2",
          user: { id: 11, username: "User B" },
          start: Date.parse("2025-01-01T11:00:00.000Z"),
          end: Date.parse("2025-01-01T12:00:00.000Z"),
          description: "Review",
          billable: true
        },
        {
          id: "E1",
          task_id: "T1",
          user: { id: 10, username: "User A" },
          start: Date.parse("2025-01-01T09:00:00.000Z"),
          end: Date.parse("2025-01-01T10:30:00.000Z"),
          description: longText,
          billable: false
        }
      ]
    });
    const gateway: ListGatewayStub = { list_time_entries };
    const usecase = new ListEntries(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, {
      teamId: 1,
      page: 0,
      limit: 2,
      includeRunning: true,
      includeBillable: true
    });
    expect(list_time_entries).toHaveBeenCalledTimes(1);
    const callParams = list_time_entries.mock.calls[0][1] as Record<string, unknown>;
    expect(callParams.page).toBe(0);
    expect(callParams.limit).toBe(2);
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    expect(result.data.results[0].entryId).toBe("E1");
    expect(result.data.results[0].durationMs).toBe(90 * 60 * 1000);
    expect(result.data.results[1].entryId).toBe("E2");
    expect(result.data.byMember).toEqual([
      { memberId: 10, totalMs: 90 * 60 * 1000, billableMs: 0 },
      { memberId: 11, totalMs: 60 * 60 * 1000, billableMs: 60 * 60 * 1000 }
    ]);
    expect(result.data.hasMore).toBe(true);
    expect(result.data.truncated).toBe(true);
    expect(result.data.guidance).toBe("Output trimmed to character_limit");
    expect((result.data.results[0].description ?? "").length).toBeLessThan(longText.length);
  });
});
