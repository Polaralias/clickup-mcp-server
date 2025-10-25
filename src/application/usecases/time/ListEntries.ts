import { z } from "zod";
import { ListEntriesInput, ListEntriesOutput, TimeEntryItem } from "../../../mcp/tools/schemas/time.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/httpErrors.js";
import { characterLimit } from "../../../config/runtime.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

type InputType = z.infer<typeof ListEntriesInput>;
type OutputType = z.infer<typeof ListEntriesOutput>;
type TimeEntryItemType = z.infer<typeof TimeEntryItem>;

type HttpErrorLike = { status?: number; data?: unknown };

type ParsedEntry = { startMs: number; endMs: number; item: TimeEntryItemType };

type ParsedResponse = {
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

function toStringOrNull(value: unknown): string | null {
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

function ensureIso(ms: number): string {
  const safe = Number.isFinite(ms) ? ms : 0;
  const date = new Date(safe);
  if (Number.isNaN(date.getTime())) {
    return new Date(0).toISOString();
  }
  return date.toISOString();
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

function parseMember(record: Record<string, unknown> | null | undefined, fallback: Record<string, unknown> | null | undefined): {
  id: number | null;
  name: string | null;
} {
  const primary = record ?? fallback ?? null;
  const idValue = primary?.id ?? primary?.user_id ?? primary?.userId ?? primary?.member_id ?? primary?.memberId;
  let id = toInt(idValue);
  if (id === null) {
    const fallbackId = fallback?.user_id ?? fallback?.userId ?? fallback?.id;
    id = toInt(fallbackId);
  }
  const nameValue =
    primary?.username ??
    primary?.name ??
    primary?.full_name ??
    primary?.fullName ??
    primary?.email ??
    fallback?.username ??
    fallback?.name ??
    fallback?.full_name ??
    fallback?.email;
  const name = toStringOrNull(nameValue) ?? null;
  return { id, name };
}

function mapEntry(payload: unknown): ParsedEntry | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const entryIdValue =
    record.id ??
    record.entry_id ??
    record.entryId ??
    record.time_entry_id ??
    record.timeEntryId;
  const entryId = toStringOrNull(entryIdValue) ?? (toInt(entryIdValue)?.toString() ?? null);
  if (!entryId) {
    return null;
  }
  const taskRecord = record.task as Record<string, unknown> | null | undefined;
  const taskIdValue = record.task_id ?? record.taskId ?? taskRecord?.id ?? taskRecord?.task_id ?? taskRecord?.taskId;
  const taskId = toStringOrNull(taskIdValue) ?? (toInt(taskIdValue)?.toString() ?? null);
  if (!taskId) {
    return null;
  }
  const userRecord = record.user as Record<string, unknown> | null | undefined;
  const memberRecord = record.member as Record<string, unknown> | null | undefined;
  const assigneeRecord = record.assignee as Record<string, unknown> | null | undefined;
  const member = parseMember(userRecord ?? memberRecord ?? assigneeRecord ?? null, record as Record<string, unknown>);
  let memberId: number | null = member.id;
  if (memberId === null) {
    const explicitId = toInt(record.user_id ?? record.userId ?? record.member_id ?? record.memberId ?? record.assignee);
    if (explicitId === null) {
      return null;
    }
    memberId = explicitId;
  }
  if (memberId === null || !Number.isFinite(memberId)) {
    return null;
  }
  const resolvedMemberId = Math.trunc(memberId);
  const resolvedMemberName =
    typeof member.name === "string" && member.name.length > 0 ? member.name : null;
  const intervalCandidate = record.time_interval ?? record.timeInterval ?? record.interval ?? null;
  const intervalRecord =
    intervalCandidate && typeof intervalCandidate === "object"
      ? (intervalCandidate as Record<string, unknown>)
      : null;
  const startMs =
    parseTimestamp(record.start) ??
    parseTimestamp(record.start_time) ??
    parseTimestamp(record.started) ??
    parseTimestamp(record.date_started) ??
    parseTimestamp(record.dateStarted) ??
    parseTimestamp(intervalRecord?.start) ??
    parseTimestamp(intervalRecord?.from) ??
    parseTimestamp(record.created_at) ??
    parseTimestamp(record.begin);
  if (startMs === null) {
    return null;
  }
  const endMsCandidate =
    parseTimestamp(record.end) ??
    parseTimestamp(record.end_time) ??
    parseTimestamp(record.stopped) ??
    parseTimestamp(record.date_ended) ??
    parseTimestamp(record.dateEnded) ??
    parseTimestamp(intervalRecord?.end) ??
    parseTimestamp(intervalRecord?.to) ??
    parseTimestamp(record.updated_at) ??
    parseTimestamp(record.finish);
  let endMs = endMsCandidate ?? startMs;
  if (endMs < startMs) {
    endMs = startMs;
  }
  const durationMs = parseDuration(record, startMs, endMs);
  const descriptionValue =
    record.description ??
    record.note ??
    record.notes ??
    record.summary ??
    record.comment ??
    record.title;
  const description = toStringOrNull(descriptionValue);
  const billableValue = record.billable ?? record.is_billable ?? record.billing ?? record.isBillable;
  const billable = toBoolean(billableValue);
  const item: TimeEntryItemType = {
    entryId,
    taskId,
    memberId: resolvedMemberId,
    memberName: resolvedMemberName,
    start: ensureIso(startMs),
    end: ensureIso(endMs),
    durationMs: durationMs >= 0 ? durationMs : 0,
    description: description !== null ? description : null,
    billable: billable === null ? false : billable
  };
  return { startMs, endMs, item };
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

function gatherEntries(payload: unknown): ParsedResponse {
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
  if (Array.isArray(dataRecord?.entries)) {
    containers.push(...(dataRecord?.entries as unknown[]));
  }
  const seen = new Set<string>();
  const entries: ParsedEntry[] = [];
  for (const element of containers) {
    const parsed = mapEntry(element);
    if (parsed && !seen.has(parsed.item.entryId)) {
      seen.add(parsed.item.entryId);
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
    dataPagination?.hasMore,
    dataRecord?.has_more,
    dataRecord?.hasMore
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

function buildByMember(entries: ParsedEntry[]): OutputType["byMember"] {
  const totals = new Map<number, { total: number; billable: number }>();
  for (const entry of entries) {
    const memberId = entry.item.memberId;
    const stats = totals.get(memberId) ?? { total: 0, billable: 0 };
    stats.total += entry.item.durationMs;
    if (entry.item.billable) {
      stats.billable += entry.item.durationMs;
    }
    totals.set(memberId, stats);
  }
  const rows = Array.from(totals.entries()).map(([memberId, stats]) => ({
    memberId,
    totalMs: stats.total,
    billableMs: stats.billable
  }));
  rows.sort((a, b) => a.memberId - b.memberId);
  return rows;
}

function shrinkDescription(items: TimeEntryItemType[]): boolean {
  let targetIndex = -1;
  let maxLength = -1;
  for (let i = 0; i < items.length; i += 1) {
    const value = items[i]?.description;
    if (typeof value === "string" && value.length > maxLength) {
      maxLength = value.length;
      targetIndex = i;
    }
  }
  if (targetIndex === -1 || maxLength <= 1) {
    return false;
  }
  const item = items[targetIndex];
  if (!item || typeof item.description !== "string") {
    return false;
  }
  const nextLength = Math.max(0, Math.floor(item.description.length / 2));
  item.description = item.description.slice(0, nextLength);
  return true;
}

function shrinkMemberName(items: TimeEntryItemType[]): boolean {
  let targetIndex = -1;
  let maxLength = -1;
  for (let i = 0; i < items.length; i += 1) {
    const value = items[i]?.memberName;
    if (typeof value === "string" && value.length > maxLength) {
      maxLength = value.length;
      targetIndex = i;
    }
  }
  if (targetIndex === -1 || maxLength <= 1) {
    return false;
  }
  const item = items[targetIndex];
  if (!item || typeof item.memberName !== "string") {
    return false;
  }
  const nextLength = Math.max(0, Math.floor(item.memberName.length / 2));
  item.memberName = item.memberName.slice(0, nextLength);
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
    if (shrinkDescription(out.results)) {
      truncated = true;
      changed = true;
      payload = JSON.stringify(out);
      if (payload.length <= limit) {
        break;
      }
    }
    if (payload.length > limit && shrinkMemberName(out.results)) {
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

export class ListEntries {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = ListEntriesInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    const params: Record<string, unknown> = {
      memberIds: data.memberIds,
      taskIds: data.taskIds,
      since: data.since,
      until: data.until,
      page: data.page,
      limit: data.limit,
      includeRunning: data.includeRunning,
      includeBillable: data.includeBillable
    };
    try {
      const response = await this.gateway.list_time_entries(data.teamId, params);
      const parsedResponse = gatherEntries(response);
      const sortedEntries = parsedResponse.entries.slice();
      sortedEntries.sort((a, b) => {
        if (a.startMs !== b.startMs) {
          return a.startMs - b.startMs;
        }
        if (a.item.entryId < b.item.entryId) {
          return -1;
        }
        if (a.item.entryId > b.item.entryId) {
          return 1;
        }
        return 0;
      });
      const results = sortedEntries.map(entry => entry.item);
      const total = parsedResponse.total !== null && parsedResponse.total >= 0 ? parsedResponse.total : results.length;
      const hasMore =
        parsedResponse.hasMore !== null
          ? parsedResponse.hasMore
          : total > (data.page + 1) * data.limit || results.length === data.limit;
      const byMember = buildByMember(sortedEntries);
      const out: OutputType = {
        total,
        page: data.page,
        limit: data.limit,
        hasMore,
        results,
        byMember
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
