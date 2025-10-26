import { startHttpBridge } from "../server/httpBridge.js";
import { createServer, getServerContext, waitForServerReady } from "../server/factory.js";
import { fromEnv, validateOrThrow } from "../shared/config/schema.js";
import { logError, logInfo } from "../shared/logging.js";
import { loadRuntimeConfig } from "../config/runtime.js";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 8081;

function parsePort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveListenConfig(): { host: string; port: number } {
  const runtime = loadRuntimeConfig();
  if (runtime.transport.kind === "http") {
    return { host: runtime.transport.host, port: runtime.transport.port };
  }
  const host = process.env.MCP_HTTP_HOST?.trim() || DEFAULT_HOST;
  const port =
    parsePort(process.env.MCP_HTTP_PORT) ?? parsePort(process.env.PORT) ?? DEFAULT_PORT;
  return { host, port };
}

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

  logInfo("bootstrap", "http_startup_begin");
  const server = createServer(config, { defaultConnectionId: "http" });
  const context = getServerContext(server);
  const { host, port } = resolveListenConfig();

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

  process.once("SIGINT", () => {
    logInfo("bootstrap", "signal_received", { signal: "SIGINT" });
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    logInfo("bootstrap", "signal_received", { signal: "SIGTERM" });
    void shutdown("SIGTERM");
  });

  try {
    const actualPort = await startHttpBridge(server, { port, host });
    await waitForServerReady(server);
    await context.notifier.notify("tools/list_changed", { tools: context.toolList });
    logInfo("bootstrap", "http_ready", {
      transport: "http",
      host,
      port: actualPort,
      tools: context.tools.map(tool => tool.name)
    });
    const payload: Record<string, unknown> = {
      event: "ready",
      transport: "http",
      port: actualPort
    };
    if (host) {
      payload.host = host;
    }
    console.log(JSON.stringify(payload));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logError("bootstrap", "http_startup_failed", { reason, host, port });
    process.exitCode = 1;
  }
}

start().catch(error => {
  const reason = error instanceof Error ? error.message : String(error);
  logError("bootstrap", "http_startup_unhandled", { reason });
  process.exitCode = 1;
});
