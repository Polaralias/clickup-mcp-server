export type ErrorCode = "INVALID_PARAMETER" | "NOT_FOUND" | "RATE_LIMIT" | "UNKNOWN";

type ErrorPayload = { code: ErrorCode; message: string; details?: unknown };

export function mapHttpError(status: number, details?: unknown): ErrorPayload {
  if (status === 400 || status === 422) {
    return attachDetails({ code: "INVALID_PARAMETER", message: "Invalid request parameters" }, details);
  }
  if (status === 401 || status === 403 || status === 404) {
    return attachDetails({ code: "NOT_FOUND", message: "Resource not found or not permitted" }, details);
  }
  if (status === 429) {
    return attachDetails({ code: "RATE_LIMIT", message: "Rate limit exceeded" }, details);
  }
  return attachDetails({ code: "UNKNOWN", message: "Unknown error" }, details);
}

export function badInput(message: string, details?: unknown): ErrorPayload {
  return attachDetails({ code: "INVALID_PARAMETER", message }, details);
}

function attachDetails(payload: ErrorPayload, details?: unknown): ErrorPayload {
  if (typeof details === "undefined") {
    return payload;
  }
  return { ...payload, details };
}
