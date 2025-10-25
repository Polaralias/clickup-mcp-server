import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { createServer as createHttpServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createLogger, newCorrelationId, withCorrelationId } from "../shared/logging.js";
import { err, Result } from "../shared/Result.js";
import type { HttpTransportConfig, RuntimeConfig } from "../config/runtime.js";
import { PROJECT_NAME } from "../config/constants.js";
import { registerTools, RegisteredTool } from "./tools/registerTools.js";
import { PACKAGE_VERSION } from "../shared/version.js";

type ToolListEntry = {
  name: string;
  description: string;
  annotations: RegisteredTool["annotations"];
  inputSchema: RegisteredTool["inputJsonSchema"];
};

type NotifyingServer = Server & { notify: (method: string, params: unknown) => Promise<void> };

function buildToolList(tools: RegisteredTool[]): ToolListEntry[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    annotations: tool.annotations,
    inputSchema: tool.inputJsonSchema
  }));
}

async function executeTool(tool: RegisteredTool, args: unknown, server: Server, runtime: RuntimeConfig): Promise<Result<unknown>> {
  try {
    return await tool.execute(args, { server, runtime });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err("UNKNOWN", message);
  }
}

function applyCorsHeaders(response: ServerResponse, config: HttpTransportConfig): void {
  response.setHeader("Access-Control-Allow-Origin", config.corsAllowOrigin);
  response.setHeader("Access-Control-Allow-Headers", config.corsAllowHeaders);
  response.setHeader("Access-Control-Allow-Methods", config.corsAllowMethods);
  response.setHeader("Access-Control-Max-Age", "600");
}

function attachNotify(server: Server): NotifyingServer {
  const target = server as NotifyingServer;
  if (typeof target.notify !== "function") {
    target.notify = async (method: string, params: unknown) => {
      const normalized = method.startsWith("notifications/") ? method : `notifications/${method}`;
      await server.notification({ method: normalized, params: params as Record<string, unknown> });
    };
  }
  return target;
}

async function startHttpServer(
  server: Server,
  tools: RegisteredTool[],
  transportConfig: HttpTransportConfig,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: transportConfig.enableJsonResponse,
    allowedHosts: transportConfig.allowedHosts,
    allowedOrigins: transportConfig.allowedOrigins,
    enableDnsRebindingProtection: transportConfig.enableDnsRebindingProtection
  });
  transport.onerror = error => {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error("http_transport_error", { reason });
  };
  await server.connect(transport);
  const httpServer = createHttpServer(async (request, response) => {
    applyCorsHeaders(response, transportConfig);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    try {
      await transport.handleRequest(request, response);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error("http_request_failed", { reason });
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Internal Server Error" },
            id: null
          })
        );
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(transportConfig.port, transportConfig.host, () => {
      resolve();
    });
  });

  console.log("ready");
  logger.info("server_started", {
    transport: "http",
    tools: tools.map(tool => tool.name),
    host: transportConfig.host,
    port: transportConfig.port
  });
}

async function startStdioServer(
  server: Server,
  tools: RegisteredTool[],
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("ready");
  logger.info("server_started", { transport: "stdio", tools: tools.map(tool => tool.name) });
}

export async function startServer(runtime: RuntimeConfig): Promise<void> {
  const server = new Server({ name: PROJECT_NAME, version: PACKAGE_VERSION });
  server.registerCapabilities({ tools: { listChanged: true } });
  attachNotify(server);
  const tools = await registerTools(server, runtime);
  const toolMap = new Map<string, RegisteredTool>(tools.map(tool => [tool.name, tool]));
  const logger = createLogger("mcp.server");

  const serverWithInitialize = server as Server & {
    _oninitialize: (request: unknown) => Promise<unknown>;
  };

  server.setRequestHandler(InitializeRequestSchema, async (request, extra) =>
    withCorrelationId(newCorrelationId(), async () => {
      logger.info("initialize_requested");
      const result = await serverWithInitialize._oninitialize(request);
      try {
        await extra.sendNotification({
          method: "notifications/tools/list_changed",
          params: { tools: buildToolList(tools) }
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error("tools_list_notification_failed", { reason });
      }
      return result;
    })
  );

  server.setRequestHandler(ListToolsRequestSchema, async () =>
    withCorrelationId(newCorrelationId(), async () => {
      logger.info("list_tools_requested");
      return { tools: buildToolList(tools) };
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
        return {
          content: [],
          structuredContent: result,
          isError: true
        };
      }
      const args = request.params.arguments ?? {};
      try {
        const outcome = await executeTool(tool, args, server, runtime);
        logger.info("tool_invocation_completed", { tool: toolName, isError: outcome.isError });
        return {
          content: [],
          structuredContent: outcome,
          isError: outcome.isError
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error("tool_invocation_failed", { tool: toolName, reason });
        const failure = err("UNKNOWN", reason);
        return {
          content: [],
          structuredContent: failure,
          isError: true
        };
      }
    })
  );

  if (runtime.transport.kind === "http") {
    await startHttpServer(server, tools, runtime.transport, logger);
  } else {
    await startStdioServer(server, tools, logger);
  }
}
