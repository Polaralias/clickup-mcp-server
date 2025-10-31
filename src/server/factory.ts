import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  InitializeRequestSchema,
  ListToolsRequestSchema,
  McpError,
  type ResourceTemplate
} from "@modelcontextprotocol/sdk/types.js";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
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
import {
  toSessionConfig,
  type AppConfig as SchemaAppConfig,
  type SessionConfig
} from "../shared/config/schema.js";
import { ClickUpGateway } from "../infrastructure/clickup/ClickUpGateway.js";
import { buildClickUpHeaders } from "../infrastructure/clickup/headers.js";
import { mergeConfig, validateConfig, type AppConfig } from "../shared/config/smithery.js";
import { createToolGate, type ToolGateInit } from "../shared/config/toolGate.js";

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
  mcp: McpServer;
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

type ReferenceDocument = {
  slug: string;
  uri: string;
  title: string;
  description: string;
  path: string;
  mimeType: string;
  extract?: (markdown: string) => string;
};

function isNotConnectedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.toLowerCase().includes("not connected");
}

function ensureGatewayPatched(): void {
  if (gatewayPatched) {
    return;
  }
  gatewayPatched = true;
  const prototype = ClickUpGateway.prototype as unknown as {
    authHeader?: () => Record<string, string>;
  };
  const original = prototype.authHeader;
  prototype.authHeader = function overrideAuthHeader(this: unknown): Record<string, string> {
    try {
      const session = getSessionConfig();
      const teamId = (this as { cfg?: { defaultTeamId?: number } })?.cfg?.defaultTeamId;
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

function extractMarkdownSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex(line => line.trim().toLowerCase() === heading.trim().toLowerCase());
  if (headingIndex === -1) {
    return markdown.trim();
  }
  let endIndex = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) {
      endIndex = index;
      break;
    }
  }
  return lines.slice(headingIndex, endIndex).join("\n").trim();
}

async function loadReferenceDocument(document: ReferenceDocument, logger: ReturnType<typeof createLogger>): Promise<string> {
  try {
    const fileUrl = new URL(document.path, import.meta.url);
    const content = await readFile(fileUrl, "utf-8");
    return document.extract ? document.extract(content) : content.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("reference_resource_read_failed", { slug: document.slug, message });
    return `Resource ${document.title} is currently unavailable. Please review server logs for details.`;
  }
}

async function registerReferenceResources(context: ServerContext): Promise<void> {
  const { mcp, logger } = context;

  type ResourceHandlerResult = {
    contents: (
      | { uri: string; text: string }
      | { uri: string; json: unknown }
    )[];
  };

  const configurationGuideUri = "clickup-mcp://docs/configuration-guide";
  const referenceIndexUri = "clickup-mcp://docs/reference-index";
  const toolReferenceUri = "clickup-mcp://docs/tool-reference";

  const referenceDocuments: ReferenceDocument[] = [
    {
      slug: "configuration-guide",
      uri: configurationGuideUri,
      title: "Setup and Configuration",
      description: "Core environment configuration guidance for ClickUp-MCP.",
      path: "../../docs/HANDBOOK.md",
      mimeType: "text/markdown",
      extract: markdown => extractMarkdownSection(markdown, "## 3. Setup and Configuration")
    },
    {
      slug: "operational-handbook",
      uri: "clickup-mcp://docs/reference/operational-handbook",
      title: "Operational Handbook",
      description: "Full ClickUp-MCP operational handbook covering architecture and safety.",
      path: "../../docs/HANDBOOK.md",
      mimeType: "text/markdown"
    },
    {
      slug: "operations-runbook",
      uri: "clickup-mcp://docs/reference/operations-runbook",
      title: "Operations Runbook",
      description: "Actionable routines for daily operations and incident response.",
      path: "../../docs/OPERATIONS.md",
      mimeType: "text/markdown"
    }
  ];

  const referenceDocumentMap = new Map(referenceDocuments.map(document => [document.slug, document]));

  context.mcp.registerResource(
    "configuration_guide",
    configurationGuideUri,
    {
      title: "ClickUp-MCP Configuration Guide",
      description: "Deployment prerequisites, environment variables, and setup guidance.",
      mimeType: "text/markdown"
    },
    async () => ({
      contents: [
        {
          uri: configurationGuideUri,
          text: await loadReferenceDocument(referenceDocumentMap.get("configuration-guide")!, logger)
        }
      ]
    })
  );

  const referenceTemplate: ResourceTemplate = {
    name: "clickup_reference_page",
    title: "ClickUp Reference Page",
    uriTemplate: "clickup-mcp://docs/reference/{slug}",
    description: "Resolves ClickUp-MCP reference documentation by slug.",
    mimeType: "text/markdown"
  };

  context.mcp.registerResource(
    "fetch_clickup_reference_page",
    referenceTemplate,
    {
      title: "Fetch ClickUp Reference Page",
      description: "Retrieves a ClickUp-MCP reference document identified by slug.",
      mimeType: "text/markdown"
    },
    async (...args: unknown[]) => {
      const variables = (args[1] as Record<string, unknown> | undefined) ?? {};
      const slug = String(variables.slug ?? "").toLowerCase();
      const document = referenceDocumentMap.get(slug);
      if (!document) {
        logger.warn("reference_resource_missing", { slug });
        return {
          contents: [
            {
              uri: `clickup-mcp://docs/reference/${slug}`,
              text: `No ClickUp-MCP reference page found for slug: ${slug}`
            }
          ]
        };
      }
      return {
        contents: [
          {
            uri: document.uri,
          text: await loadReferenceDocument(document, logger)
          }
        ]
      };
    }
  );

  context.mcp.registerResource(
    "list_clickup_reference_links",
    referenceIndexUri,
    {
      title: "ClickUp Reference Index",
      description: "Index of ClickUp-MCP reference materials available as resources.",
      mimeType: "application/json"
    },
    async () => {
      const links = [
        ...referenceDocuments.map(document => ({
          name: document.slug,
          title: document.title,
          uri: document.uri,
          description: document.description,
          mimeType: document.mimeType
        })),
        {
          name: "tool-reference",
          title: "ClickUp-MCP Tool Reference",
          uri: toolReferenceUri,
          description: "Complete list of registered tools with input JSON schemas.",
          mimeType: "application/json"
        }
      ];
      return {
        contents: [
          {
            uri: referenceIndexUri,
            json: {
              generatedAt: new Date().toISOString(),
              resources: links
            }
          }
        ]
      };
    }
  );

  context.mcp.registerResource(
    "tool_reference",
    toolReferenceUri,
    {
      title: "ClickUp-MCP Tool Reference",
      description: "Metadata and JSON schemas for every registered tool.",
      mimeType: "application/json"
    },
    async () => ({
      contents: [
        {
          uri: toolReferenceUri,
          json: {
            generatedAt: new Date().toISOString(),
            tools: context.tools.map(tool => ({
              name: tool.name,
              description: tool.description,
              annotations: tool.annotations,
              requiresAuth: tool.requiresAuth !== false,
              inputSchema: tool.inputJsonSchema
            }))
          }
        }
      ]
    })
  );

  context.mcp.registerResource(
    "hello",
    "hello://world",
    {
      title: "Hello",
      description: "Minimal transport verification resource",
      mimeType: "text/plain"
    },
    async (...args: unknown[]) => {
      const first = args[0];
      const target = first instanceof URL ? first : new URL("hello://world");
      return {
        contents: [
          {
            uri: target.href,
            text: "hello world"
          }
        ]
      };
    }
  );

  try {
    await context.mcp.server.sendResourceListChanged();
  } catch (error) {
    if (isNotConnectedError(error)) {
      logger.debug("resource_list_notification_skipped", { reason: "not_connected" });
    } else {
      throw error;
    }
  }
  logger.info("reference_resources_registered", {
    resources: [
      "configuration_guide",
      "fetch_clickup_reference_page",
      "list_clickup_reference_links",
      "tool_reference",
      "hello"
    ]
  });
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

function attachNotify(server: Server, logger: ReturnType<typeof createLogger>): NotifyingServer {
  const target = server as NotifyingServer;
  if (typeof target.notify !== "function") {
    target.notify = async (method: string, params: unknown) => {
      const normalised = method.startsWith("notifications/") ? method : `notifications/${method}`;
      try {
        await server.notification({ method: normalised, params: params as Record<string, unknown> });
      } catch (error) {
        if (isNotConnectedError(error)) {
          logger.debug("notification_skipped", { method: normalised, reason: "not_connected" });
          return;
        }
        throw error;
      }
    };
  }
  return target;
}

function buildSessionScope(config: SessionConfig, connectionId: string): SessionScope {
  return { config, connectionId };
}

function resolveMissingSessionFields(config: SessionConfig): string[] {
  const missing: string[] = [];
  if (config.apiToken.trim().length === 0) {
    missing.push("apiToken");
  }
  const teamId = config.defaultTeamId;
  if (teamId === undefined || !Number.isFinite(teamId) || teamId <= 0) {
    missing.push("defaultTeamId");
  }
  return missing;
}

function formatMissingFields(fields: string[]): string {
  if (fields.length === 1) {
    return `'${fields[0]}'`;
  }
  if (fields.length === 2) {
    return `'${fields[0]}' and '${fields[1]}'`;
  }
  const prefix = fields.slice(0, -1).map(field => `'${field}'`).join(", ");
  const suffix = `'${fields[fields.length - 1]}'`;
  return `${prefix}, and ${suffix}`;
}

function toSchemaConfig(cfg: AppConfig): SchemaAppConfig {
  return {
    apiToken: cfg.apiToken ?? "",
    defaultTeamId: cfg.defaultTeamId,
    primaryLanguage: cfg.primaryLanguage,
    baseUrl: cfg.baseUrl,
    requestTimeoutMs: cfg.requestTimeoutMs,
    defaultHeadersJson: cfg.defaultHeadersJson
  };
}

export async function createServer(
  input?: Partial<AppConfig>,
  gateInit?: ToolGateInit
): Promise<Server> {
  ensureGatewayPatched();
  const resolved = mergeConfig(input ?? {});
  const validation = validateConfig(resolved);
  const runtime = loadRuntimeConfig();
  configureLogging({ level: runtime.logLevel });
  const mcp = new McpServer({ name: PROJECT_NAME, version: PACKAGE_VERSION });
  const server = mcp.server;
  const defaultInitialize = (
    server as unknown as { _oninitialize: (request: unknown) => Promise<unknown> }
  )._oninitialize.bind(server) as (request: unknown) => Promise<unknown>;
  server.registerCapabilities({ tools: { listChanged: true }, resources: { listChanged: true } });
  if (!validation.ok) {
    const reason = validation.message ?? "Invalid configuration";
    server.setRequestHandler(InitializeRequestSchema, () => {
      throw new McpError(ErrorCode.InvalidParams, reason);
    });
    return server;
  }
  const schemaConfig = toSchemaConfig(resolved);
  const sessionConfig = toSessionConfig(schemaConfig);
  const defaultConnectionId = "smithery";
  const logger = createLogger("mcp.server");
  const notifier = attachNotify(server, logger);
  if (sessionConfig.apiToken.trim().length === 0) {
    logger.warn("session_missing_token", {
      message: "ClickUp API token not provided; most tools will fail until a token is supplied."
    });
  }
  const context: ServerContext = {
    mcp,
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
  const gate = createToolGate(gateInit);
  const gateSnapshot = gate.snapshot();
  if (gateSnapshot.allowList || gateSnapshot.denyList) {
    logger.info("tool_gate_configured", gateSnapshot);
  }
  const ready = (async () => {
    const tools = await registerTools(server, runtime, sessionConfig);
    const filtered = gate.filter(tools, (tool, detail) => {
      logger.info("tool_gate_skipped", {
        tool: tool.name,
        reason: detail.reason,
        allowList: gateSnapshot.allowList,
        denyList: gateSnapshot.denyList
      });
    });
    const skipped = tools.length - filtered.length;
    if (skipped > 0) {
      tools.length = 0;
      for (const tool of filtered) {
        tools.push(tool);
      }
      logger.info("tool_gate_applied", {
        skipped,
        remaining: tools.map(tool => tool.name)
      });
    }
    context.tools = tools;
    context.toolMap = new Map<string, RegisteredTool>(tools.map(tool => [tool.name, tool]));
    context.toolList = buildToolList(tools);
    await registerReferenceResources(context);
  })();
  context.ready = ready;
  server.setRequestHandler(InitializeRequestSchema, request =>
    withSessionScope(buildSessionScope(sessionConfig, defaultConnectionId), () =>
      withCorrelationId(newCorrelationId(), async () => {
        const missing = resolveMissingSessionFields(context.session);
        if (missing.length > 0) {
          logger.warn("initialize_missing_configuration", { missing });
          const description = formatMissingFields(missing);
          const message = `Missing required configuration: ${description}.`;
          throw new McpError(ErrorCode.InvalidParams, message, { missing });
        }
        await ready;
        const response = (await defaultInitialize(request)) as { protocolVersion?: string };
        logger.info("initialize_completed", { protocolVersion: response.protocolVersion });
        return response;
      })
    )
  );
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
        if (tool.requiresAuth !== false && context.session.apiToken.trim().length === 0) {
          logger.warn("tool_invocation_missing_token", { tool: toolName });
          const failure = err(
            "INVALID_PARAMETER",
            "Missing ClickUp API token. Provide via Smithery session settings or the CLICKUP_TOKEN environment variable."
          );
          return { content: [], structuredContent: failure, isError: true };
        }
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
