import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { DiagnosticsManager } from "../src/shared/diagnostics/DiagnosticsManager.js";

type CrashEmitter = EventEmitter & { exit?(code?: number): void };

function createProcess(): CrashEmitter {
  const emitter = new EventEmitter() as CrashEmitter;
  emitter.exit = () => undefined;
  return emitter;
}

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(tmpdir(), "diagnostics-test-"));
}

describe("DiagnosticsManager", () => {
  it("redacts sensitive values in stored logs", async () => {
    const dir = await createTempDir();
    const manager = new DiagnosticsManager({ baseDir: dir, processBinding: createProcess() });
    await manager.enable();
    const now = new Date().toISOString();
    await manager.recordLog({
      ts: now,
      level: "info",
      subsystem: "test",
      msg: "sk_live_secret_000 clickup_secret_value",
      extras: { apiKey: "sk_secret_111", nested: { clickupToken: "clickup_hidden_222" } }
    });
    const logPath = path.join(dir, "logs", "diagnostics.log");
    const content = await fs.readFile(logPath, "utf8");
    const lines = content.trim().split("\n");
    const parsed = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
    expect(parsed.msg).toContain("***REDACTED***");
    const extras = parsed.extras as Record<string, unknown>;
    expect(extras.apiKey).toBe("***REDACTED***");
    const nested = (extras.nested as Record<string, unknown>) ?? {};
    expect(nested.clickupToken).toBe("***REDACTED***");
  });

  it("writes crash reports for uncaught exceptions", async () => {
    const dir = await createTempDir();
    const fakeProcess = createProcess();
    const manager = new DiagnosticsManager({ baseDir: dir, processBinding: fakeProcess });
    await manager.enable();
    const error = new Error("boom");
    try {
      fakeProcess.emit("uncaughtException", error);
    } catch (thrown) {
      expect(thrown).toBe(error);
    }
    await delay(20);
    const crashDir = path.join(dir, "crash");
    const files = await fs.readdir(crashDir);
    expect(files.length).toBeGreaterThan(0);
    const crash = JSON.parse(await fs.readFile(path.join(crashDir, files[0]), "utf8")) as Record<string, unknown>;
    expect(crash.type).toBe("uncaught_exception");
    expect(crash.message).toBe("boom");
  });
});
