import { z } from "zod";
import { DocSearchInput, DocSearchOutput, DocSearchItem } from "../../mcp/tools/schemas/doc.js";
import { characterLimit } from "../../config/runtime.js";
import { err, ok, Result } from "../../shared/Result.js";
import { mapHttpError } from "../../shared/Errors.js";
import type { ApiCache } from "../../infrastructure/cache/ApiCache.js";
import type { ClickUpGateway } from "../../infrastructure/clickup/ClickUpGateway.js";

const visibilityValues = new Set(["PUBLIC", "PRIVATE", "PERSONAL", "HIDDEN"]);

type DocSearchOutputType = z.infer<typeof DocSearchOutput>;
type DocSearchItemType = z.infer<typeof DocSearchItem>;

type HttpErrorLike = { status?: number; data?: unknown };

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

function shortenField(items: DocSearchItemType[], field: "snippet" | "title"): boolean {
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
  const items = out.results;
  let truncated = false;
  while (payload.length > limit) {
    if (!shortenField(items, "snippet")) {
      break;
    }
    truncated = true;
    payload = JSON.stringify(out);
  }
  while (payload.length > limit) {
    if (!shortenField(items, "title")) {
      break;
    }
    truncated = true;
    payload = JSON.stringify(out);
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
      const response = await this.gateway.search_docs(data.workspaceId, data.query, data.limit, data.page);
      const payload = response as { total?: unknown; items?: unknown } | null | undefined;
      const rawItems: unknown[] = Array.isArray(payload?.items) ? (payload?.items as unknown[]) : [];
      const results: DocSearchItemType[] = rawItems.map(item => {
        const record = item as Record<string, unknown> | null | undefined;
        const docValue = record?.doc_id ?? record?.docId ?? (typeof record?.id !== "undefined" ? record?.id : "");
        const pageValue = record?.page_id ?? record?.pageId ?? "";
        const urlValue = record?.url ?? record?.link ?? "";
        const scoreValue = record?.score;
        const updatedValue = record?.updated_at ?? record?.updatedAt;
        const visibilityValue = record?.visibility;
        const element: DocSearchItemType = {
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
