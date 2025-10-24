import { describe, expect, it, vi } from "vitest";
import "./setup.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { UpdateTask } from "../src/application/usecases/UpdateTask.js";
import { CreateTask } from "../src/application/usecases/tasks/CreateTask.js";
import { UpdateEntry } from "../src/application/usecases/time/UpdateEntry.js";
import { UpdateDocPage } from "../src/application/usecases/docs/UpdateDocPage.js";

describe("dryRun previews", () => {
  it("returns preview for clickup_update_task without invoking gateway", async () => {
    const gateway: Pick<
      ClickUpGateway,
      "update_task" | "set_task_custom_field" | "add_task_comment" | "get_task_by_id"
    > = {
      update_task: vi.fn(),
      set_task_custom_field: vi.fn(),
      add_task_comment: vi.fn(),
      get_task_by_id: vi.fn()
    };
    const usecase = new UpdateTask(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, {
      taskId: "TASK-1",
      name: "Updated",
      dueDateMs: 1735689600000,
      customFields: [{ fieldId: "cf1", value: "value" }],
      appendMarkdownDescription: "Details",
      addCommentMarkdown: "Comment",
      dryRun: true
    });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected dry run success");
    }
    expect(result.data).toEqual({
      dryRun: true,
      preview: {
        taskId: "TASK-1",
        coreUpdate: { name: "Updated", due_date: "1735689600000" },
        customFieldUpdates: [{ fieldId: "cf1", value: "value" }],
        appendMarkdownDescription: "Details",
        addCommentMarkdown: "Comment"
      }
    });
    expect(gateway.update_task).not.toHaveBeenCalled();
    expect(gateway.set_task_custom_field).not.toHaveBeenCalled();
    expect(gateway.add_task_comment).not.toHaveBeenCalled();
    expect(gateway.get_task_by_id).not.toHaveBeenCalled();
  });

  it("returns preview for clickup_create_task without invoking gateway", async () => {
    const gateway: Pick<ClickUpGateway, "create_task"> = {
      create_task: vi.fn()
    };
    const usecase = new CreateTask(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, {
      listId: "LIST-1",
      name: "Sample",
      dueDateMs: 1700000000000,
      tags: ["alpha"],
      dryRun: true
    });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected dry run success");
    }
    expect(result.data).toEqual({
      dryRun: true,
      preview: {
        listId: "LIST-1",
        body: {
          name: "Sample",
          due_date: "1700000000000",
          tags: ["alpha"]
        }
      }
    });
    expect(gateway.create_task).not.toHaveBeenCalled();
  });

  it("returns preview for clickup_update_time_entry without invoking gateway", async () => {
    const gateway: Pick<ClickUpGateway, "update_time_entry"> = {
      update_time_entry: vi.fn()
    };
    const usecase = new UpdateEntry(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, {
      entryId: "ENTRY-1",
      start: "2023-11-01T09:00:00.000Z",
      end: "2023-11-01T10:00:00.000Z",
      billable: true,
      dryRun: true
    });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected dry run success");
    }
    expect(result.data).toEqual({
      dryRun: true,
      preview: {
        entryId: "ENTRY-1",
        body: {
          start: "1698829200000",
          end: "1698832800000",
          billable: true
        }
      }
    });
    expect(gateway.update_time_entry).not.toHaveBeenCalled();
  });

  it("returns preview for clickup_update_doc_page without invoking gateway", async () => {
    const gateway: Pick<ClickUpGateway, "update_doc_page"> = {
      update_doc_page: vi.fn()
    };
    const usecase = new UpdateDocPage(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, {
      workspaceId: 1,
      docId: "DOC-1",
      pageId: "PAGE-1",
      contentFormat: "text/md",
      content: "# Title",
      title: "Title",
      dryRun: true
    });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected dry run success");
    }
    expect(result.data).toEqual({
      dryRun: true,
      preview: {
        workspaceId: 1,
        docId: "DOC-1",
        pageId: "PAGE-1",
        body: {
          content_format: "text/md",
          content: "# Title",
          title: "Title"
        }
      }
    });
    expect(gateway.update_doc_page).not.toHaveBeenCalled();
  });
});
