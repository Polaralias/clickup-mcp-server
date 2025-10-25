import { loadRuntimeConfig } from "./config/runtime.js";
import { makeMemoryKV } from "./shared/KV.js";
import { ApiCache } from "./infrastructure/cache/ApiCache.js";
import { startServer } from "./mcp/server.js";
import { configureLogging, logError, logInfo } from "./shared/logging.js";

process.on("SIGTERM", () => {
  logInfo("bootstrap", "signal_shutdown", { signal: "SIGTERM" });
  process.exit(0);
});

process.on("SIGINT", () => {
  logInfo("bootstrap", "signal_shutdown", { signal: "SIGINT" });
  process.exit(0);
});

async function main() {
  const runtime = loadRuntimeConfig();
  configureLogging({ level: runtime.logLevel });
  const kv = makeMemoryKV();
  const cache = new ApiCache(kv);
  void cache;
  logInfo("bootstrap", "startup_begin");
  await startServer(runtime);
}

await main().catch(error => {
  logError("bootstrap", "startup_failed", { error });
  process.exitCode = 1;
});
