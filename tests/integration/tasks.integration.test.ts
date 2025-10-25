import { describe, expect, it, vi } from "vitest";
import "../setup.js";
import { CreateTask } from "../../src/application/usecases/tasks/CreateTask.js";
import { UpdateTask } from "../../src/application/usecases/UpdateTask.js";
import { DeleteTask } from "../../src/application/usecases/tasks/DeleteTask.js";
import { withSafetyConfirmation } from "../../src/mcp/middleware/Safety.js";
import type { ClickUpGateway } from "../../src/infrastructure/clickup/ClickUpGateway.js";

describe("Task lifecycle integration", () => {
  it("performs create, update, and delete flows with dry-run enforcement", async () => {
    const gateway = {
      create_task: vi.fn().mockResolvedValue({ task: { id: "T123", url: "https://app/tasks/T123" } }),
      update_task: vi
        .fn()
        .mockResolvedValueOnce({ id: "T123", url: "https://app/tasks/T123" })
        .mockResolvedValueOnce({ id: "T123", url: "https://app/tasks/T123" }),
      set_task_custom_field: vi.fn().mockResolvedValue(null),
      get_task_by_id: vi
        .fn()
        .mockResolvedValue({ id: "T123", description: "Existing body", url: "https://app/tasks/T123" }),
      add_task_comment: vi.fn().mockResolvedValue({ id: "C1" }),
      delete_task: vi.fn().mockResolvedValue({ id: "T123", url: "https://app/tasks/T123" })
    } satisfies Partial<ClickUpGateway>;
    const typedGateway = gateway as unknown as ClickUpGateway;
    const createUsecase = new CreateTask(typedGateway);
    const updateUsecase = new UpdateTask(typedGateway);
    const deleteUsecase = new DeleteTask(typedGateway);
    const createPreview = await createUsecase.execute({}, { listId: "L1", name: "Alpha", dryRun: true });
    expect(createPreview.isError).toBe(false);
    if (createPreview.isError) {
      throw new Error("Expected success");
    }
    if (!("dryRun" in createPreview.data)) {
      throw new Error("Expected dry run output");
    }
    expect(createPreview.data.dryRun).toBe(true);
    expect(createPreview.data.preview).toEqual({ listId: "L1", body: { name: "Alpha" } });
    expect(gateway.create_task).not.toHaveBeenCalled();
    const createResult = await createUsecase.execute({}, { listId: "L1", name: "Alpha" });
    expect(createResult.isError).toBe(false);
    if (createResult.isError) {
      throw new Error("Expected success");
    }
    if ("dryRun" in createResult.data) {
      throw new Error("Expected execution result");
    }
    expect(createResult.data.task.taskId).toBe("T123");
    expect(createResult.data.task.url).toBe("https://app/tasks/T123");
    expect(createResult.truncated).not.toBe(true);
    expect(gateway.create_task).toHaveBeenCalledTimes(1);
    const updatePreview = await updateUsecase.execute(
      {},
      {
        taskId: "T123",
        name: "Alpha Revised",
        customFields: [{ fieldId: "F1", value: "done" }],
        appendMarkdownDescription: "Added summary",
        addCommentMarkdown: "Updated via integration",
        dryRun: true
      }
    );
    expect(updatePreview.isError).toBe(false);
    if (updatePreview.isError) {
      throw new Error("Expected success");
    }
    if (!("dryRun" in updatePreview.data)) {
      throw new Error("Expected dry run output");
    }
    expect(updatePreview.data.preview).toEqual({
      taskId: "T123",
      coreUpdate: { name: "Alpha Revised" },
      customFieldUpdates: [{ fieldId: "F1", value: "done" }],
      appendMarkdownDescription: "Added summary",
      addCommentMarkdown: "Updated via integration"
    });
    expect(gateway.update_task).not.toHaveBeenCalled();
    expect(gateway.set_task_custom_field).not.toHaveBeenCalled();
    expect(gateway.get_task_by_id).not.toHaveBeenCalled();
    expect(gateway.add_task_comment).not.toHaveBeenCalled();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-02-01T00:00:00.000Z"));
    const updateResult = await updateUsecase.execute(
      {},
      {
        taskId: "T123",
        name: "Alpha Revised",
        customFields: [{ fieldId: "F1", value: "done" }],
        appendMarkdownDescription: "Added summary",
        addCommentMarkdown: "Updated via integration"
      }
    );
    vi.useRealTimers();
    expect(updateResult.isError).toBe(false);
    if (updateResult.isError) {
      throw new Error("Expected success");
    }
    expect(gateway.update_task).toHaveBeenCalledTimes(2);
    expect(gateway.update_task).toHaveBeenNthCalledWith(1, "T123", { name: "Alpha Revised" });
    const appendedCall = gateway.update_task.mock.calls[1];
    expect(appendedCall[0]).toBe("T123");
    expect(typeof appendedCall[1]).toBe("object");
    const body = appendedCall[1] as Record<string, unknown>;
    expect(typeof body.description).toBe("string");
    expect(String(body.description)).toContain("Existing body");
    expect(String(body.description)).toContain("**Edit (2025-02-01):** Added summary");
    expect(gateway.set_task_custom_field).toHaveBeenCalledWith("T123", "F1", "done", undefined);
    expect(gateway.get_task_by_id).toHaveBeenCalledWith("T123");
    expect(gateway.add_task_comment).toHaveBeenCalledWith("T123", "Updated via integration");
    if ("dryRun" in updateResult.data) {
      throw new Error("Expected execution result");
    }
    expect(updateResult.data.updated).toEqual({ core: true, customFields: 1, descriptionAppended: true, commentAdded: true });
    expect(updateResult.data.url).toBe("https://app/tasks/T123");
    const deleteResult = await deleteUsecase.execute({}, { taskId: "T123", confirm: "yes" });
    expect(deleteResult.isError).toBe(false);
    if (deleteResult.isError) {
      throw new Error("Expected success");
    }
    if ("dryRun" in deleteResult.data) {
      throw new Error("Expected execution result");
    }
    expect(deleteResult.data.task).toEqual({ taskId: "T123", url: "https://app/tasks/T123" });
    expect(gateway.delete_task).toHaveBeenCalledWith("T123");
  });

  it("requires confirmation before deleting through middleware", async () => {
    const gateway = {
      delete_task: vi.fn().mockResolvedValue({ id: "T123" })
    } satisfies Partial<ClickUpGateway>;
    const deleteUsecase = new DeleteTask(gateway as unknown as ClickUpGateway);
    const tool = withSafetyConfirmation(async (input, _context) => {
      const { taskId } = input as { taskId: string };
      return deleteUsecase.execute({}, { taskId, confirm: "yes" });
    });
    const blocked = await tool({ taskId: "T123" }, {});
    expect(blocked.isError).toBe(true);
    if (!blocked.isError) {
      throw new Error("Expected error");
    }
    expect(blocked.code).toBe("INVALID_PARAMETER");
    expect(gateway.delete_task).not.toHaveBeenCalled();
    const allowed = await tool({ taskId: "T123", confirm: "yes" }, {});
    expect(allowed.isError).toBe(false);
    if (allowed.isError) {
      throw new Error("Expected success");
    }
    expect(gateway.delete_task).toHaveBeenCalledWith("T123");
  });
});
