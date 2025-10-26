import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, getServerContext, waitForServerReady } from "./server/factory.js";
import { logError, logInfo } from "./shared/logging.js";
import { startHttpBridge } from "./server/httpBridge.js";
import { fromEnv, validateOrThrow } from "./shared/config/schema.js";

if (!process.env.MCP_DEBUG) {
  process.env.MCP_DEBUG = "1";
}

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

async function postReadyInit(
  server: ReturnType<typeof createServer>,
  transport: "http" | "stdio",
  extras?: { port?: number }
): Promise<void> {
  const context = getServerContext(server);
  try {
    await waitForServerReady(server);
    await context.notifier.notify("tools/list_changed", { tools: context.toolList });
    const payload: Record<string, unknown> = { transport };
    if (extras?.port !== undefined) {
      payload.port = extras.port;
    }
    context.logger.info("server_started", payload);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logError("bootstrap", "post_ready_init_failed", { reason, transport, extras });
  }
}

process.on("SIGTERM", () => {
  console.log(JSON.stringify({ event: "signal", signal: "SIGTERM" }));
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log(JSON.stringify({ event: "signal", signal: "SIGINT" }));
  process.exit(0);
});

async function main(): Promise<void> {
  const appConfig = fromEnv();
  try {
    validateOrThrow(appConfig);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logError("bootstrap", "config_invalid", { reason });
    process.exitCode = 1;
    return;
  }
  logInfo("bootstrap", "startup_begin");
  const server = createServer(appConfig);
  const useHttp = process.env.SMITHERY_HTTP === "1" || Boolean(process.env.PORT);
  if (useHttp) {
    const port = parsePort(process.env.PORT) ?? 8081;
    const actualPort = await startHttpBridge(server, port);
    console.log(JSON.stringify({ event: "ready", transport: "http", port: actualPort }));
    setImmediate(() => {
      void postReadyInit(server, "http", { port: actualPort });
    });
  } else {
    await startStdio(server);
    console.log(JSON.stringify({ event: "ready", transport: "stdio" }));
  }
}

main().catch(error => {
  logError("bootstrap", "startup_failed", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
