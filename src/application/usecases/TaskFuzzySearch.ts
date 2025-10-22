import {
  TaskFuzzySearchInput,
  TaskFuzzySearchInputType,
  TaskFuzzySearchOutputType,
  TaskHitType
} from "../../mcp/tools/schemas/taskSearch.js";
import { Result, ok, err } from "../../shared/Result.js";
import { characterLimit } from "../../config/runtime.js";
import { TaskSearchIndex, TaskIndexRecord } from "../services/TaskSearchIndex.js";
import type { ClickUpGateway } from "../../infrastructure/clickup/ClickUpGateway.js";

function normaliseScore(score: number | null): number {
  if (typeof score === "number" && Number.isFinite(score)) {
    return score;
  }
  return 1;
}

function normaliseUpdatedAt(value: string | null): number {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function compareHits(a: TaskHitType, b: TaskHitType): number {
  const scoreDiff = normaliseScore(a.score) - normaliseScore(b.score);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }
  const timeDiff = normaliseUpdatedAt(b.updatedAt ?? null) - normaliseUpdatedAt(a.updatedAt ?? null);
  if (timeDiff !== 0) {
    return timeDiff;
  }
  if (a.taskId < b.taskId) {
    return -1;
  }
  if (a.taskId > b.taskId) {
    return 1;
  }
  return 0;
}

function shortenField(items: TaskHitType[], field: "snippet" | "name"): boolean {
  let index = -1;
  let maxLength = -1;
  for (let i = 0; i < items.length; i += 1) {
    const value = items[i][field];
    if (typeof value === "string" && value.length > maxLength) {
      index = i;
      maxLength = value.length;
    }
  }
  if (index === -1 || maxLength <= 0) {
    return false;
  }
  const source = items[index][field];
  if (typeof source !== "string") {
    return false;
  }
  const nextLength = Math.floor(source.length / 2);
  items[index][field] = nextLength > 0 ? source.slice(0, nextLength) : "";
  return true;
}

function enforceLimit(out: TaskFuzzySearchOutputType): void {
  const limit = characterLimit();
  let payload = JSON.stringify(out);
  if (payload.length <= limit) {
    return;
  }
  const items = out.results;
  while (payload.length > limit) {
    if (!shortenField(items, "snippet")) {
      break;
    }
    payload = JSON.stringify(out);
  }
  while (payload.length > limit) {
    if (!shortenField(items, "name")) {
      break;
    }
    payload = JSON.stringify(out);
  }
  out.truncated = true;
  out.guidance = "Output trimmed to character_limit";
}

function toOptionalString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function toStringOrEmpty(value: unknown): string {
  const result = toOptionalString(value);
  if (result === null) {
    return "";
  }
  return result;
}

function toIdString(value: unknown): string | null {
  const result = toOptionalString(value);
  if (result === null || result.length === 0) {
    return null;
  }
  return result;
}

function toAssignees(value: unknown): TaskHitType["assignees"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: TaskHitType["assignees"] = [];
  for (const entry of value) {
    const record = entry as Record<string, unknown> | null | undefined;
    const idRaw = record?.id;
    const idNumber = Number(idRaw);
    if (!Number.isFinite(idNumber)) {
      continue;
    }
    const usernameRaw = record?.username;
    const username = typeof usernameRaw === "string" ? usernameRaw : null;
    result.push({ id: Math.trunc(idNumber), username });
  }
  return result;
}

function toUpdatedAt(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      return new Date(numeric).toISOString();
    }
    const parsed = Date.parse(String(value));
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return null;
}

function recordToHit(record: TaskIndexRecord, score: number | null, matches?: { key: string }[]): TaskHitType {
  const hit: TaskHitType = {
    taskId: record.taskId,
    name: record.name ?? null,
    url: record.url,
    listId: record.listId ?? null,
    listName: record.listName ?? null,
    spaceId: record.spaceId ?? null,
    spaceName: record.spaceName ?? null,
    status: record.status ?? null,
    priority: record.priority ?? null,
    assignees: (record.assignees ?? []).map(item => ({ id: item.id, username: item.username ?? null })),
    score,
    matchedFields: matches ? matches.map(item => item.key) : [],
    snippet: null,
    updatedAt: record.updatedAt ?? null
  };
  return hit;
}

function fallbackToHit(task: unknown, taskId: string): TaskHitType {
  const record = task as Record<string, unknown> | null | undefined;
  const urlValue = record?.url ?? record?.permalink ?? record?.link ?? undefined;
  const listRecord = record?.list as Record<string, unknown> | null | undefined;
  const spaceRecord = record?.space as Record<string, unknown> | null | undefined;
  const listId = toIdString(listRecord?.id ?? record?.list_id);
  const spaceId = toIdString(spaceRecord?.id ?? record?.space_id);
  const updated = toUpdatedAt(record?.date_updated ?? record?.dateUpdated ?? record?.updated_at ?? record?.updatedAt);
  const assignees = toAssignees(record?.assignees ?? []);
  return {
    taskId,
    name: toOptionalString(record?.name ?? record?.title ?? null),
    url: toStringOrEmpty(urlValue),
    listId,
    listName: toOptionalString(listRecord?.name ?? null),
    spaceId,
    spaceName: toOptionalString(spaceRecord?.name ?? null),
    status: toOptionalString(record?.status ?? null),
    priority: toOptionalString(record?.priority ?? null),
    assignees,
    score: null,
    matchedFields: ["id"],
    snippet: null,
    updatedAt: updated
  };
}

export class TaskFuzzySearch {
  constructor(private readonly index: TaskSearchIndex, private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: TaskFuzzySearchInputType): Promise<Result<TaskFuzzySearchOutputType>> {
    void ctx;
    const parsed = TaskFuzzySearchInput.safeParse(input);
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    const started = Date.now();
    try {
      await this.index.ensure(data.scope);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err("TASK_INDEX_ERROR", message);
    }
    const limit = data.limit;
    const looksLikeId = /^[A-Za-z0-9\-]{6,}$/.test(data.query);
    const hitsRaw = this.index.search(data.query, limit);
    const mapped: TaskHitType[] = hitsRaw.map(entry =>
      recordToHit(entry.item, entry.score, entry.matches)
    );
    if (looksLikeId && !mapped.some(item => item.taskId === data.query)) {
      try {
        const response = await this.gateway.get_task_by_id(data.query);
        const raw = response as Record<string, unknown> | null | undefined;
        const resolvedId = toIdString(raw?.id ?? raw?.task_id ?? raw?.taskId ?? data.query) ?? data.query;
        const fallback = fallbackToHit(response, resolvedId);
        mapped.unshift(fallback);
        if (mapped.length > limit) {
          mapped.length = limit;
        }
      } catch (error) {
        void error;
      }
    }
    mapped.sort(compareHits);
    if (mapped.length > limit) {
      mapped.length = limit;
    }
    const tookMs = Date.now() - started;
    const out: TaskFuzzySearchOutputType = {
      totalIndexed: this.index.count,
      tookMs: tookMs < 0 ? 0 : tookMs,
      results: mapped
    };
    enforceLimit(out);
    return ok(out, out.truncated === true, out.guidance);
  }
}
