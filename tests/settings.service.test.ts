import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { SettingsService } from "../src/application/services/SettingsService.js";
import { DiagnosticsManager } from "../src/shared/diagnostics/DiagnosticsManager.js";

type CrashEmitter = EventEmitter & { exit?(code?: number): void };

function createProcess(): CrashEmitter {
  const emitter = new EventEmitter() as CrashEmitter;
  emitter.exit = () => undefined;
  return emitter;
}

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(tmpdir(), "settings-test-"));
}

describe("SettingsService", () => {
  it("defaults diagnostics to disabled and toggles state", async () => {
    const dir = await createTempDir();
    const diagnostics = new DiagnosticsManager({ baseDir: dir, processBinding: createProcess() });
    const service = new SettingsService(diagnostics);
    expect(service.getSettings().diagnosticsEnabled).toBe(false);
    await expect(service.exportSupportBundle({
      appVersion: "1.0.0",
      deviceModel: "Pixel 8",
      androidVersion: "14",
      featureFlags: []
    })).rejects.toThrow("Diagnostics disabled");
    await service.setDiagnosticsEnabled(true);
    expect(service.getSettings().diagnosticsEnabled).toBe(true);
    expect(diagnostics.isEnabled()).toBe(true);
    const bundlePath = await service.exportSupportBundle({
      appVersion: "1.0.0",
      deviceModel: "Pixel 8",
      androidVersion: "14",
      featureFlags: ["diagnostics"]
    });
    const stats = await fs.stat(bundlePath);
    expect(stats.isFile()).toBe(true);
    await service.setDiagnosticsEnabled(false);
    expect(service.getSettings().diagnosticsEnabled).toBe(false);
    expect(diagnostics.isEnabled()).toBe(false);
  });
});
