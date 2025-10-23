import { z } from "zod";
import { ListDocPagesInput, ListDocPagesOutput, DocPageItem } from "../../../mcp/tools/schemas/docCrud.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/Errors.js";
import { characterLimit } from "../../../config/runtime.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

type InputType = z.infer<typeof ListDocPagesInput>;
type OutputType = z.infer<typeof ListDocPagesOutput>;
type DocPageItemType = z.infer<typeof DocPageItem>;

type HttpErrorLike = { status?: number; data?: unknown };

type ParsedPages = {
  items: DocPageItemType[];
  total: number | null;
  page: number | null;
  limit: number | null;
  hasMore: boolean | null;
};

function toOptionalId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return null;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  return null;
}

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
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "true" || trimmed === "1") {
      return true;
    }
    if (trimmed === "false" || trimmed === "0") {
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

function toDateString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
    return trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Math.trunc(value)).toISOString();
  }
  if (typeof value === "bigint") {
    return new Date(Number(value)).toISOString();
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) {
      const nested = toDateString(record.value);
      if (nested) {
        return nested;
      }
    }
    if ("date" in record) {
      const nested = toDateString(record.date);
      if (nested) {
        return nested;
      }
    }
    if ("timestamp" in record) {
      const nested = toDateString(record.timestamp);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function extractText(value: unknown, visited = new Set<unknown>()): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  if (visited.has(value)) {
    return null;
  }
  visited.add(value);
  const record = value as Record<string, unknown>;
  const candidates = [
    record.text,
    record.snippet,
    record.excerpt,
    record.summary,
    record.description,
    record.body,
    record.content,
    record.value
  ];
  for (const candidate of candidates) {
    const result = extractText(candidate, visited);
    if (result !== null) {
      return result;
    }
  }
  return null;
}

function mapPage(payload: unknown): DocPageItemType | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const pageId =
    toOptionalId(record.page_id) ??
    toOptionalId(record.pageId) ??
    toOptionalId(record.id) ??
    toOptionalId(record.ID);
  if (!pageId) {
    return null;
  }
  const title =
    toOptionalString(record.title) ??
    toOptionalString(record.name) ??
    toOptionalString(record.page_title) ??
    toOptionalString(record.pageTitle);
  const snippet =
    extractText(record.snippet) ??
    extractText(record.excerpt) ??
    extractText(record.summary) ??
    extractText(record.preview) ??
    extractText(record.body) ??
    extractText(record.content);
  const updatedAtValue =
    record.updated_at ??
    record.updatedAt ??
    record.date_updated ??
    record.dateUpdated ??
    record.modified_at ??
    record.modifiedAt ??
    record.last_updated ??
    record.lastUpdated;
  const updatedAt = toDateString(updatedAtValue);
  const urlValue =
    record.url ??
    record.permalink ??
    record.link ??
    record.page_url ??
    record.web_url ??
    record.app_url ??
    record.html_url;
  const url = typeof urlValue === "string" && urlValue.length > 0 ? urlValue : "";
  return {
    pageId,
    title: title ?? null,
    snippet: snippet ?? null,
    updatedAt,
    url
  };
}

function gatherPages(payload: unknown): ParsedPages {
  const record = payload as Record<string, unknown> | null | undefined;
  const dataRecord = record?.data as Record<string, unknown> | null | undefined;
  const paginationRecord = record?.pagination as Record<string, unknown> | null | undefined;
  const containers: unknown[] = [];
  const possibleArrays = [
    record?.pages,
    record?.items,
    record?.data,
    dataRecord?.pages,
    dataRecord?.items,
    dataRecord?.data,
    paginationRecord?.pages
  ];
  for (const candidate of possibleArrays) {
    if (Array.isArray(candidate)) {
      containers.push(...candidate);
    }
  }
  const items: DocPageItemType[] = [];
  for (const entry of containers) {
    const page = mapPage(entry);
    if (page) {
      items.push(page);
    }
  }
  const total =
    toInt(record?.total) ??
    toInt(record?.total_pages) ??
    toInt(record?.totalPages) ??
    toInt(dataRecord?.total) ??
    toInt(dataRecord?.total_pages) ??
    toInt(paginationRecord?.total);
  const page =
    toInt(record?.page) ??
    toInt(record?.current_page) ??
    toInt(record?.page_index) ??
    toInt(paginationRecord?.page) ??
    toInt(dataRecord?.page);
  const limit =
    toInt(record?.limit) ??
    toInt(record?.per_page) ??
    toInt(record?.page_size) ??
    toInt(paginationRecord?.limit) ??
    toInt(dataRecord?.limit);
  const hasMore =
    toBoolean(record?.has_more) ??
    toBoolean(record?.hasMore) ??
    toBoolean(paginationRecord?.has_more) ??
    toBoolean(paginationRecord?.hasMore) ??
    toBoolean(dataRecord?.has_more) ??
    toBoolean(dataRecord?.hasMore);
  return { items, total, page, limit, hasMore };
}

function shrinkTitles(items: DocPageItemType[]): boolean {
  let index = -1;
  let maxLength = -1;
  for (let i = 0; i < items.length; i += 1) {
    const value = items[i]?.title;
    if (typeof value === "string" && value.length > maxLength) {
      index = i;
      maxLength = value.length;
    }
  }
  if (index === -1 || maxLength <= 0) {
    return false;
  }
  const current = items[index].title;
  if (typeof current !== "string") {
    return false;
  }
  const nextLength = Math.max(0, Math.floor(current.length / 2));
  items[index].title = nextLength > 0 ? current.slice(0, nextLength) : "";
  return true;
}

function shrinkSnippets(items: DocPageItemType[]): boolean {
  let index = -1;
  let maxLength = -1;
  for (let i = 0; i < items.length; i += 1) {
    const value = items[i]?.snippet;
    if (typeof value === "string" && value.length > maxLength) {
      index = i;
      maxLength = value.length;
    }
  }
  if (index === -1 || maxLength <= 0) {
    return false;
  }
  const current = items[index].snippet;
  if (typeof current !== "string") {
    return false;
  }
  const nextLength = Math.max(0, Math.floor(current.length / 2));
  items[index].snippet = nextLength > 0 ? current.slice(0, nextLength) : "";
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
    if (shrinkTitles(out.results)) {
      truncated = true;
      changed = true;
      payload = JSON.stringify(out);
      if (payload.length <= limit) {
        break;
      }
    }
    if (payload.length > limit && shrinkSnippets(out.results)) {
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

function timestampForSort(value: string | null): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
    return numeric;
  }
  return Number.NEGATIVE_INFINITY;
}

export class ListDocPages {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = ListDocPagesInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    try {
      const response = await this.gateway.list_doc_pages(data.workspaceId, data.docId, { limit: data.limit, page: data.page });
      const parsedPages = gatherPages(response);
      parsedPages.items.sort((a, b) => {
        const aTime = timestampForSort(a.updatedAt);
        const bTime = timestampForSort(b.updatedAt);
        if (bTime !== aTime) {
          return bTime - aTime;
        }
        if (a.pageId < b.pageId) {
          return -1;
        }
        if (a.pageId > b.pageId) {
          return 1;
        }
        return 0;
      });
      const limited = parsedPages.items.slice(0, data.limit);
      const resolvedTotal = parsedPages.total !== null ? parsedPages.total : data.page * data.limit + limited.length;
      let hasMore = parsedPages.hasMore;
      if (hasMore === null) {
        if (parsedPages.total !== null) {
          hasMore = (data.page + 1) * data.limit < parsedPages.total;
        } else {
          hasMore = limited.length === data.limit;
        }
      }
      const out: OutputType = {
        total: resolvedTotal,
        page: data.page,
        limit: data.limit,
        hasMore: hasMore ?? false,
        results: limited
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
