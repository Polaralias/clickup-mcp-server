import { z } from "zod";
import {
  ReportForTagInput,
  ReportOutput,
  ReportTaskItem
} from "../../../mcp/tools/schemas/time.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/Errors.js";
import { characterLimit } from "../../../config/runtime.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

const TASK_CAP = 500;

type InputType = z.infer<typeof ReportForTagInput>;
type OutputType = z.infer<typeof ReportOutput>;
type ReportTaskItemType = z.infer<typeof ReportTaskItem>;

type HttpErrorLike = { status?: number; data?: unknown };

export type TaskInfo = { taskId: string; name: string | null; url: string; tags: string[] };

type ParsedTasks = {
  tasks: TaskInfo[];
  total: number | null;
  page: number | null;
  limit: number | null;
  hasMore: boolean | null;
};

type ParsedEntry = {
  taskId: string;
  memberId: number | null;
  startMs: number;
  endMs: number;
  durationMs: number;
  billable: boolean;
};

type ParsedEntries = {
  entries: ParsedEntry[];
  total: number | null;
  page: number | null;
  limit: number | null;
  hasMore: boolean | null;
};

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (normalised === "true" || normalised === "1") {
      return true;
    }
    if (normalised === "false" || normalised === "0") {
      return false;
    }
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  return null;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    return null;
  }
  return null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const intCandidate = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(intCandidate)) {
      return intCandidate;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) {
      const nested = parseTimestamp(record.value);
      if (nested !== null) {
        return nested;
      }
    }
    if ("date" in record) {
      const nested = parseTimestamp(record.date);
      if (nested !== null) {
        return nested;
      }
    }
    if ("timestamp" in record) {
      const nested = parseTimestamp(record.timestamp);
      if (nested !== null) {
        return nested;
      }
    }
  }
  return null;
}

function parseDuration(record: Record<string, unknown>, startMs: number, endMs: number): number {
  const candidates = [
    record.duration,
    record.durationMs,
    record.duration_ms,
    record.time,
    record.length,
    record.total_time,
    record.tracked
  ];
  for (const candidate of candidates) {
    const value = toInt(candidate);
    if (value !== null && value >= 0) {
      return value;
    }
  }
  const diff = endMs - startMs;
  if (Number.isFinite(diff) && diff >= 0) {
    return Math.trunc(diff);
  }
  return 0;
}

function collectTags(value: unknown): string[] {
  const tags: string[] = [];
  if (!value) {
    return tags;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        if (trimmed.length > 0 && !tags.includes(trimmed)) {
          tags.push(trimmed);
        }
      } else if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const name = toOptionalString(record.name ?? record.tag ?? record.value);
        if (name && !tags.includes(name)) {
          tags.push(name);
        }
      }
    }
  }
  return tags;
}

function mapTask(payload: unknown): TaskInfo | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const idValue = record.id ?? record.task_id ?? record.taskId;
  const taskId = toOptionalString(idValue) ?? (toInt(idValue)?.toString() ?? null);
  if (!taskId) {
    return null;
  }
  const nameValue = record.name ?? record.title;
  const name = toOptionalString(nameValue);
  const urlValue = record.url ?? record.permalink ?? record.link ?? record.app_url ?? record.web_url;
  const url = toOptionalString(urlValue) ?? "";
  const tags = collectTags(record.tags ?? record.tag ?? record.labels ?? record.label_names);
  return { taskId, name, url, tags };
}

function firstNumber(values: unknown[]): number | null {
  for (const value of values) {
    const numeric = toInt(value);
    if (numeric !== null) {
      return numeric;
    }
  }
  return null;
}

function firstBoolean(values: unknown[]): boolean | null {
  for (const value of values) {
    const resolved = toBoolean(value);
    if (resolved !== null) {
      return resolved;
    }
  }
  return null;
}

function gatherTasks(payload: unknown): ParsedTasks {
  const record = payload as Record<string, unknown> | null | undefined;
  const dataRecord = record?.data as Record<string, unknown> | null | undefined;
  const pagesRecord = record?.pages as Record<string, unknown> | null | undefined;
  const paginationRecord = record?.pagination as Record<string, unknown> | null | undefined;
  const dataPagination = dataRecord?.pagination as Record<string, unknown> | null | undefined;
  const containers: unknown[] = [];
  if (Array.isArray(record?.tasks)) {
    containers.push(...(record?.tasks as unknown[]));
  }
  if (Array.isArray(record?.data)) {
    containers.push(...(record?.data as unknown[]));
  }
  if (Array.isArray(dataRecord?.tasks)) {
    containers.push(...(dataRecord?.tasks as unknown[]));
  }
  if (Array.isArray(dataRecord?.data)) {
    containers.push(...(dataRecord?.data as unknown[]));
  }
  const tasks: TaskInfo[] = [];
  for (const element of containers) {
    const task = mapTask(element);
    if (task) {
      tasks.push(task);
    }
  }
  const total = firstNumber([
    record?.total,
    record?.total_tasks,
    record?.totalTasks,
    dataRecord?.total,
    paginationRecord?.total,
    pagesRecord?.total,
    dataPagination?.total
  ]);
  const page = firstNumber([record?.page, paginationRecord?.page, pagesRecord?.page, dataPagination?.page, dataRecord?.page]);
  const limit = firstNumber([record?.limit, paginationRecord?.limit, pagesRecord?.limit, dataPagination?.limit, dataRecord?.limit]);
  const hasMore = firstBoolean([
    record?.has_more,
    record?.hasMore,
    paginationRecord?.has_more,
    paginationRecord?.hasMore,
    pagesRecord?.has_more,
    pagesRecord?.hasMore,
    dataPagination?.has_more,
    dataPagination?.hasMore
  ]);
  let resolvedHasMore = hasMore;
  if (resolvedHasMore === null && total !== null && page !== null && limit !== null) {
    resolvedHasMore = (page + 1) * limit < total;
  }
  if (resolvedHasMore === null && limit !== null) {
    resolvedHasMore = tasks.length === limit;
  }
  return { tasks, total, page, limit, hasMore: resolvedHasMore };
}

function mapEntry(payload: unknown): ParsedEntry | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const taskRecord = record.task as Record<string, unknown> | null | undefined;
  const taskIdValue = record.task_id ?? record.taskId ?? taskRecord?.id ?? taskRecord?.task_id ?? taskRecord?.taskId;
  const taskId = toOptionalString(taskIdValue) ?? (toInt(taskIdValue)?.toString() ?? null);
  if (!taskId) {
    return null;
  }
  const memberRecord = record.user as Record<string, unknown> | null | undefined;
  const memberIdValue = memberRecord?.id ?? memberRecord?.user_id ?? memberRecord?.userId ?? record.user_id ?? record.userId ?? record.member_id ?? record.memberId;
  const memberId = toInt(memberIdValue);
  const intervalRecord = record.time_interval ?? record.timeInterval ?? record.interval ?? null;
  const startMs =
    parseTimestamp(record.start) ??
    parseTimestamp(record.start_time) ??
    parseTimestamp(record.started) ??
    parseTimestamp(intervalRecord?.start) ??
    parseTimestamp(intervalRecord?.from) ??
    parseTimestamp(record.date_started) ??
    parseTimestamp(record.dateStarted);
  if (startMs === null) {
    return null;
  }
  const endMsCandidate =
    parseTimestamp(record.end) ??
    parseTimestamp(record.end_time) ??
    parseTimestamp(record.stopped) ??
    parseTimestamp(intervalRecord?.end) ??
    parseTimestamp(intervalRecord?.to) ??
    parseTimestamp(record.date_ended) ??
    parseTimestamp(record.dateEnded);
  let endMs = endMsCandidate ?? startMs;
  if (endMs < startMs) {
    endMs = startMs;
  }
  const durationMs = parseDuration(record, startMs, endMs);
  const billableValue = record.billable ?? record.is_billable ?? record.billing ?? record.isBillable;
  const billable = toBoolean(billableValue) ?? false;
  return { taskId, memberId, startMs, endMs, durationMs: durationMs >= 0 ? durationMs : 0, billable };
}

function gatherEntries(payload: unknown): ParsedEntries {
  const record = payload as Record<string, unknown> | null | undefined;
  const dataRecord = record?.data as Record<string, unknown> | null | undefined;
  const paginationRecord = record?.pagination as Record<string, unknown> | null | undefined;
  const pagesRecord = record?.pages as Record<string, unknown> | null | undefined;
  const dataPagination = dataRecord?.pagination as Record<string, unknown> | null | undefined;
  const containers: unknown[] = [];
  if (Array.isArray(record?.time_entries)) {
    containers.push(...(record?.time_entries as unknown[]));
  }
  if (Array.isArray(record?.entries)) {
    containers.push(...(record?.entries as unknown[]));
  }
  if (Array.isArray(record?.data)) {
    containers.push(...(record?.data as unknown[]));
  }
  if (Array.isArray(dataRecord?.data)) {
    containers.push(...(dataRecord?.data as unknown[]));
  }
  if (Array.isArray(dataRecord?.time_entries)) {
    containers.push(...(dataRecord?.time_entries as unknown[]));
  }
  const entries: ParsedEntry[] = [];
  for (const element of containers) {
    const parsed = mapEntry(element);
    if (parsed) {
      entries.push(parsed);
    }
  }
  const total = firstNumber([
    record?.total,
    record?.total_entries,
    record?.totalEntries,
    dataRecord?.total,
    paginationRecord?.total,
    pagesRecord?.total,
    dataPagination?.total
  ]);
  const page = firstNumber([record?.page, paginationRecord?.page, pagesRecord?.page, dataPagination?.page, dataRecord?.page]);
  const limit = firstNumber([record?.limit, paginationRecord?.limit, pagesRecord?.limit, dataPagination?.limit, dataRecord?.limit]);
  const hasMore = firstBoolean([
    record?.has_more,
    record?.hasMore,
    paginationRecord?.has_more,
    paginationRecord?.hasMore,
    pagesRecord?.has_more,
    pagesRecord?.hasMore,
    dataPagination?.has_more,
    dataPagination?.hasMore
  ]);
  let resolvedHasMore = hasMore;
  if (resolvedHasMore === null && total !== null && page !== null && limit !== null) {
    resolvedHasMore = (page + 1) * limit < total;
  }
  if (resolvedHasMore === null && limit !== null) {
    resolvedHasMore = entries.length === limit;
  }
  return { entries, total, page, limit, hasMore: resolvedHasMore };
}

function isWithinWindow(entry: ParsedEntry, sinceMs: number | null, untilMs: number | null): boolean {
  if (sinceMs !== null && entry.endMs < sinceMs) {
    return false;
  }
  if (untilMs !== null && entry.startMs > untilMs) {
    return false;
  }
  return true;
}

function shrinkTags(items: ReportTaskItemType[]): boolean {
  let target: { taskIndex: number; tagIndex: number } | null = null;
  let maxLength = -1;
  for (let i = 0; i < items.length; i += 1) {
    const tags = items[i]?.tags ?? [];
    for (let j = 0; j < tags.length; j += 1) {
      const value = tags[j];
      if (typeof value === "string" && value.length > maxLength) {
        maxLength = value.length;
        target = { taskIndex: i, tagIndex: j };
      }
    }
  }
  if (!target || maxLength <= 1) {
    return false;
  }
  const current = items[target.taskIndex].tags[target.tagIndex];
  const nextLength = Math.max(0, Math.floor(current.length / 2));
  items[target.taskIndex].tags[target.tagIndex] = current.slice(0, nextLength);
  return true;
}

function shrinkTaskNames(items: ReportTaskItemType[]): boolean {
  let index = -1;
  let maxLength = -1;
  for (let i = 0; i < items.length; i += 1) {
    const value = items[i]?.name;
    if (typeof value === "string" && value.length > maxLength) {
      maxLength = value.length;
      index = i;
    }
  }
  if (index === -1 || maxLength <= 1) {
    return false;
  }
  const current = items[index].name;
  if (typeof current !== "string") {
    return false;
  }
  const nextLength = Math.max(0, Math.floor(current.length / 2));
  items[index].name = current.slice(0, nextLength);
  return true;
}

function enforceLimit(out: OutputType): void {
  const limit = characterLimit();
  let payload = JSON.stringify(out);
  if (payload.length <= limit) {
    return;
  }
  let truncated = false;
  while (payload.length > limit) {
    let changed = false;
    if (shrinkTags(out.byTask)) {
      truncated = true;
      changed = true;
      payload = JSON.stringify(out);
      if (payload.length <= limit) {
        break;
      }
    }
    if (payload.length > limit && shrinkTaskNames(out.byTask)) {
      truncated = true;
      changed = true;
      payload = JSON.stringify(out);
      if (payload.length <= limit) {
        break;
      }
    }
    if (!changed) {
      break;
    }
  }
  if (payload.length > limit) {
    truncated = true;
  }
  if (truncated) {
    out.truncated = true;
    out.guidance = out.guidance ? `${out.guidance}; Output trimmed to character_limit` : "Output trimmed to character_limit";
  }
}

async function fetchTasks(
  gateway: ClickUpGateway,
  buildParams: (page: number, limit: number) => Record<string, unknown>
): Promise<{ tasks: Map<string, TaskInfo>; truncated: boolean }> {
  const tasks = new Map<string, TaskInfo>();
  let page = 0;
  const limit = 100;
  let truncated = false;
  for (let i = 0; i < 50; i += 1) {
    const params = buildParams(page, limit);
    const response = await gateway.search_tasks(params);
    const parsed = gatherTasks(response);
    for (const task of parsed.tasks) {
      if (!tasks.has(task.taskId)) {
        tasks.set(task.taskId, task);
      }
      if (tasks.size >= TASK_CAP) {
        truncated = true;
        break;
      }
    }
    if (tasks.size >= TASK_CAP) {
      break;
    }
    if (parsed.hasMore === true) {
      page = (parsed.page ?? page) + 1;
      continue;
    }
    const limitValue = parsed.limit ?? limit;
    if (parsed.hasMore === null && parsed.tasks.length === limitValue) {
      page = (parsed.page ?? page) + 1;
      continue;
    }
    break;
  }
  return { tasks, truncated };
}

async function fetchEntries(
  gateway: ClickUpGateway,
  teamId: number,
  taskIds: string[],
  memberIds: number[] | undefined,
  since: string | undefined,
  until: string | undefined,
  includeBillable: boolean
): Promise<ParsedEntry[]> {
  const entries: ParsedEntry[] = [];
  let page = 0;
  const limit = 100;
  for (let i = 0; i < 50; i += 1) {
    const params: Record<string, unknown> = {
      taskIds,
      memberIds,
      since,
      until,
      includeBillable,
      includeRunning: false,
      page,
      limit
    };
    const response = await gateway.list_time_entries(teamId, params);
    const parsed = gatherEntries(response);
    entries.push(...parsed.entries);
    if (parsed.hasMore === true) {
      page = (parsed.page ?? page) + 1;
      continue;
    }
    const limitValue = parsed.limit ?? limit;
    if (parsed.hasMore === null && parsed.entries.length === limitValue) {
      page = (parsed.page ?? page) + 1;
      continue;
    }
    if (parsed.entries.length === 0) {
      break;
    }
    break;
  }
  return entries;
}

function aggregateByMember(entries: ParsedEntry[]): OutputType["byMember"] {
  const totals = new Map<number, { total: number; billable: number }>();
  for (const entry of entries) {
    if (entry.memberId === null) {
      continue;
    }
    const stats = totals.get(entry.memberId) ?? { total: 0, billable: 0 };
    stats.total += entry.durationMs;
    if (entry.billable) {
      stats.billable += entry.durationMs;
    }
    totals.set(entry.memberId, stats);
  }
  const rows = Array.from(totals.entries()).map(([memberId, stats]) => ({
    memberId,
    totalMs: stats.total,
    billableMs: stats.billable
  }));
  rows.sort((a, b) => a.memberId - b.memberId);
  return rows;
}

function aggregateByTask(entries: ParsedEntry[], tasks: Map<string, TaskInfo>): ReportTaskItemType[] {
  const totals = new Map<string, { total: number; billable: number }>();
  for (const entry of entries) {
    const stats = totals.get(entry.taskId) ?? { total: 0, billable: 0 };
    stats.total += entry.durationMs;
    if (entry.billable) {
      stats.billable += entry.durationMs;
    }
    totals.set(entry.taskId, stats);
  }
  const rows: ReportTaskItemType[] = [];
  for (const [taskId, stats] of totals.entries()) {
    const info = tasks.get(taskId);
    rows.push({
      taskId,
      name: info?.name ?? null,
      url: info?.url ?? "",
      tags: info?.tags ?? [],
      totalMs: stats.total,
      billableMs: stats.billable
    });
  }
  rows.sort((a, b) => {
    if (b.totalMs !== a.totalMs) {
      return b.totalMs - a.totalMs;
    }
    if (a.taskId < b.taskId) {
      return -1;
    }
    if (a.taskId > b.taskId) {
      return 1;
    }
    return 0;
  });
  return rows;
}

export class ReportTimeForTag {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = ReportForTagInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    try {
      const taskFetch = await fetchTasks(this.gateway, (page, limit) => ({
        teamId: data.teamId,
        page,
        limit,
        include_closed: "true",
        "tags[]": [data.tag]
      }));
      const tasks = taskFetch.tasks;
      const taskIds = Array.from(tasks.keys());
      const sinceMs = data.since ? Date.parse(data.since) : Number.NaN;
      const untilMs = data.until ? Date.parse(data.until) : Number.NaN;
      const sinceFilter = Number.isNaN(sinceMs) ? null : sinceMs;
      const untilFilter = Number.isNaN(untilMs) ? null : untilMs;
      let entries: ParsedEntry[] = [];
      if (taskIds.length > 0) {
        const rawEntries = await fetchEntries(
          this.gateway,
          data.teamId,
          taskIds,
          data.memberIds,
          data.since,
          data.until,
          data.includeBillable
        );
        const filtered = rawEntries.filter(entry => isWithinWindow(entry, sinceFilter, untilFilter));
        entries = filtered.filter(entry => tasks.has(entry.taskId));
      }
      const totalMs = entries.reduce((sum, entry) => sum + entry.durationMs, 0);
      const billableMs = entries.filter(entry => entry.billable).reduce((sum, entry) => sum + entry.durationMs, 0);
      const byMember = aggregateByMember(entries);
      const byTask = aggregateByTask(entries, tasks);
      const out: OutputType = {
        teamId: data.teamId,
        scope: { type: "tag", value: data.tag },
        window: { since: data.since ?? null, until: data.until ?? null },
        totals: { totalMs, billableMs },
        byMember,
        byTask
      };
      if (taskFetch.truncated) {
        out.truncated = true;
        out.guidance = "Task set capped at 500 tasks for reporting";
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

export {
  fetchTasks,
  fetchEntries,
  aggregateByTask,
  aggregateByMember,
  enforceLimit as enforceReportLimit,
  gatherTasks,
  mapTask
};
