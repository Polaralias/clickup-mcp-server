import { describe, expect, it, vi } from "vitest";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import "./setup.js";
import type { RuntimeConfig } from "../src/config/runtime.js";
import { ApiCache } from "../src/infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../src/shared/KV.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { CreateTask } from "../src/application/usecases/tasks/CreateTask.js";
import { MoveTask } from "../src/application/usecases/tasks/MoveTask.js";
import { DuplicateTask } from "../src/application/usecases/tasks/DuplicateTask.js";
import { DeleteTask } from "../src/application/usecases/tasks/DeleteTask.js";
import { SearchTasks } from "../src/application/usecases/tasks/SearchTasks.js";
import { CommentTask } from "../src/application/usecases/tasks/CommentTask.js";
import { AttachFileToTask } from "../src/application/usecases/tasks/AttachFileToTask.js";
import { AddTagsToTask, RemoveTagsFromTask } from "../src/application/usecases/tasks/Tags.js";
import { registerTools } from "../src/mcp/tools/registerTools.js";

type CreateGatewayStub = Pick<ClickUpGateway, "create_task">;
type MoveGatewayStub = Pick<ClickUpGateway, "move_task">;
type DuplicateGatewayStub = Pick<ClickUpGateway, "duplicate_task">;
type DeleteGatewayStub = Pick<ClickUpGateway, "delete_task">;
type SearchGatewayStub = Pick<ClickUpGateway, "search_tasks">;
type CommentGatewayStub = Pick<ClickUpGateway, "comment_task">;

type RegisterGatewayStub = Pick<
  ClickUpGateway,
  | "search_docs"
  | "fetch_tasks_for_index"
  | "get_task_by_id"
  | "get_doc_page"
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
>;

function buildGatewayStub(overrides: Partial<RegisterGatewayStub> = {}): RegisterGatewayStub {
  const base: RegisterGatewayStub = {
    search_docs: vi.fn().mockResolvedValue({ total: 0, items: [] }),
    fetch_tasks_for_index: vi.fn().mockResolvedValue([]),
    get_task_by_id: vi.fn().mockResolvedValue({}),
    get_doc_page: vi.fn().mockResolvedValue({}),
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
    list_members: vi.fn().mockResolvedValue({ members: [], total: 0 })
  };
  return { ...base, ...overrides };
}

describe("Task CRUD usecases", () => {
  it("Create maps fields and returns ref", async () => {
    const create_task = vi.fn().mockResolvedValue({ id: "T123", url: "https://app.clickup.com/t/T123" });
    const gateway: CreateGatewayStub = { create_task };
    const usecase = new CreateTask(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, {
      listId: "L1",
      name: "New task",
      description: "Details",
      assigneeIds: [1, 2],
      status: "open",
      priority: 3,
      dueDateMs: 1735689600000,
      timeEstimateMs: 3600000,
      tags: ["alpha"]
    });
    expect(create_task).toHaveBeenCalledTimes(1);
    const body = create_task.mock.calls[0][1] as Record<string, unknown>;
    expect(body).toEqual({
      name: "New task",
      description: "Details",
      assignees: [1, 2],
      status: "open",
      priority: 3,
      due_date: "1735689600000",
      time_estimate: "3600000",
      tags: ["alpha"]
    });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    if ("dryRun" in result.data) {
      throw new Error("Expected execution result");
    }
    expect(result.data.task.taskId).toBe("T123");
    expect(result.data.task.url).toBe("https://app.clickup.com/t/T123");
  });

  it("Move calls correct endpoint", async () => {
    const move_task = vi.fn().mockResolvedValue({ task: { id: "T200", url: "https://app.clickup.com/t/T200" } });
    const gateway: MoveGatewayStub = { move_task };
    const usecase = new MoveTask(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, { taskId: "T200", targetListId: "L99" });
    expect(move_task).toHaveBeenCalledWith("T200", "L99");
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    if ("dryRun" in result.data) {
      throw new Error("Expected execution result");
    }
    expect(result.data.task.taskId).toBe("T200");
    expect(result.data.task.url).toBe("https://app.clickup.com/t/T200");
  });

  it("Duplicate maps include flags", async () => {
    const duplicate_task = vi.fn().mockResolvedValue({ id: "T301" });
    const gateway: DuplicateGatewayStub = { duplicate_task };
    const usecase = new DuplicateTask(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, {
      taskId: "T300",
      include: {
        assignees: false,
        attachments: true,
        comments: true,
        customFields: false,
        tags: true,
        checklists: false,
        subtasks: true
      }
    });
    expect(duplicate_task).toHaveBeenCalledTimes(1);
    const include = duplicate_task.mock.calls[0][1] as Record<string, boolean>;
    expect(include).toEqual({
      include_assignees: false,
      include_attachments: true,
      include_comments: true,
      include_custom_fields: false,
      include_tags: true,
      include_checklists: false,
      include_subtasks: true
    });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    if ("dryRun" in result.data) {
      throw new Error("Expected execution result");
    }
    expect(result.data.task.taskId).toBe("T301");
  });

  it("Delete returns success and tool annotation", async () => {
    const delete_task = vi.fn().mockResolvedValue({});
    const gateway: DeleteGatewayStub = { delete_task };
    const usecase = new DeleteTask(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, { taskId: "T400", confirm: "yes" });
    expect(delete_task).toHaveBeenCalledWith("T400");
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    if ("dryRun" in result.data) {
      throw new Error("Expected execution result");
    }
    expect(result.data.task.taskId).toBe("T400");

    const runtime: RuntimeConfig = { logLevel: "info", featurePersistence: false };
    const server = {} as McpServer;
    const cache = new ApiCache(makeMemoryKV());
    const registerGateway = buildGatewayStub();
    const tools = await registerTools(server, runtime, {
      gateway: registerGateway as unknown as ClickUpGateway,
      cache
    });
    const tool = tools.find(entry => entry.name === "clickup_delete_task");
    if (!tool) {
      throw new Error("Delete tool not registered");
    }
    expect(tool.annotations.destructiveHint).toBe(true);
    expect(tool.annotations.idempotentHint).toBe(false);
  });

  it("Search sorting and paging", async () => {
    const search_tasks = vi
      .fn()
      .mockResolvedValueOnce({
        tasks: [
          { id: "B", date_updated: "1730", name: "Second", url: "u2" },
          { id: "A", date_updated: "1730", name: "First", url: "u1" }
        ],
        total_tasks: 4,
        page: 0,
        limit: 2
      })
      .mockResolvedValueOnce({
        tasks: [{ id: "C", date_updated: 500, name: "Third", url: "u3" }],
        total_tasks: 4,
        page: 1,
        limit: 2
      });
    const gateway: SearchGatewayStub = { search_tasks };
    const usecase = new SearchTasks(gateway as unknown as ClickUpGateway);
    const first = await usecase.execute({}, { page: 0, limit: 2, includeClosed: false, query: "" });
    expect(search_tasks).toHaveBeenNthCalledWith(1, {
      teamId: undefined,
      page: 0,
      limit: 2,
      include_closed: "false",
      order_by: "date_updated",
      reverse: "true"
    });
    expect(first.isError).toBe(false);
    if (first.isError) {
      throw new Error("Expected success result");
    }
    expect(first.data.hasMore).toBe(true);
    expect(first.data.results.map(item => item.taskId)).toEqual(["A", "B"]);
    expect(first.data.results[0].dateUpdated).toBe(new Date(1730).toISOString());

    const second = await usecase.execute({}, { page: 1, limit: 2, query: "", includeClosed: false });
    expect(search_tasks).toHaveBeenCalledTimes(2);
    expect(second.isError).toBe(false);
    if (second.isError) {
      throw new Error("Expected success result");
    }
    expect(second.data.hasMore).toBe(false);
    expect(second.data.results[0].taskId).toBe("C");
  });

  it("Comment returns id", async () => {
    const comment_task = vi.fn().mockResolvedValue({ comment: { id: "C1" }, task: { id: "T500", url: "link" } });
    const gateway: CommentGatewayStub = { comment_task };
    const usecase = new CommentTask(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, { taskId: "T500", commentMarkdown: "*note*" });
    expect(comment_task).toHaveBeenCalledWith("T500", "*note*");
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    if ("dryRun" in result.data) {
      throw new Error("Expected execution result");
    }
    expect(result.data.task.taskId).toBe("T500");
    expect(result.data.commentId).toBe("C1");
  });

  it("Attachment enforces size limit and success path", async () => {
    const attachLargeUsecase = new AttachFileToTask({
      attach_file_to_task: vi.fn()
    } as unknown as ClickUpGateway);
    const largeBuffer = Buffer.alloc(9 * 1024 * 1024, 1);
    const largeDataUri = `data:application/octet-stream;base64,${largeBuffer.toString("base64")}`;
    const largeResult = await attachLargeUsecase.execute({}, { taskId: "T600", dataUri: largeDataUri, name: "big.bin" });
    expect(largeResult.isError).toBe(true);
    if (!largeResult.isError) {
      throw new Error("Expected failure result");
    }
    expect(largeResult.code).toBe("LIMIT_EXCEEDED");
    expect(largeResult.message).toBe("Attachment exceeds 8 MB");

    const attachment = { attach_file_to_task: vi.fn().mockResolvedValue({ attachment: { id: "ATT1" }, task: { id: "T601" } }) };
    const attachUsecase = new AttachFileToTask(attachment as unknown as ClickUpGateway);
    const buffer = Buffer.from("hello world");
    const dataUri = `data:text/plain;base64,${buffer.toString("base64")}`;
    const result = await attachUsecase.execute({}, { taskId: "T601", dataUri, name: "hello.txt" });
    expect(attachment.attach_file_to_task).toHaveBeenCalledWith("T601", dataUri, "hello.txt");
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    if ("dryRun" in result.data) {
      throw new Error("Expected execution result");
    }
    expect(result.data.attachmentId).toBe("ATT1");
    expect(result.data.sizeBytes).toBe(buffer.length);
  });

  it("Tags add/remove minimal change", async () => {
    const add_task_tags = vi.fn().mockResolvedValue({ task: { id: "T700" } });
    const remove_task_tags = vi.fn().mockResolvedValue({ task: { id: "T700" } });
    const addUsecase = new AddTagsToTask({ add_task_tags } as unknown as ClickUpGateway);
    const removeUsecase = new RemoveTagsFromTask({ remove_task_tags } as unknown as ClickUpGateway);
    const addResult = await addUsecase.execute({}, { taskId: "T700", tags: ["urgent", "urgent", "review"] });
    expect(add_task_tags).toHaveBeenCalledWith("T700", ["urgent", "review"]);
    expect(addResult.isError).toBe(false);
    if (addResult.isError) {
      throw new Error("Expected success result");
    }
    if ("dryRun" in addResult.data) {
      throw new Error("Expected execution result");
    }
    expect(addResult.data.added).toEqual(["urgent", "review"]);
    expect(addResult.data.removed).toEqual([]);

    const removeResult = await removeUsecase.execute({}, { taskId: "T700", tags: ["urgent", "urgent", "review"] });
    expect(remove_task_tags).toHaveBeenCalledWith("T700", ["urgent", "review"]);
    expect(removeResult.isError).toBe(false);
    if (removeResult.isError) {
      throw new Error("Expected success result");
    }
    if ("dryRun" in removeResult.data) {
      throw new Error("Expected execution result");
    }
    expect(removeResult.data.added).toEqual([]);
    expect(removeResult.data.removed).toEqual(["urgent", "review"]);
  });
});
