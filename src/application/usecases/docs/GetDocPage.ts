import { z } from "zod";
import { GetDocPageInput, GetDocPageOutput } from "../../../mcp/tools/schemas/docCrud.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/Errors.js";
import { characterLimit } from "../../../config/runtime.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

type InputType = z.infer<typeof GetDocPageInput>;
type OutputType = z.infer<typeof GetDocPageOutput>;

type HttpErrorLike = { status?: number; data?: unknown };

type DocPagePayload = {
  docId: string;
  pageId: string;
  title: string | null;
  content: string;
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

function extractContent(value: unknown, visited = new Set<unknown>()): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const result = extractContent(entry, visited);
      if (result !== null) {
        return result;
      }
    }
    return null;
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
    record.content,
    record.body,
    record.text,
    record.value,
    record.data,
    record.html,
    record.markdown,
    record.document
  ];
  for (const candidate of candidates) {
    const result = extractContent(candidate, visited);
    if (result !== null) {
      return result;
    }
  }
  return null;
}

function parsePayload(
  payload: unknown,
  fallbackDocId: string,
  fallbackPageId: string,
  fallbackTitle: string | null
): DocPagePayload {
  if (!payload || typeof payload !== "object") {
    return { docId: fallbackDocId, pageId: fallbackPageId, title: fallbackTitle, content: "" };
  }
  const record = payload as Record<string, unknown>;
  const docId =
    toOptionalId(record.doc_id) ??
    toOptionalId(record.docId) ??
    toOptionalId(record.id) ??
    toOptionalId(record.docID) ??
    fallbackDocId;
  const pageId =
    toOptionalId(record.page_id) ??
    toOptionalId(record.pageId) ??
    toOptionalId(record.id) ??
    toOptionalId(record.pageID) ??
    fallbackPageId;
  const title =
    toOptionalString(record.title) ??
    toOptionalString(record.name) ??
    toOptionalString(record.page_title) ??
    toOptionalString(record.pageTitle) ??
    fallbackTitle;
  const content =
    extractContent(record.content) ??
    extractContent(record.body) ??
    extractContent(record.text) ??
    extractContent(record.document) ??
    extractContent(record.data) ??
    "";
  return { docId, pageId, title: title ?? null, content };
}

function shrinkContent(out: OutputType): boolean {
  const value = out.content;
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  const nextLength = Math.max(0, Math.floor(value.length / 2));
  out.content = nextLength > 0 ? value.slice(0, nextLength) : "";
  return true;
}

function shrinkTitle(out: OutputType): boolean {
  const value = out.title;
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  const nextLength = Math.max(0, Math.floor(value.length / 2));
  out.title = nextLength > 0 ? value.slice(0, nextLength) : "";
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
    if (shrinkContent(out)) {
      truncated = true;
      changed = true;
      payload = JSON.stringify(out);
      if (payload.length <= limit) {
        break;
      }
    }
    if (payload.length > limit && shrinkTitle(out)) {
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

export class GetDocPage {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = GetDocPageInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    try {
      const response = await this.gateway.get_doc_page(data.workspaceId, data.docId, data.pageId, data.contentFormat);
      const payload = parsePayload(response, data.docId, data.pageId, null);
      const out: OutputType = {
        docId: payload.docId,
        pageId: payload.pageId,
        title: payload.title,
        content: payload.content,
        contentFormat: data.contentFormat
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
