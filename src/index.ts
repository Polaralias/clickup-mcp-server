import { loadRuntimeConfig } from "./config/runtime.js";
import { makeMemoryKV } from "./shared/KV.js";
import { ApiCache } from "./infrastructure/cache/ApiCache.js";
import { startServer } from "./mcp/server.js";
import { configureLogging, logError, logInfo } from "./shared/logging.js";
import { DiagnosticsManager } from "./shared/diagnostics/DiagnosticsManager.js";
import { registerDiagnosticsManager } from "./shared/diagnostics/registry.js";
import { SettingsService } from "./application/services/SettingsService.js";
import { registerSettingsService } from "./application/services/settingsRegistry.js";

function ensureRequiredEnvironment(): void {
  const missing: string[] = [];
  if (!process.env.CLICKUP_TOKEN || process.env.CLICKUP_TOKEN.trim().length === 0) {
    missing.push("CLICKUP_TOKEN");
  }
  if (!process.env.CLICKUP_DEFAULT_TEAM_ID || process.env.CLICKUP_DEFAULT_TEAM_ID.trim().length === 0) {
    missing.push("CLICKUP_DEFAULT_TEAM_ID");
  }
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Interrupted, shutting down gracefully");
  process.exit(0);
});

async function main() {
  const runtime = loadRuntimeConfig();
  configureLogging({ level: runtime.logLevel });
  const diagnostics = new DiagnosticsManager();
  registerDiagnosticsManager(diagnostics);
  const settings = new SettingsService(diagnostics);
  registerSettingsService(settings);
  ensureRequiredEnvironment();
  const kv = makeMemoryKV();
  const cache = new ApiCache(kv);
  void cache;
  logInfo("bootstrap", "startup_begin");
  await startServer(runtime);
}

main().catch(error => {
  logError("bootstrap", "startup_failed", { error });
  process.exitCode = 1;
});
