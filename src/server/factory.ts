import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadRuntimeConfig, type RuntimeConfig } from "../config/runtime.js";
import { PROJECT_NAME } from "../config/constants.js";
import { registerTools, type RegisteredTool } from "../mcp/tools/registerTools.js";
import { PACKAGE_VERSION } from "../shared/version.js";
import {
  configureLogging,
  createLogger,
  newCorrelationId,
  withCorrelationId
} from "../shared/logging.js";
import { err, type Result } from "../shared/Result.js";
import {
  getSessionConfig,
  withSessionScope,
  type SessionScope
} from "../shared/config/session.js";
import type { SessionConfig, AppConfig } from "../shared/config/schema.js";
import { toSessionConfig } from "../shared/config/schema.js";
import { ClickUpGateway } from "../infrastructure/clickup/ClickUpGateway.js";
import { buildClickUpHeaders } from "../infrastructure/clickup/headers.js";

const serverContextSymbol = Symbol.for("clickup.mcp.serverContext");

let gatewayPatched = false;

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
  session: SessionConfig;
  defaultConnectionId: string;
  ready: Promise<void>;
};

export type CreateServerOptions = {
  /**
   * Connection identifier applied to implicit session scopes (e.g. stdio transport).
   * Defaults to "stdio" for backwards compatibility.
   */
  defaultConnectionId?: string;
};

function ensureGatewayPatched(): void {
  if (gatewayPatched) {
    return;
  }
  gatewayPatched = true;
  const prototype = ClickUpGateway.prototype as unknown as {
    authHeader?: () => Record<string, string>;
  };
  const original = prototype.authHeader;
  prototype.authHeader = function overrideAuthHeader(this: any): Record<string, string> {
    try {
      const session = getSessionConfig();
      const teamId = this?.cfg?.defaultTeamId;
      return buildClickUpHeaders({ session, teamId });
    } catch (error) {
      if (typeof original === "function") {
        return original.call(this);
      }
      return {};
    }
  };
}

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

function buildSessionScope(config: SessionConfig, connectionId: string): SessionScope {
  return { config, connectionId };
}

export function createServer(config: AppConfig, options?: CreateServerOptions): Server {
  ensureGatewayPatched();
  const runtime = loadRuntimeConfig();
  configureLogging({ level: runtime.logLevel });
  const sessionConfig = toSessionConfig(config);
  const defaultConnectionId = options?.defaultConnectionId ?? "stdio";
  const server = new Server({ name: PROJECT_NAME, version: PACKAGE_VERSION });
  server.registerCapabilities({ tools: { listChanged: true } });
  const notifier = attachNotify(server);
  const logger = createLogger("mcp.server");
  const context: ServerContext = {
    runtime,
    notifier,
    tools: [],
    toolMap: new Map(),
    toolList: [],
    logger,
    session: sessionConfig,
    defaultConnectionId,
    ready: Promise.resolve()
  };
  const ready = (async () => {
    const tools = await registerTools(server, runtime);
    context.tools = tools;
    context.toolMap = new Map<string, RegisteredTool>(tools.map(tool => [tool.name, tool]));
    context.toolList = buildToolList(tools);
  })();
  context.ready = ready;
  server.setRequestHandler(ListToolsRequestSchema, async () =>
    withSessionScope(buildSessionScope(sessionConfig, defaultConnectionId), () =>
      withCorrelationId(newCorrelationId(), async () => {
        await ready;
        logger.info("list_tools_requested");
        return { tools: context.toolList };
      })
    )
  );
  server.setRequestHandler(CallToolRequestSchema, async request =>
    withSessionScope(buildSessionScope(sessionConfig, defaultConnectionId), () =>
      withCorrelationId(newCorrelationId(), async () => {
        await ready;
        const toolName = request.params.name;
        logger.info("tool_invocation_received", { tool: toolName });
        const tool = context.toolMap.get(toolName);
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
    )
  );
  Reflect.set(server, serverContextSymbol, context);
  return server;
}

export function getServerContext(server: Server): ServerContext {
  const context = Reflect.get(server, serverContextSymbol) as ServerContext | undefined;
  if (!context) {
    throw new Error("Server context unavailable");
  }
  return context;
}

export function waitForServerReady(server: Server): Promise<void> {
  return getServerContext(server).ready;
}
