import { loadRuntimeConfig } from "./config/runtime.js";
import { makeMemoryKV } from "./shared/KV.js";
import { ApiCache } from "./infrastructure/cache/ApiCache.js";
import { startServer } from "./mcp/server.js";

async function main() {
  const runtime = loadRuntimeConfig();
  const kv = makeMemoryKV();
  const cache = new ApiCache(kv);
  void cache;
  await startServer(runtime);
}

await main();
