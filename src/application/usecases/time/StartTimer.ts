import { z } from "zod";
import { StartTimerInput, TimerOutput } from "../../../mcp/tools/schemas/time.js";
import { Result, ok, err } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/httpErrors.js";
import { characterLimit } from "../../../config/runtime.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";

type InputType = z.infer<typeof StartTimerInput>;
type OutputType = z.infer<typeof TimerOutput>;

type HttpErrorLike = { status?: number; data?: unknown };

type ExtractContext = { visited: Set<unknown> };

function toId(value: unknown): string | undefined {
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

function extractFromArray(value: unknown, ctx: ExtractContext): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const element of value) {
    const result = extractEntryIdInternal(element, ctx);
    if (result) {
      return result;
    }
  }
  return undefined;
}

function extractEntryIdInternal(payload: unknown, ctx: ExtractContext): string | undefined {
  if (typeof payload === "string" && payload.length > 0) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  if (ctx.visited.has(payload)) {
    return undefined;
  }
  ctx.visited.add(payload);
  const record = payload as Record<string, unknown>;
  const direct =
    toId(record.entryId) ??
    toId(record.entry_id) ??
    toId(record.id) ??
    toId(record.ID) ??
    toId(record.time_entry_id) ??
    toId(record.timeEntryId);
  if (direct) {
    return direct;
  }
  for (const key of ["data", "entry", "time_entry", "result", "item", "response"]) {
    if (key in record) {
      const nested = extractEntryIdInternal(record[key], ctx);
      if (nested) {
        return nested;
      }
    }
  }
  for (const key of ["entries", "time_entries", "items"]) {
    if (key in record) {
      const nested = extractFromArray(record[key], ctx);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

export function extractEntryId(payload: unknown): string | undefined {
  return extractEntryIdInternal(payload, { visited: new Set() });
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

function isTimerConflict(error: HttpErrorLike): boolean {
  if (!error || typeof error.status !== "number") {
    return false;
  }
  if (error.status !== 400 && error.status !== 409) {
    return false;
  }
  const data = error.data;
  const candidates: unknown[] = [];
  if (typeof data === "string") {
    candidates.push(data);
  } else if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["error", "message", "err", "detail"]) {
      if (key in record) {
        candidates.push(record[key]);
      }
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalised = candidate.toLowerCase();
    if (normalised.includes("already") && normalised.includes("running")) {
      return true;
    }
  }
  return false;
}

export class StartTimer {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = StartTimerInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    const body: Record<string, unknown> = {};
    if (typeof data.description === "string" && data.description.length > 0) {
      body.description = data.description;
    }
    if (data.dryRun === true) {
      return ok({ dryRun: true as const, preview: { action: "start", taskId: data.taskId, body } });
    }
    try {
      const response = await this.gateway.start_timer(data.taskId, body);
      const entryId = extractEntryId(response);
      const out: OutputType = { taskId: data.taskId, started: true, running: true };
      if (entryId) {
        out.entryId = entryId;
      }
      enforceLimit(out);
      return ok(out, out.truncated === true, out.guidance);
    } catch (error) {
      const httpError = error as HttpErrorLike;
      if (isTimerConflict(httpError)) {
        return err("INVALID_PARAMETER", "A timer is already running for this user. Stop it first.");
      }
      if (httpError && typeof httpError.status === "number") {
        const mapped = mapHttpError(httpError.status, httpError.data);
        return err(mapped.code, mapped.message, mapped.details);
      }
      const message = error instanceof Error ? error.message : String(error);
      return err("UNKNOWN", message);
    }
  }
}
