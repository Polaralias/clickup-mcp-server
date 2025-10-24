import { loadRuntimeConfig } from "./config/runtime.js";
import { makeMemoryKV } from "./shared/KV.js";
import { ApiCache } from "./infrastructure/cache/ApiCache.js";
import { startServer } from "./mcp/server.js";
import { configureLogging, logInfo } from "./shared/logging.js";

async function main() {
  const runtime = loadRuntimeConfig();
  configureLogging({ level: runtime.logLevel });
  const kv = makeMemoryKV();
  const cache = new ApiCache(kv);
  void cache;
  logInfo("bootstrap", "startup_begin");
  await startServer(runtime);
}

await main();
