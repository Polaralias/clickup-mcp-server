import { z } from "zod";
import { UpdateEntryInput, TimerOutput } from "../../../mcp/tools/schemas/time.js";
import type { TimerSuccessOutput } from "../../../mcp/tools/schemas/time.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/Errors.js";
import { characterLimit } from "../../../config/runtime.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";
import { extractEntryId } from "./StartTimer.js";

type InputType = z.infer<typeof UpdateEntryInput>;
type OutputType = z.infer<typeof TimerOutput>;
type TimerSuccessOutputType = TimerSuccessOutput;

type HttpErrorLike = { status?: number; data?: unknown };

function toEpoch(value: string | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return Number.NaN;
  }
  return parsed;
}

function enforceLimit(out: TimerSuccessOutputType): void {
  const limit = characterLimit();
  const payload = JSON.stringify(out);
  if (payload.length <= limit) {
    return;
  }
  out.truncated = true;
  out.guidance = out.guidance ? `${out.guidance}; Output trimmed to character_limit` : "Output trimmed to character_limit";
}

export class UpdateEntry {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = UpdateEntryInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    const startMs = toEpoch(data.start);
    const endMs = toEpoch(data.end);
    if (startMs !== null && !Number.isFinite(startMs)) {
      return err("INVALID_PARAMETER", "Invalid start time");
    }
    if (endMs !== null && !Number.isFinite(endMs)) {
      return err("INVALID_PARAMETER", "Invalid end time");
    }
    if (startMs !== null && endMs !== null && endMs <= startMs) {
      return err("INVALID_PARAMETER", "end must be after start");
    }
    const body: Record<string, unknown> = {};
    if (startMs !== null) {
      body.start = String(Math.trunc(startMs));
    }
    if (endMs !== null) {
      body.end = String(Math.trunc(endMs));
    }
    if (typeof data.description === "string") {
      body.description = data.description;
    }
    if (typeof data.billable === "boolean") {
      body.billable = data.billable;
    }
    if (data.dryRun === true) {
      const preview = { entryId: data.entryId, body };
      return ok({ dryRun: true as const, preview });
    }
    try {
      const response = await this.gateway.update_time_entry(data.entryId, body);
      const resolvedEntryId = extractEntryId(response) ?? data.entryId;
      const out: TimerSuccessOutputType = { entryId: resolvedEntryId };
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
