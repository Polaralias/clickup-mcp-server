import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from "module";
import { createLogger } from "../shared/Logger.js";
import { err, Result } from "../shared/Result.js";
import type { RuntimeConfig } from "../config/runtime.js";
import { PROJECT_NAME } from "../config/constants.js";
import { registerTools, RegisteredTool } from "./tools/registerTools.js";

type PackageMetadata = { version: string };

type ToolListEntry = {
  name: string;
  description: string;
  annotations: RegisteredTool["annotations"];
  inputSchema: RegisteredTool["inputJsonSchema"];
};

type NotifyingServer = Server & { notify: (method: string, params: unknown) => Promise<void> };

const require = createRequire(import.meta.url);
const packageMetadata = require("../../package.json") as PackageMetadata;

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
  const server = new Server({ name: PROJECT_NAME, version: packageMetadata.version });
  server.registerCapabilities({ tools: { listChanged: true } });
  const notifyingServer = attachNotify(server);
  const tools = await registerTools(server, runtime);
  const toolMap = new Map<string, RegisteredTool>(tools.map(tool => [tool.name, tool]));
  const logger = createLogger(runtime.logLevel);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildToolList(tools)
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const tool = toolMap.get(request.params.name);
    if (!tool) {
      const result = err("NOT_FOUND", `Tool ${request.params.name} not found`);
      return {
        content: [],
        structuredContent: result,
        isError: true
      };
    }
    const args = request.params.arguments ?? {};
    const outcome = await executeTool(tool, args, server, runtime);
    return {
      content: [],
      structuredContent: outcome,
      isError: outcome.isError
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  const currentTools = buildToolList(tools);
  await notifyingServer.notify("tools/list_changed", { tools: currentTools });
  logger.info("server_started", { tools: tools.map(tool => tool.name) });
}
