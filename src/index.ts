import { loadRuntimeConfig } from "./config/runtime.js";
import { makeMemoryKV } from "./shared/KV.js";
import { ApiCache } from "./infrastructure/cache/ApiCache.js";
import { startServer } from "./mcp/server.js";
import { configureLogging, logError, logInfo } from "./shared/logging.js";

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
