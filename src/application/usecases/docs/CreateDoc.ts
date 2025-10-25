import { z } from "zod";
import { CreateDocInput, CreateDocOutput } from "../../../mcp/tools/schemas/docCrud.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/Errors.js";
import { characterLimit } from "../../../config/runtime.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

type InputType = z.infer<typeof CreateDocInput>;
type OutputType = z.infer<typeof CreateDocOutput>;

type HttpErrorLike = { status?: number; data?: unknown };

type DocRefLike = { docId?: string; url?: string; title?: string | null };

function toOptionalId(value: unknown): string | undefined {
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

function toOptionalString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function extractDocRef(payload: unknown, visited = new Set<unknown>()): DocRefLike {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  if (visited.has(payload)) {
    return {};
  }
  visited.add(payload);
  const record = payload as Record<string, unknown>;
  let docId =
    toOptionalId(record.doc_id) ??
    toOptionalId(record.docId) ??
    toOptionalId(record.id) ??
    toOptionalId(record.docID) ??
    toOptionalId(record.document_id) ??
    toOptionalId(record.documentId);
  const urlValue =
    record.url ??
    record.permalink ??
    record.link ??
    record.web_url ??
    record.app_url ??
    record.html_url;
  let url: string | undefined;
  if (typeof urlValue === "string" && urlValue.length > 0) {
    url = urlValue;
  }
  let title =
    toOptionalString(record.title) ??
    toOptionalString(record.name) ??
    toOptionalString(record.doc_title) ??
    toOptionalString(record.docTitle);
  const nested: unknown[] = [];
  const arrayKeys = ["docs", "pages", "items", "results", "children"];
  for (const key of arrayKeys) {
    const value = record[key];
    if (Array.isArray(value)) {
      nested.push(...value);
    }
  }
  const objectKeys = ["doc", "data", "result", "page", "resource", "body"];
  for (const key of objectKeys) {
    if (key in record) {
      nested.push(record[key]);
    }
  }
  for (const entry of nested) {
    const candidate = extractDocRef(entry, visited);
    if (!docId && candidate.docId) {
      docId = candidate.docId;
    }
    if (!url && candidate.url) {
      url = candidate.url;
    }
    if (!title && typeof candidate.title === "string") {
      title = candidate.title;
    }
    if (docId && url && title) {
      break;
    }
  }
  return { docId, url, title: typeof title === "string" ? title : title ?? null };
}

function shrinkTitle(out: OutputType): boolean {
  const value = out.doc.title;
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  const nextLength = Math.max(0, Math.floor(value.length / 2));
  out.doc.title = nextLength > 0 ? value.slice(0, nextLength) : "";
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
    if (!shrinkTitle(out)) {
      break;
    }
    truncated = true;
    payload = JSON.stringify(out);
  }
  if (payload.length > limit) {
    truncated = true;
  }
  if (truncated) {
    out.truncated = true;
    out.guidance = out.guidance ? `${out.guidance}; Output trimmed to character_limit` : "Output trimmed to character_limit";
  }
}

export class CreateDoc {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = CreateDocInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    const body = { title: data.title, visibility: data.visibility };
    if (data.dryRun === true) {
      return ok({ dryRun: true as const, preview: { title: body.title, visibility: body.visibility } });
    }
    try {
      const response = await this.gateway.create_doc(data.workspaceId, body);
      const ref = extractDocRef(response);
      const docId = ref.docId ?? data.title;
      const docTitle = typeof ref.title === "string" ? ref.title : data.title;
      const doc: OutputType["doc"] = { docId, title: docTitle };
      if (ref.url) {
        doc.url = ref.url;
      }
      const out: OutputType = { doc };
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
