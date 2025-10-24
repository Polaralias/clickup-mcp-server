import { err, type Result, type ToolError } from "../../shared/Result.js";
import { clickupError } from "../../shared/Errors.js";

type ToolExecutor<TOutput> = (input: unknown, context: unknown) => Promise<Result<TOutput>>;

type HttpErrorLike = {
  status?: unknown;
  data?: unknown;
  message?: unknown;
  response?: { status?: unknown; data?: unknown; message?: unknown } | null;
};

function extractConfirm(args: unknown): string | undefined {
  if (!args || typeof args !== "object") {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  const value = record.confirm;
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function buildHttpMessage(status: number, message: unknown): string {
  if (typeof message === "string" && message.trim().length > 0) {
    return message;
  }
  return `ClickUp request failed (status ${status})`;
}

function normaliseHttpError(error: unknown): ToolError | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const record = error as HttpErrorLike;
  if (typeof record.status === "number") {
    const message = buildHttpMessage(record.status, record.message);
    const details = record.data;
    return clickupError(message, details);
  }
  if (record.response && typeof record.response === "object") {
    const status = record.response.status;
    if (typeof status === "number") {
      const message = buildHttpMessage(status, record.message ?? record.response.message);
      const details = record.response.data;
      return clickupError(message, details);
    }
  }
  return null;
}

export function withSafetyConfirmation<TOutput>(handler: ToolExecutor<TOutput>): ToolExecutor<TOutput> {
  return async (input, context) => {
    const confirm = extractConfirm(input);
    if (confirm !== "yes") {
      return err("INVALID_PARAMETER", "confirm must be 'yes'");
    }
    try {
      return await handler(input, context);
    } catch (error) {
      const mapped = normaliseHttpError(error);
      if (mapped) {
        return mapped;
      }
      const message = error instanceof Error ? error.message : String(error);
      return err("UNKNOWN", message);
    }
  };
}
