import { describe, expect, it } from "vitest";
import "./setup.js";
import { normaliseAcceptHeader } from "../src/server/httpBridge.js";

describe("http bridge accept normalisation", () => {
  it("adds required media types when header is missing", () => {
    expect(normaliseAcceptHeader(undefined)).toBe("application/json, text/event-stream");
  });

  it("appends missing stream type when only json is provided", () => {
    expect(normaliseAcceptHeader("application/json")).toBe("application/json, text/event-stream");
  });

  it("preserves existing parameters while adding missing requirements", () => {
    expect(normaliseAcceptHeader("application/json;q=0.9")).toBe(
      "application/json;q=0.9, text/event-stream"
    );
  });

  it("retains additional types and ensures both requirements are present", () => {
    expect(normaliseAcceptHeader("text/plain, text/event-stream")).toBe(
      "text/plain, text/event-stream, application/json"
    );
  });

  it("handles array-based accept headers", () => {
    expect(normaliseAcceptHeader(["application/json", "text/plain;q=0.1"])).toBe(
      "application/json, text/plain;q=0.1, text/event-stream"
    );
  });
});
