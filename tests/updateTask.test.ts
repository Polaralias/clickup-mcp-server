import { describe, expect, it, vi } from "vitest";
import "./setup.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { UpdateTask } from "../src/application/usecases/UpdateTask.js";

type GatewayStub = Pick<
  ClickUpGateway,
  "update_task" | "set_task_custom_field" | "add_task_comment" | "get_task_by_id"
>;

describe("UpdateTask", () => {
  it("updates core fields only", async () => {
    const update_task = vi.fn().mockResolvedValue({ url: "https://app.clickup.com/t/ABC" });
    const get_task_by_id = vi.fn().mockResolvedValue({});
    const gateway: GatewayStub = {
      update_task,
      set_task_custom_field: vi.fn(),
      add_task_comment: vi.fn(),
      get_task_by_id
    };
    const usecase = new UpdateTask(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, {
      taskId: "ABC",
      name: "New name",
      status: "in progress",
      assigneeIds: [1],
      dueDateMs: 1735689600000
    });
    expect(update_task).toHaveBeenCalledTimes(1);
    const body = update_task.mock.calls[0][1] as Record<string, unknown>;
    expect(body.name).toBe("New name");
    expect(body.status).toBe("in progress");
    expect(body.assignees).toEqual([1]);
    expect(body.due_date).toBe("1735689600000");
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    expect(result.data.taskId).toBe("ABC");
    expect(result.data.updated.core).toBe(true);
    expect(result.data.updated.customFields).toBe(0);
    expect(result.data.updated.descriptionAppended).toBe(false);
    expect(result.data.updated.commentAdded).toBe(false);
    expect(result.data.url).toBe("https://app.clickup.com/t/ABC");
  });

  it("sets custom fields", async () => {
    const update_task = vi.fn().mockResolvedValue({});
    const set_task_custom_field = vi.fn().mockResolvedValue({});
    const get_task_by_id = vi.fn().mockResolvedValue({});
    const gateway: GatewayStub = {
      update_task,
      set_task_custom_field,
      add_task_comment: vi.fn(),
      get_task_by_id
    };
    const usecase = new UpdateTask(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, {
      taskId: "ID",
      customFields: [
        { fieldId: "f1", value: "v1" },
        { fieldId: "f2", value: 42, value_options: { flag: true } }
      ]
    });
    expect(update_task).not.toHaveBeenCalled();
    expect(set_task_custom_field).toHaveBeenCalledTimes(2);
    expect(set_task_custom_field).toHaveBeenNthCalledWith(1, "ID", "f1", "v1", undefined);
    expect(set_task_custom_field).toHaveBeenNthCalledWith(2, "ID", "f2", 42, { flag: true });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    expect(result.data.updated.core).toBe(false);
    expect(result.data.updated.customFields).toBe(2);
    expect(result.data.updated.descriptionAppended).toBe(false);
    expect(result.data.updated.commentAdded).toBe(false);
    expect(result.data.url).toBeUndefined();
  });

  it("appends description and adds comment", async () => {
    const update_task = vi.fn().mockResolvedValue({ url: "https://app.clickup.com/t/XYZ" });
    const add_task_comment = vi.fn().mockResolvedValue({});
    const get_task_by_id = vi.fn().mockResolvedValue({ description: "Existing", url: "https://app.clickup.com/t/XYZ" });
    const gateway: GatewayStub = {
      update_task,
      set_task_custom_field: vi.fn(),
      add_task_comment,
      get_task_by_id
    };
    const usecase = new UpdateTask(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, {
      taskId: "XYZ",
      appendMarkdownDescription: "More info",
      addCommentMarkdown: "Note"
    });
    expect(get_task_by_id).toHaveBeenCalledTimes(1);
    expect(update_task).toHaveBeenCalledTimes(1);
    const body = update_task.mock.calls[0][1] as Record<string, unknown>;
    expect(body.description).toBe("Existing\n\n---\n**Edit (2025-01-01):** More info");
    expect(add_task_comment).toHaveBeenCalledWith("XYZ", "Note");
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    expect(result.data.updated.core).toBe(false);
    expect(result.data.updated.customFields).toBe(0);
    expect(result.data.updated.descriptionAppended).toBe(true);
    expect(result.data.updated.commentAdded).toBe(true);
    expect(result.data.url).toBe("https://app.clickup.com/t/XYZ");
  });
});
