import { z } from "zod";
import { DocSearchInput, DocSearchOutput, DocSearchItem } from "../../mcp/tools/schemas/doc.js";
import { characterLimit } from "../../config/runtime.js";
import { err, ok, Result } from "../../shared/Result.js";
import { mapHttpError } from "../../shared/Errors.js";
import type { ApiCache } from "../../infrastructure/cache/ApiCache.js";
import type { ClickUpGateway } from "../../infrastructure/clickup/ClickUpGateway.js";
import { BulkProcessor, type WorkItem } from "../services/BulkProcessor.js";
import { createLogger } from "../../shared/logging.js";

const visibilityValues = new Set(["PUBLIC", "PRIVATE", "PERSONAL", "HIDDEN"]);

type DocSearchOutputType = z.infer<typeof DocSearchOutput>;
type DocSearchItemType = z.infer<typeof DocSearchItem>;
type ExtendedDocItem = DocSearchItemType & { content?: string };

type HttpErrorLike = { status?: number; data?: unknown };

type PageFetchResult = { index: number; content: string };

function toStringValue(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value && typeof value === "object" && typeof (value as { toString: unknown }).toString === "function") {
    const result = (value as { toString: () => string }).toString();
    if (typeof result === "string") {
      return result;
    }
  }
  return fallback;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toIntValue(value: unknown): number | null {
  const numeric = toNumberValue(value);
  if (numeric === null) {
    return null;
  }
  const truncated = Math.trunc(numeric);
  if (truncated < 0) {
    return null;
  }
  return truncated;
}

function normaliseVisibility(value: unknown): DocSearchItemType["visibility"] {
  if (typeof value === "string" && visibilityValues.has(value as string)) {
    return value as DocSearchItemType["visibility"];
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function extractContent(payload: unknown): string | null {
  if (typeof payload === "string") {
    return payload;
  }
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const result = extractContent(entry);
      if (result !== null) {
        return result;
      }
    }
    return null;
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidates: unknown[] = [];
    if ("content" in record) {
      candidates.push(record.content);
    }
    if ("body" in record) {
      candidates.push(record.body);
    }
    if ("text" in record) {
      candidates.push(record.text);
    }
    if ("data" in record) {
      candidates.push(record.data);
    }
    if ("value" in record) {
      candidates.push(record.value);
    }
    for (const candidate of candidates) {
      const result = extractContent(candidate);
      if (result !== null) {
        return result;
      }
    }
  }
  return null;
}

function shortenField(
  items: ExtendedDocItem[],
  field: keyof Pick<ExtendedDocItem, "content" | "snippet" | "title">
): boolean {
  let index = -1;
  let maxLength = -1;
  for (let i = 0; i < items.length; i += 1) {
    const current = items[i][field];
    if (typeof current === "string" && current.length > maxLength) {
      index = i;
      maxLength = current.length;
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

function enforceLimit(out: DocSearchOutputType): void {
  const limit = characterLimit();
  let payload = JSON.stringify(out);
  if (payload.length <= limit) {
    return;
  }
  const items = out.results as ExtendedDocItem[];
  let truncated = false;
  const fields: (keyof Pick<ExtendedDocItem, "content" | "snippet" | "title">)[] = [
    "content",
    "snippet",
    "title"
  ];
  for (const field of fields) {
    while (payload.length > limit) {
      if (!shortenField(items, field)) {
        break;
      }
      truncated = true;
      payload = JSON.stringify(out);
    }
  }
  if (truncated) {
    out.truncated = true;
    out.guidance = "Output trimmed to character_limit";
  }
}

export class DocSearch {
  constructor(private readonly gateway: ClickUpGateway, private readonly cache: ApiCache) {}

  async execute(ctx: unknown, input: z.infer<typeof DocSearchInput>): Promise<Result<z.infer<typeof DocSearchOutput>>> {
    void ctx;
    const parsed = DocSearchInput.safeParse(input);
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    try {
      const format = data.contentFormat ?? "text/md";
      const searchDocs = this.gateway.search_docs as unknown as (
        workspaceId: number,
        query: string,
        limit: number,
        page: number,
        options?: { content_format?: string }
      ) => Promise<unknown>;
      const response = await searchDocs(data.workspaceId, data.query, data.limit, data.page, {
        content_format: format
      });
      const payload = response as { total?: unknown; items?: unknown } | null | undefined;
      const rawItems: unknown[] = Array.isArray(payload?.items) ? (payload?.items as unknown[]) : [];
      const results: ExtendedDocItem[] = rawItems.map(item => {
        const record = item as Record<string, unknown> | null | undefined;
        const docValue = record?.doc_id ?? record?.docId ?? (typeof record?.id !== "undefined" ? record?.id : "");
        const pageValue = record?.page_id ?? record?.pageId ?? "";
        const urlValue = record?.url ?? record?.link ?? "";
        const scoreValue = record?.score;
        const updatedValue = record?.updated_at ?? record?.updatedAt;
        const visibilityValue = record?.visibility;
        const element: ExtendedDocItem = {
          docId: toStringValue(docValue, ""),
          pageId: toStringValue(pageValue, ""),
          title: toOptionalString(record?.title ?? null),
          snippet: toOptionalString(record?.snippet ?? null),
          url: toStringValue(urlValue, ""),
          score: (() => {
            const numeric = toNumberValue(scoreValue);
            return numeric === null ? null : numeric;
          })(),
          updatedAt: typeof updatedValue === "string" ? updatedValue : null,
          visibility: normaliseVisibility(visibilityValue)
        };
        return element;
      });
      if (data.expandPages) {
        const pageFormat = data.pageBody?.contentFormat ?? "text/md";
        const limitCount = clamp(data.pageBody?.limit ?? 3, 1, 10);
        const slice = results.slice(0, limitCount);
        const targets = slice.filter(item => item.docId.length > 0 && item.pageId.length > 0);
        if (targets.length > 0) {
          const logger = createLogger("application.doc_search");
          const processor = new BulkProcessor(logger);
          const workItems: WorkItem<PageFetchResult>[] = targets.map((item, workIndex) => {
            return async () => {
              const response = await this.gateway.get_doc_page(
                data.workspaceId,
                item.docId,
                item.pageId,
                pageFormat
              );
              const content = extractContent(response);
              if (content === null) {
                throw new Error("Missing content");
              }
              return { index: workIndex, content };
            };
          });
          const batch = await processor.run(workItems, {
            concurrency: 3,
            retryCount: 1,
            retryDelayMs: 200,
            exponentialBackoff: true,
            continueOnError: true
          });
          for (const success of batch.successful) {
            const target = targets[success.index];
            if (target) {
              target.content = success.content;
            }
          }
        }
      }
      const totalRaw = payload?.total ?? null;
      const totalNumber = toIntValue(totalRaw);
      const total = totalNumber === null ? results.length : totalNumber;
      const out: DocSearchOutputType = {
        total,
        page: data.page,
        limit: data.limit,
        hasMore: (data.page + 1) * data.limit < total,
        results
      };
      enforceLimit(out);
      const formatGuidance = `contentFormat:${format}`;
      if (out.guidance) {
        out.guidance = `${formatGuidance}; ${out.guidance}`;
      } else {
        out.guidance = formatGuidance;
      }
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
