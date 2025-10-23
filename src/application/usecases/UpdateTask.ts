import { z } from "zod";
import { UpdateTaskInput, UpdateTaskOutput } from "../../mcp/tools/schemas/taskUpdate.js";
import { Result, ok, err } from "../../shared/Result.js";
import { mapHttpError } from "../../shared/Errors.js";
import { characterLimit } from "../../config/runtime.js";
import type { ClickUpGateway } from "../../infrastructure/clickup/ClickUpGateway.js";

type UpdateTaskInputType = z.infer<typeof UpdateTaskInput>;
type UpdateTaskOutputType = z.infer<typeof UpdateTaskOutput>;

type HttpErrorLike = { status?: number; data?: unknown };

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function buildDescription(current: string, addition: string, stamp: string): string {
  const prefix = current.length > 0 ? `${current}\n\n---\n` : "";
  return `${prefix}**Edit (${stamp}):** ${addition}`;
}

function extractDescription(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const record = payload as Record<string, unknown>;
  const direct = record.description ?? record.text_content ?? record.textContent;
  if (typeof direct === "string") {
    return direct;
  }
  const taskNested = (record as { task?: unknown }).task;
  if (typeof taskNested !== "undefined") {
    const fromTask = extractDescription(taskNested);
    if (fromTask.length > 0) {
      return fromTask;
    }
  }
  const dataNested = (record as { data?: unknown }).data;
  if (typeof dataNested !== "undefined") {
    const fromData = extractDescription(dataNested);
    if (fromData.length > 0) {
      return fromData;
    }
  }
  return "";
}

function extractUrl(payload: unknown): string | undefined {
  if (typeof payload === "string" && payload.length > 0) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const fields = ["url", "permalink", "link"] as const;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  const taskNested = (record as { task?: unknown }).task;
  if (typeof taskNested !== "undefined") {
    const fromTask = extractUrl(taskNested);
    if (fromTask) {
      return fromTask;
    }
  }
  const dataNested = (record as { data?: unknown }).data;
  if (typeof dataNested !== "undefined") {
    const fromData = extractUrl(dataNested);
    if (fromData) {
      return fromData;
    }
  }
  return undefined;
}

function enforceLimit(out: UpdateTaskOutputType): void {
  const limit = characterLimit();
  let payload = JSON.stringify(out);
  if (payload.length <= limit) {
    return;
  }
  let truncated = false;
  while (payload.length > limit) {
    if (typeof out.url !== "string" || out.url.length === 0) {
      break;
    }
    const nextLength = Math.floor(out.url.length / 2);
    out.url = nextLength > 0 ? out.url.slice(0, nextLength) : "";
    truncated = true;
    payload = JSON.stringify(out);
  }
  if (truncated) {
    out.truncated = true;
    out.guidance = "Output trimmed to character_limit";
  }
}

export class UpdateTask {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: UpdateTaskInputType): Promise<Result<z.infer<typeof UpdateTaskOutput>>> {
    void ctx;
    const parsed = UpdateTaskInput.safeParse(input);
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    const coreUpdate: Record<string, unknown> = {};
    if (typeof data.name === "string") {
      coreUpdate.name = data.name;
    }
    if (typeof data.status === "string") {
      coreUpdate.status = data.status;
    }
    if (typeof data.assigneeIds !== "undefined") {
      coreUpdate.assignees = data.assigneeIds;
    }
    if (typeof data.priority !== "undefined") {
      coreUpdate.priority = data.priority;
    }
    if (typeof data.dueDateMs === "number") {
      coreUpdate.due_date = String(data.dueDateMs);
    }
    if (typeof data.timeEstimateMs === "number") {
      coreUpdate.time_estimate = String(data.timeEstimateMs);
    }
    if (typeof data.tags !== "undefined") {
      coreUpdate.tags = data.tags;
    }
    let url: string | undefined;
    let didCore = false;
    let customCount = 0;
    let didAppend = false;
    let didComment = false;
    try {
      if (Object.keys(coreUpdate).length > 0) {
        const response = await this.gateway.update_task(data.taskId, coreUpdate);
        const responseUrl = extractUrl(response);
        if (responseUrl) {
          url = responseUrl;
        }
        didCore = true;
      }
      if (Array.isArray(data.customFields)) {
        for (const field of data.customFields) {
          await this.gateway.set_task_custom_field(data.taskId, field.fieldId, field.value, field.value_options);
          customCount += 1;
        }
      }
      if (typeof data.appendMarkdownDescription === "string") {
        const task = await this.gateway.get_task_by_id(data.taskId);
        const currentDescription = extractDescription(task);
        if (!url) {
          const taskUrl = extractUrl(task);
          if (taskUrl) {
            url = taskUrl;
          }
        }
        const stamp = formatDate(new Date());
        const newDescription = buildDescription(currentDescription, data.appendMarkdownDescription, stamp);
        const response = await this.gateway.update_task(data.taskId, { description: newDescription });
        const responseUrl = extractUrl(response);
        if (responseUrl) {
          url = responseUrl;
        }
        didAppend = true;
      }
      if (typeof data.addCommentMarkdown === "string") {
        await this.gateway.add_task_comment(data.taskId, data.addCommentMarkdown);
        didComment = true;
      }
      const out: UpdateTaskOutputType = {
        taskId: data.taskId,
        updated: {
          core: didCore,
          customFields: customCount,
          descriptionAppended: didAppend,
          commentAdded: didComment
        }
      };
      if (url) {
        out.url = url;
      }
      enforceLimit(out);
      return ok(out, out.truncated === true, out.guidance);
    } catch (error) {
      const httpError = error as HttpErrorLike;
      if (httpError && typeof httpError.status === "number") {
        const mapped = mapHttpError(httpError.status, httpError.data);
        return err(mapped.code, mapped.message, mapped.details);
      }
      const message = error instanceof Error ? error.message : String(error);
      return err("UNKNOWN", message);
    }
  }
}
