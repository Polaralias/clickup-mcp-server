import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, getServerContext, waitForServerReady } from "../server/factory.js";
import { fromEnv, validateOrThrow } from "../shared/config/schema.js";
import { logError, logInfo } from "../shared/logging.js";

async function start(): Promise<void> {
  const config = fromEnv();
  try {
    validateOrThrow(config);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logError("bootstrap", "config_invalid", { reason });
    process.exitCode = 1;
    return;
  }

  logInfo("bootstrap", "stdio_startup_begin");
  const server = createServer(config, { defaultConnectionId: "stdio" });
  const transport = new StdioServerTransport();

  transport.onerror = error => {
    const reason = error instanceof Error ? error.message : String(error);
    logError("transport", "stdio_transport_error", { reason });
  };

  let shuttingDown = false;
  const shutdown = async (signal?: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logInfo("bootstrap", "shutdown_begin", signal ? { signal } : undefined);
    try {
      await server.close();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logError("bootstrap", "shutdown_error", { reason });
    } finally {
      process.exit(0);
    }
  };

  transport.onclose = () => {
    logInfo("transport", "stdio_transport_closed");
    void shutdown();
  };

  process.once("SIGINT", () => {
    logInfo("bootstrap", "signal_received", { signal: "SIGINT" });
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    logInfo("bootstrap", "signal_received", { signal: "SIGTERM" });
    void shutdown("SIGTERM");
  });

  await server.connect(transport);
  const context = getServerContext(server);
  await waitForServerReady(server);
  await context.notifier.notify("tools/list_changed", { tools: context.toolList });
  logInfo("bootstrap", "stdio_ready", { transport: "stdio", tools: context.tools.map(tool => tool.name) });
  console.log(JSON.stringify({ event: "ready", transport: "stdio" }));
}

start().catch(error => {
  const reason = error instanceof Error ? error.message : String(error);
  logError("bootstrap", "stdio_startup_failed", { reason });
  process.exitCode = 1;
});
