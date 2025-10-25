import { z } from "zod";
import {
  AddTagsToTaskInput,
  RemoveTagsFromTaskInput,
  TagsOutput
} from "../../../mcp/tools/schemas/taskCrud.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/Errors.js";
import { characterLimit } from "../../../config/runtime.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

type AddInput = z.infer<typeof AddTagsToTaskInput>;
type RemoveInput = z.infer<typeof RemoveTagsFromTaskInput>;
type OutputType = z.infer<typeof TagsOutput>;

type HttpErrorLike = { status?: number; data?: unknown };

type TaskRefLike = { taskId?: string; url?: string };

function toId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return undefined;
}

function toUrl(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

function extractTaskRef(payload: unknown, visited = new Set<unknown>()): TaskRefLike {
  if (typeof payload === "string" && payload.length > 0) {
    return { taskId: payload };
  }
  if (!payload || typeof payload !== "object") {
    return {};
  }
  if (visited.has(payload)) {
    return {};
  }
  visited.add(payload);
  const record = payload as Record<string, unknown>;
  let taskId =
    toId(record.taskId) ??
    toId(record.task_id) ??
    toId(record.id) ??
    toId(record.ID) ??
    toId(record.Id);
  let url = toUrl(record.url) ?? toUrl(record.permalink) ?? toUrl(record.link) ?? toUrl(record.web_url) ?? toUrl(record.app_url);
  const nestedSources: unknown[] = [];
  if ("task" in record) {
    nestedSources.push(record.task);
  }
  if ("data" in record) {
    nestedSources.push(record.data);
  }
  if ("result" in record) {
    nestedSources.push(record.result);
  }
  if ("tags" in record) {
    nestedSources.push(record.tags);
  }
  const tasks = record.tasks;
  if (Array.isArray(tasks)) {
    nestedSources.push(...tasks);
  }
  for (const source of nestedSources) {
    const nested = extractTaskRef(source, visited);
    if (!taskId && nested.taskId) {
      taskId = nested.taskId;
    }
    if (!url && nested.url) {
      url = nested.url;
    }
    if (taskId && url) {
      break;
    }
  }
  return { taskId, url };
}

function shortenField(target: unknown, path: string[]): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }
  let current: unknown = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (!current || typeof current !== "object") {
      return false;
    }
    current = (current as Record<string, unknown>)[path[i]];
  }
  if (!current || typeof current !== "object") {
    return false;
  }
  const container = current as Record<string, unknown>;
  const key = path[path.length - 1];
  const value = container[key];
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  const nextLength = Math.floor(value.length / 2);
  container[key] = nextLength > 0 ? value.slice(0, nextLength) : "";
  return true;
}

function enforceLimit(out: OutputType): void {
  const limit = characterLimit();
  const paths: string[][] = [["description"], ["commentMarkdown"], ["attachment", "name"]];
  let payload = JSON.stringify(out);
  let truncated = false;
  while (payload.length > limit) {
    let trimmed = false;
    for (const path of paths) {
      if (shortenField(out as unknown, path)) {
        trimmed = true;
        truncated = true;
        payload = JSON.stringify(out);
        if (payload.length <= limit) {
          break;
        }
      }
    }
    if (!trimmed) {
      break;
    }
  }
  if (payload.length > limit) {
    truncated = true;
  }
  if (truncated) {
    out.truncated = true;
    out.guidance = "Output trimmed to character_limit";
  }
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    if (!seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
}

function buildOutput(taskId: string, url: string | undefined, added: string[], removed: string[]): OutputType {
  const task = url ? { taskId, url } : { taskId };
  return { task, added, removed };
}

export class AddTagsToTask {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: AddInput): Promise<Result<z.infer<typeof TagsOutput>>> {
    void ctx;
    const parsed = AddTagsToTaskInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    const tags = uniqueTags(data.tags);
    if (data.dryRun === true) {
      return ok({ dryRun: true as const, preview: { taskId: data.taskId, action: "add" as const, tags } });
    }
    try {
      const response = await this.gateway.add_task_tags(data.taskId, tags);
      const ref = extractTaskRef(response);
      const taskId = ref.taskId ?? data.taskId;
      const out = buildOutput(taskId, ref.url, tags, []);
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

export class RemoveTagsFromTask {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: RemoveInput): Promise<Result<z.infer<typeof TagsOutput>>> {
    void ctx;
    const parsed = RemoveTagsFromTaskInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    const tags = uniqueTags(data.tags);
    if (data.dryRun === true) {
      return ok({ dryRun: true as const, preview: { taskId: data.taskId, action: "remove" as const, tags } });
    }
    try {
      const response = await this.gateway.remove_task_tags(data.taskId, tags);
      const ref = extractTaskRef(response);
      const taskId = ref.taskId ?? data.taskId;
      const out = buildOutput(taskId, ref.url, [], tags);
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
