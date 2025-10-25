import { beforeEach, afterEach, describe, expect, it } from "vitest";
import "./setup.js";
import { configureLogging, logInfo, withCorrelationId } from "../src/shared/logging.js";

describe("structured logging", () => {
  let writes: string[];
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    writes = [];
    originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void) => {
      const text =
        typeof chunk === "string"
          ? chunk
          : Buffer.from(chunk).toString(typeof encoding === "string" ? encoding : "utf8");
      for (const line of text.split("\n")) {
        if (!line) {
          continue;
        }
        writes.push(line);
      }
      const callback = typeof encoding === "function" ? encoding : cb;
      if (callback) {
        callback(null);
      }
      return true;
    }) as unknown as typeof process.stderr.write;
    configureLogging({ level: "info" });
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  it("emits json lines with subsystem and timestamp", () => {
    logInfo("tests.logging", "shape_check", { event: "observed", count: 1 });
    expect(writes.length).toBeGreaterThan(0);
    const entry = JSON.parse(writes[0]) as Record<string, unknown>;
    expect(typeof entry.ts).toBe("string");
    expect((entry.ts as string).includes("T")).toBe(true);
    expect(entry.level).toBe("info");
    expect(entry.subsystem).toBe("tests.logging");
    expect(entry.msg).toBe("shape_check");
    expect(entry.event).toBe("observed");
    expect(entry.count).toBe(1);
  });

  it("masks sensitive values and carries correlation ids", () => {
    withCorrelationId("corr-123", () => {
      logInfo("tests.logging", "masking", {
        token: "sk_1234567890abcdef",
        headers: { Authorization: "Bearer secret_token_value" },
        plain: "no-secret"
      });
    });
    expect(writes.length).toBeGreaterThan(0);
    const entry = JSON.parse(writes[0]) as Record<string, unknown>;
    expect(entry.token).toBe("***REDACTED***");
    const headers = entry.headers as Record<string, unknown>;
    expect(headers.Authorization).toBe("***REDACTED***");
    expect(entry.plain).toBe("no-secret");
    expect(entry.correlationId).toBe("corr-123");
    expect(writes[0].includes("secret_token_value")).toBe(false);
    expect(writes[0].includes("sk_1234567890abcdef")).toBe(false);
  });
});
