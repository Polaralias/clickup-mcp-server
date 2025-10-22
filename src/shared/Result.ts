export type ToolSuccess<T> = { isError: false; data: T; truncated?: boolean; guidance?: string };
export type ToolError = { isError: true; code: string; message: string; details?: unknown };
export type Result<T> = ToolSuccess<T> | ToolError;

export function ok<T>(data: T, truncated = false, guidance?: string): ToolSuccess<T> {
  const payload: ToolSuccess<T> = { isError: false, data };
  if (truncated) {
    payload.truncated = true;
  }
  if (guidance) {
    payload.guidance = guidance;
  }
  return payload;
}

export function err(code: string, message: string, details?: unknown): ToolError {
  const payload: ToolError = { isError: true, code, message };
  if (typeof details !== "undefined") {
    payload.details = details;
  }
  return payload;
}
