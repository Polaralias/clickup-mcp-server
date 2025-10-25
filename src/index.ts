import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadRuntimeConfig, type RuntimeConfig } from "./config/runtime.js";
import { PROJECT_NAME } from "./config/constants.js";
import { registerTools, type RegisteredTool } from "./mcp/tools/registerTools.js";
import { PACKAGE_VERSION } from "./shared/version.js";
import {
  configureLogging,
  createLogger,
  logError,
  logInfo,
  newCorrelationId,
  withCorrelationId
} from "./shared/logging.js";
import { err, type Result } from "./shared/Result.js";
import { startHttpBridge } from "./server/httpBridge.js";
import { fromEnv, type AppConfig, validateOrThrow } from "./shared/config/schema.js";

const serverContextSymbol = Symbol.for("clickup.mcp.serverContext");

type ToolListEntry = {
  name: string;
  description: string;
  annotations: RegisteredTool["annotations"];
  inputSchema: RegisteredTool["inputJsonSchema"];
};

type NotifyingServer = Server & { notify: (method: string, params: unknown) => Promise<void> };

type ServerContext = {
  runtime: RuntimeConfig;
  notifier: NotifyingServer;
  tools: RegisteredTool[];
  toolMap: Map<string, RegisteredTool>;
  toolList: ToolListEntry[];
  logger: ReturnType<typeof createLogger>;
  config: AppConfig;
};

function buildToolList(tools: RegisteredTool[]): ToolListEntry[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    annotations: tool.annotations,
    inputSchema: tool.inputJsonSchema
  }));
}

async function executeTool(
  tool: RegisteredTool,
  args: unknown,
  server: Server,
  runtime: RuntimeConfig
): Promise<Result<unknown>> {
  try {
    return await tool.execute(args, { server, runtime });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err("UNKNOWN", message);
  }
}

function attachNotify(server: Server): NotifyingServer {
  const target = server as NotifyingServer;
  if (typeof target.notify !== "function") {
    target.notify = async (method: string, params: unknown) => {
      const normalised = method.startsWith("notifications/") ? method : `notifications/${method}`;
      await server.notification({ method: normalised, params: params as Record<string, unknown> });
    };
  }
  return target;
}

function getContext(server: Server): ServerContext {
  const context = Reflect.get(server, serverContextSymbol) as ServerContext | undefined;
  if (!context) {
    throw new Error("Server context unavailable");
  }
  return context;
}

export async function createServer(config: AppConfig): Promise<Server> {
  const runtime = loadRuntimeConfig();
  configureLogging({ level: runtime.logLevel });
  const server = new Server({ name: PROJECT_NAME, version: PACKAGE_VERSION });
  server.registerCapabilities({ tools: { listChanged: true } });
  const notifier = attachNotify(server);
  const logger = createLogger("mcp.server");
  const tools = await registerTools(server, runtime);
  const toolMap = new Map<string, RegisteredTool>(tools.map(tool => [tool.name, tool]));
  const toolList = buildToolList(tools);

  server.setRequestHandler(ListToolsRequestSchema, async () =>
    withCorrelationId(newCorrelationId(), async () => {
      logger.info("list_tools_requested");
      return { tools: toolList };
    })
  );

  server.setRequestHandler(CallToolRequestSchema, async request =>
    withCorrelationId(newCorrelationId(), async () => {
      const toolName = request.params.name;
      logger.info("tool_invocation_received", { tool: toolName });
      const tool = toolMap.get(toolName);
      if (!tool) {
        logger.warn("tool_missing", { tool: toolName });
        const result = err("NOT_FOUND", `Tool ${toolName} not found`);
        return { content: [], structuredContent: result, isError: true };
      }
      const args = request.params.arguments ?? {};
      try {
        const outcome = await executeTool(tool, args, server, runtime);
        logger.info("tool_invocation_completed", { tool: toolName, isError: outcome.isError });
        return { content: [], structuredContent: outcome, isError: outcome.isError };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error("tool_invocation_failed", { tool: toolName, reason });
        const failure = err("UNKNOWN", reason);
        return { content: [], structuredContent: failure, isError: true };
      }
    })
  );

  const context: ServerContext = { runtime, notifier, tools, toolMap, toolList, logger, config };
  Reflect.set(server, serverContextSymbol, context);
  return server;
}

async function startStdio(server: Server): Promise<void> {
  const context = getContext(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("ready");
  await context.notifier.notify("tools/list_changed", { tools: context.toolList });
  context.logger.info("server_started", {
    transport: "stdio",
    tools: context.tools.map(tool => tool.name)
  });
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

process.on("SIGTERM", () => {
  logInfo("bootstrap", "signal_received", { signal: "SIGTERM" });
  process.exit(0);
});

process.on("SIGINT", () => {
  logInfo("bootstrap", "signal_received", { signal: "SIGINT" });
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
  const server = await createServer(appConfig);
  const runtime = getContext(server).runtime;
  const transport = runtime.transport;
  if (transport.kind === "http") {
    await startHttpBridge(server, { port: transport.port, host: transport.host });
    return;
  }

  const smitheryHint = process.env.SMITHERY_HTTP === "1" || Boolean(process.env.PORT);
  if (smitheryHint) {
    const port = parsePort(process.env.PORT) ?? 8080;
    await startHttpBridge(server, { port });
    return;
  }

  await startStdio(server);
}

main().catch(error => {
  logError("bootstrap", "startup_failed", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
