import { z } from "zod";
import { StopTimerInput, TimerOutput } from "../../../mcp/tools/schemas/time.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/httpErrors.js";
import { characterLimit } from "../../../config/runtime.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";
import { extractEntryId } from "./StartTimer.js";

type InputType = z.infer<typeof StopTimerInput>;
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

export class StopTimer {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = StopTimerInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    if (data.dryRun === true) {
      return ok({ dryRun: true as const, preview: { action: "stop", taskId: data.taskId } });
    }
    try {
      const response = await this.gateway.stop_timer(data.taskId);
      const entryId = extractEntryId(response);
      const out: OutputType = { taskId: data.taskId, stopped: true, running: false };
      if (entryId) {
        out.entryId = entryId;
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
