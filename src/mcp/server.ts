import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createLogger, newCorrelationId, withCorrelationId } from "../shared/logging.js";
import { err, Result } from "../shared/Result.js";
import type { RuntimeConfig } from "../config/runtime.js";
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

export async function startServer(runtime: RuntimeConfig): Promise<void> {
  const server = new Server({ name: PROJECT_NAME, version: PACKAGE_VERSION });
  server.registerCapabilities({ tools: { listChanged: true } });
  const notifyingServer = attachNotify(server);
  const tools = await registerTools(server, runtime);
  const toolMap = new Map<string, RegisteredTool>(tools.map(tool => [tool.name, tool]));
  const logger = createLogger("mcp.server");

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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("ready");
  const currentTools = buildToolList(tools);
  await notifyingServer.notify("tools/list_changed", { tools: currentTools });
  logger.info("server_started", { tools: tools.map(tool => tool.name) });
}
