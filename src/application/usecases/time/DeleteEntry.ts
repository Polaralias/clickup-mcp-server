import { z } from "zod";
import { DeleteEntryInput, TimerOutput } from "../../../mcp/tools/schemas/time.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/httpErrors.js";
import { characterLimit } from "../../../config/runtime.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

type InputType = z.infer<typeof DeleteEntryInput>;
type OutputType = z.infer<typeof TimerOutput>;

type HttpErrorLike = { status?: number; data?: unknown };

function enforceLimit(out: OutputType): void {
  const limit = characterLimit();
  const payload = JSON.stringify(out);
  if (payload.length <= limit) {
    return;
  }
  out.truncated = true;
  out.guidance = out.guidance ? `${out.guidance}; Output trimmed to character_limit` : "Output trimmed to character_limit";
}

export class DeleteEntry {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = DeleteEntryInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    try {
      await this.gateway.delete_time_entry(data.entryId);
      const out: OutputType = { entryId: data.entryId };
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
