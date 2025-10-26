import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, getServerContext, waitForServerReady } from "./server/factory.js";
import { logError, logInfo } from "./shared/logging.js";
import { startHttpBridge } from "./server/httpBridge.js";
import { fromEnv, validateOrThrow } from "./shared/config/schema.js";

function parsePort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

async function startStdio(server: ReturnType<typeof createServer>): Promise<void> {
  const context = getServerContext(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await waitForServerReady(server);
  await context.notifier.notify("tools/list_changed", { tools: context.toolList });
  context.logger.info("server_started", {
    transport: "stdio",
    tools: context.tools.map(tool => tool.name)
  });
}

process.on("SIGTERM", () => {
  logInfo("bootstrap", "signal_received", { signal: "SIGTERM" });
  process.exit(0);
});

process.on("SIGINT", () => {
  logInfo("bootstrap", "signal_received", { signal: "SIGINT" });
  process.exit(0);
});

async function main(): Promise<void> {
  const sessionConfig = fromEnv();
  try {
    validateOrThrow(sessionConfig);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logError("bootstrap", "config_invalid", { reason });
    process.exitCode = 1;
    return;
  }
  logInfo("bootstrap", "startup_begin");
  const server = createServer(sessionConfig);
  const useHttp = process.env.SMITHERY_HTTP === "1" || Boolean(process.env.PORT);
  if (useHttp) {
    const port = parsePort(process.env.PORT) ?? 8081;
    await startHttpBridge(server, sessionConfig, { port });
    console.log(JSON.stringify({ event: "ready", transport: "http", port }));
  } else {
    await startStdio(server);
    console.log(JSON.stringify({ event: "ready", transport: "stdio" }));
  }
}

main().catch(error => {
  logError("bootstrap", "startup_failed", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
