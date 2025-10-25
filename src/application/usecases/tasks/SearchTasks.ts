import { z } from "zod";
import {
  SearchTasksInput,
  SearchTasksOutput,
  SearchTaskItem
} from "../../../mcp/tools/schemas/taskCrud.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/httpErrors.js";
import { characterLimit } from "../../../config/runtime.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

type InputType = z.infer<typeof SearchTasksInput>;
type OutputType = z.infer<typeof SearchTasksOutput>;
type ItemType = z.infer<typeof SearchTaskItem>;

type HttpErrorLike = { status?: number; data?: unknown };

type ParsedTask = { item: ItemType; sort: number };

type ParsedResponse = {
  tasks: ParsedTask[];
  total: number | null;
  page: number | null;
  limit: number | null;
};

function toStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function toIntValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  if (typeof value === "bigint") {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      return Math.trunc(numeric);
    }
  }
  return null;
}

function parseAssignees(value: unknown): ItemType["assignees"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: ItemType["assignees"] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id =
      toIntValue(record.id) ??
      toIntValue(record.user_id) ??
      toIntValue(record.userId) ??
      toIntValue(record.member_id) ??
      toIntValue(record.memberId);
    if (id === null) {
      continue;
    }
    const username =
      toStringValue(record.username) ??
      toStringValue(record.name) ??
      toStringValue(record.email) ??
      null;
    result.push({ id, username });
  }
  return result;
}

function parseStatus(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  return toStringValue(record.status) ?? toStringValue(record.name) ?? null;
}

function parsePriority(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  return toStringValue(record.priority) ?? toStringValue(record.name) ?? null;
}

function parseDate(value: unknown): { text: string | null; sort: number } {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { text: new Date(Math.trunc(value)).toISOString(), sort: Math.trunc(value) };
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      const truncated = Math.trunc(numeric);
      return { text: new Date(truncated).toISOString(), sort: truncated };
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return { text: new Date(parsed).toISOString(), sort: parsed };
    }
    return { text: value, sort: Number.MIN_SAFE_INTEGER };
  }
  return { text: null, sort: Number.MIN_SAFE_INTEGER };
}

function extractTaskId(record: Record<string, unknown>): string {
  return (
    toStringValue(record.id) ??
    toStringValue(record.task_id) ??
    toStringValue(record.taskId) ??
    toStringValue((record.task as Record<string, unknown> | undefined)?.id) ??
    toStringValue((record.task as Record<string, unknown> | undefined)?.task_id) ??
    ""
  );
}

function extractUrl(record: Record<string, unknown>): string {
  return (
    toStringValue(record.url) ??
    toStringValue(record.permalink) ??
    toStringValue(record.link) ??
    toStringValue(record.web_url) ??
    toStringValue(record.app_url) ??
    ""
  ) ?? "";
}

function parseTask(payload: unknown): ParsedTask {
  const record = (payload ?? {}) as Record<string, unknown>;
  const listRecord = record.list as Record<string, unknown> | null | undefined;
  const spaceRecord = record.space as Record<string, unknown> | null | undefined;
  const dateSource =
    record.date_updated ??
    record.dateUpdated ??
    record.updated_at ??
    record.updatedAt ??
    (record.history as Record<string, unknown> | undefined)?.date_updated;
  const dateInfo = parseDate(dateSource);
  const taskId = extractTaskId(record);
  const item: ItemType = {
    taskId,
    name: toStringValue(record.name) ?? toStringValue(record.title),
    url: extractUrl(record),
    listId: toStringValue(record.list_id) ?? toStringValue(listRecord?.id),
    listName: toStringValue(listRecord?.name),
    spaceId: toStringValue(record.space_id) ?? toStringValue(spaceRecord?.id),
    spaceName: toStringValue(spaceRecord?.name),
    status: parseStatus(record.status),
    priority: parsePriority(record.priority),
    assignees: parseAssignees(record.assignees),
    dateUpdated: dateInfo.text
  };
  return { item, sort: dateInfo.sort };
}

function parseResponse(payload: unknown): ParsedResponse {
  if (!payload || typeof payload !== "object") {
    return { tasks: [], total: null, page: null, limit: null };
  }
  const record = payload as Record<string, unknown>;
  const containers = [record.tasks, record.data, record.items];
  const tasks: ParsedTask[] = [];
  for (const container of containers) {
    if (Array.isArray(container)) {
      for (const entry of container) {
        tasks.push(parseTask(entry));
      }
      break;
    }
  }
  const paginationRecord = record.pagination as Record<string, unknown> | null | undefined;
  const pagesRecord = record.pages as Record<string, unknown> | null | undefined;
  const totalCandidates = [
    record.total_tasks,
    record.total,
    record.count,
    paginationRecord?.total,
    pagesRecord?.total
  ];
  let total: number | null = null;
  for (const candidate of totalCandidates) {
    const numeric = toIntValue(candidate);
    if (numeric !== null && numeric >= 0) {
      total = numeric;
      break;
    }
  }
  const pageCandidates = [record.page, paginationRecord?.page, pagesRecord?.page];
  let page: number | null = null;
  for (const candidate of pageCandidates) {
    const numeric = toIntValue(candidate);
    if (numeric !== null && numeric >= 0) {
      page = numeric;
      break;
    }
  }
  const limitCandidates = [record.limit, paginationRecord?.limit, pagesRecord?.limit];
  let limit: number | null = null;
  for (const candidate of limitCandidates) {
    const numeric = toIntValue(candidate);
    if (numeric !== null && numeric > 0) {
      limit = numeric;
      break;
    }
  }
  return { tasks, total, page, limit };
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

function buildQueryParams(data: InputType): Record<string, unknown> {
  const params: Record<string, unknown> = {
    teamId: data.teamId,
    page: data.page,
    limit: data.limit,
    include_closed: data.includeClosed ? "true" : "false",
    order_by: "date_updated",
    reverse: "true"
  };
  if (data.listIds && data.listIds.length > 0) {
    params["list_ids[]"] = data.listIds;
  }
  if (data.spaceIds && data.spaceIds.length > 0) {
    params["space_ids[]"] = data.spaceIds;
  }
  if (data.assigneeIds && data.assigneeIds.length > 0) {
    params["assignees[]"] = data.assigneeIds;
  }
  if (data.statuses && data.statuses.length > 0) {
    params["statuses[]"] = data.statuses;
  }
  if (data.query && data.query.length > 0) {
    params.search = data.query;
  }
  return params;
}

export class SearchTasks {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<z.infer<typeof SearchTasksOutput>>> {
    void ctx;
    const parsed = SearchTasksInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    const params = buildQueryParams(data);
    try {
      const response = await this.gateway.search_tasks(params);
      const parsedResponse = parseResponse(response);
      const tasks = parsedResponse.tasks;
      tasks.sort((a, b) => {
        if (a.sort !== b.sort) {
          return b.sort - a.sort;
        }
        const left = a.item.taskId;
        const right = b.item.taskId;
        if (left < right) {
          return -1;
        }
        if (left > right) {
          return 1;
        }
        return 0;
      });
      const results = tasks.map(entry => entry.item);
      const resolvedLimit = parsedResponse.limit !== null && parsedResponse.limit > 0 ? parsedResponse.limit : data.limit;
      const resolvedPage = parsedResponse.page !== null && parsedResponse.page >= 0 ? parsedResponse.page : data.page;
      const resolvedTotal = parsedResponse.total !== null && parsedResponse.total >= 0 ? parsedResponse.total : results.length;
      const hasMore = parsedResponse.total !== null && parsedResponse.total >= 0
        ? (resolvedPage + 1) * resolvedLimit < parsedResponse.total
        : results.length === resolvedLimit;
      const out: OutputType = {
        total: resolvedTotal,
        page: resolvedPage,
        limit: resolvedLimit,
        hasMore,
        results
      };
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
