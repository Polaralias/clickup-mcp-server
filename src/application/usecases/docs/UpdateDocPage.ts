import { z } from "zod";
import { UpdateDocPageInput, UpdateDocPageOutput } from "../../../mcp/tools/schemas/docCrud.js";
import type { UpdateDocPageSuccessOutput } from "../../../mcp/tools/schemas/docCrud.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/httpErrors.js";
import { characterLimit } from "../../../config/runtime.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

type InputType = z.infer<typeof UpdateDocPageInput>;
type OutputType = z.infer<typeof UpdateDocPageOutput>;
type UpdateDocPageSuccessOutputType = UpdateDocPageSuccessOutput;

type HttpErrorLike = { status?: number; data?: unknown };

function enforceLimit(out: UpdateDocPageSuccessOutputType): void {
  const limit = characterLimit();
  const payload = JSON.stringify(out);
  if (payload.length > limit) {
    out.truncated = true;
    out.guidance = "Output trimmed to character_limit";
  }
}

export class UpdateDocPage {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = UpdateDocPageInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    const body: Record<string, unknown> = {
      content_format: data.contentFormat,
      content: data.content
    };
    if (typeof data.title === "string") {
      body.title = data.title;
    }
    if (data.dryRun === true) {
      const preview = {
        workspaceId: data.workspaceId,
        docId: data.docId,
        pageId: data.pageId,
        body
      };
      return ok({ dryRun: true as const, preview });
    }
    try {
      await this.gateway.update_doc_page(data.workspaceId, data.docId, data.pageId, body);
      const out: UpdateDocPageSuccessOutputType = { docId: data.docId, pageId: data.pageId, updated: true };
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
