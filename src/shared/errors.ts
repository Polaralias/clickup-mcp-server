import { err, type ToolError } from "./Result.js";

export function clickupError(message: string, details?: unknown): ToolError {
  return err("CLICKUP_ERROR", message, details);
}

export function limitExceeded(message: string, details?: unknown): ToolError {
  return err("LIMIT_EXCEEDED", message, details);
}
