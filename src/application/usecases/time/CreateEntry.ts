import { z } from "zod";
import { CreateEntryInput, TimerOutput } from "../../../mcp/tools/schemas/time.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/Errors.js";
import { characterLimit } from "../../../config/runtime.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";
import { extractEntryId } from "./StartTimer.js";

type InputType = z.infer<typeof CreateEntryInput>;
type OutputType = z.infer<typeof TimerOutput>;

type HttpErrorLike = { status?: number; data?: unknown };

function toEpoch(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return Number.NaN;
  }
  return parsed;
}

function enforceLimit(out: OutputType): void {
  const limit = characterLimit();
  const payload = JSON.stringify(out);
  if (payload.length <= limit) {
    return;
  }
  out.truncated = true;
  out.guidance = out.guidance ? `${out.guidance}; Output trimmed to character_limit` : "Output trimmed to character_limit";
}

export class CreateEntry {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = CreateEntryInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    const startMs = toEpoch(data.start);
    const endMs = toEpoch(data.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return err("INVALID_PARAMETER", "Invalid date range");
    }
    if (endMs <= startMs) {
      return err("INVALID_PARAMETER", "end must be after start");
    }
    const body: Record<string, unknown> = {
      start: String(Math.trunc(startMs)),
      end: String(Math.trunc(endMs)),
      billable: data.billable
    };
    if (typeof data.description === "string" && data.description.length > 0) {
      body.description = data.description;
    }
    if (typeof data.memberId === "number" && Number.isFinite(data.memberId)) {
      body.assignee = Math.trunc(data.memberId);
    }
    if (data.dryRun === true) {
      return ok({ dryRun: true as const, preview: { action: "create", taskId: data.taskId, body } });
    }
    try {
      const response = await this.gateway.create_time_entry(data.taskId, body);
      const entryId = extractEntryId(response);
      const out: OutputType = { taskId: data.taskId };
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
