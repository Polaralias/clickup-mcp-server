import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  InitializeRequestSchema,
  ListToolsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type ReadResourceResult,
  type Resource as ResourceDescriptor,
  type ResourceTemplate as ResourceTemplateDescriptor
} from "@modelcontextprotocol/sdk/types.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { createToolGate, filterToolsInPlace } from "../shared/config/toolGate.js";

const serverContextSymbol = Symbol.for("clickup.mcp.serverContext");

let gatewayPatched = false;

type ToolListEntry = {
  name: string;
  description: string;
  annotations: RegisteredTool["annotations"];
  inputSchema: RegisteredTool["inputJsonSchema"];
};

type ResourceMetadataInput = {
  title?: string;
  description?: string;
  mimeType?: string;
};

type StaticResourceReadCallback = (uri: URL) => ReadResourceResult | Promise<ReadResourceResult>;

type TemplateResourceReadCallback = (
  uri: URL,
  variables: Record<string, string | string[]>
) => ReadResourceResult | Promise<ReadResourceResult>;

type RegisteredStaticResource = {
  name: string;
  uri: string;
  descriptor: ResourceDescriptor;
  read: StaticResourceReadCallback;
};

type RegisteredResourceTemplate = {
  name: string;
  template: ResourceTemplate;
  descriptor: ResourceTemplateDescriptor;
  read: TemplateResourceReadCallback;
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
  resources: Map<string, RegisteredStaticResource>;
  resourceTemplates: Map<string, RegisteredResourceTemplate>;
  resourceList: ResourceDescriptor[];
  resourceTemplateList: ResourceTemplateDescriptor[];
  ready: Promise<void>;
};

type RegisterResource = {
  (name: string, uri: string, metadata: ResourceMetadataInput, readCallback: StaticResourceReadCallback): void;
  (
    name: string,
    template: ResourceTemplate,
    metadata: ResourceMetadataInput,
    readCallback: TemplateResourceReadCallback
  ): void;
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(moduleDirectory, "..", "..");
const docsDirectory = join(projectRoot, "docs");
const handbookPath = join(docsDirectory, "HANDBOOK.md");
const operationsPath = join(docsDirectory, "OPERATIONS.md");

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

function buildResourceDescriptor(
  name: string,
  uri: string,
  metadata: ResourceMetadataInput
): ResourceDescriptor {
  const descriptor: ResourceDescriptor = { name, uri };
  if (metadata.title) {
    descriptor.title = metadata.title;
  }
  if (metadata.description) {
    descriptor.description = metadata.description;
  }
  if (metadata.mimeType) {
    descriptor.mimeType = metadata.mimeType;
  }
  return descriptor;
}

function buildResourceTemplateDescriptor(
  name: string,
  template: ResourceTemplate,
  metadata: ResourceMetadataInput
): ResourceTemplateDescriptor {
  const descriptor: ResourceTemplateDescriptor = {
    name,
    uriTemplate: template.uriTemplate.toString()
  };
  if (metadata.title) {
    descriptor.title = metadata.title;
  }
  if (metadata.description) {
    descriptor.description = metadata.description;
  }
  if (metadata.mimeType) {
    descriptor.mimeType = metadata.mimeType;
  }
  return descriptor;
}

function refreshResourceCaches(context: ServerContext): void {
  context.resourceList = Array.from(context.resources.values()).map(entry => entry.descriptor);
  context.resourceTemplateList = Array.from(context.resourceTemplates.values()).map(
    entry => entry.descriptor
  );
}

function setupResourceHandling(
  server: Server,
  context: ServerContext,
  sessionConfig: SessionConfig,
  defaultConnectionId: string
): RegisterResource {
  const registrar: RegisterResource = (
    name: string,
    uriOrTemplate: string | ResourceTemplate,
    metadata: ResourceMetadataInput,
    readCallback: StaticResourceReadCallback | TemplateResourceReadCallback
  ) => {
    if (typeof uriOrTemplate === "string") {
      const descriptor = buildResourceDescriptor(name, uriOrTemplate, metadata);
      const entry: RegisteredStaticResource = {
        name,
        uri: uriOrTemplate,
        descriptor,
        read: readCallback as StaticResourceReadCallback
      };
      context.resources.set(uriOrTemplate, entry);
    } else {
      const descriptor = buildResourceTemplateDescriptor(name, uriOrTemplate, metadata);
      const entry: RegisteredResourceTemplate = {
        name,
        template: uriOrTemplate,
        descriptor,
        read: readCallback as TemplateResourceReadCallback
      };
      context.resourceTemplates.set(name, entry);
    }
    refreshResourceCaches(context);
  };

  const serverWithRegistrar = server as Server & { registerResource: RegisterResource };
  serverWithRegistrar.registerResource = registrar;

  server.setRequestHandler(ListResourcesRequestSchema, async () =>
    withSessionScope(buildSessionScope(sessionConfig, defaultConnectionId), () =>
      withCorrelationId(newCorrelationId(), async () => {
        await context.ready;
        context.logger.info("list_resources_requested");
        return { resources: context.resourceList };
      })
    )
  );

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () =>
    withSessionScope(buildSessionScope(sessionConfig, defaultConnectionId), () =>
      withCorrelationId(newCorrelationId(), async () => {
        await context.ready;
        context.logger.info("list_resource_templates_requested");
        return { resourceTemplates: context.resourceTemplateList };
      })
    )
  );

  server.setRequestHandler(ReadResourceRequestSchema, async request =>
    withSessionScope(buildSessionScope(sessionConfig, defaultConnectionId), () =>
      withCorrelationId(newCorrelationId(), async () => {
        await context.ready;
        const requestedUri = request.params.uri;
        context.logger.info("read_resource_requested", { uri: requestedUri });
        let parsed: URL;
        try {
          parsed = new URL(requestedUri);
        } catch {
          context.logger.warn("resource_uri_invalid", { uri: requestedUri });
          throw new McpError(ErrorCode.InvalidParams, `Invalid resource URI: ${requestedUri}`);
        }
        const staticResource = context.resources.get(requestedUri);
        if (staticResource) {
          try {
            return await staticResource.read(parsed);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            context.logger.error("resource_read_failed", { uri: requestedUri, reason });
            throw error;
          }
        }
        for (const entry of context.resourceTemplates.values()) {
          const match = entry.template.uriTemplate.match(requestedUri);
          if (match) {
            try {
              return await entry.read(parsed, match);
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              context.logger.error("resource_template_read_failed", {
                template: entry.descriptor.uriTemplate,
                uri: requestedUri,
                reason
              });
              throw error;
            }
          }
        }
        context.logger.warn("resource_missing", { uri: requestedUri });
        throw new McpError(ErrorCode.InvalidParams, `Resource ${requestedUri} not found`);
      })
    )
  );

  return registrar;
}

async function readMarkdownResource(
  path: string,
  resourceName: string,
  logger: ReturnType<typeof createLogger>
): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error("resource_markdown_load_failed", { resource: resourceName, path, reason });
    throw new McpError(ErrorCode.InternalError, `Unable to load ${resourceName} content`);
  }
}

function buildToolReferenceDocument(tools: ToolListEntry[]): string {
  const lines: string[] = [];
  lines.push("# ClickUp MCP Tool Reference");
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push("");
  for (const tool of tools) {
    lines.push(`## ${tool.name}`);
    lines.push("");
    lines.push(tool.description);
    lines.push("");
    lines.push("**Annotations**");
    lines.push("");
    lines.push(`- readOnlyHint: ${tool.annotations.readOnlyHint ? "true" : "false"}`);
    lines.push(`- idempotentHint: ${tool.annotations.idempotentHint ? "true" : "false"}`);
    lines.push(`- destructiveHint: ${tool.annotations.destructiveHint ? "true" : "false"}`);
    lines.push("");
    lines.push("**Input Schema**");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(tool.inputSchema, null, 2));
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function registerReferenceResources(registerResource: RegisterResource, context: ServerContext): void {
  const configurationGuideUri = "clickup://docs/configuration-guide";
  const referenceIndexUri = "clickup://docs/reference-links";
  const toolReferenceUri = "clickup://docs/tool-reference";
  const referenceTemplate = new ResourceTemplate("clickup-reference://{slug}", { list: undefined });
  const canonicalPages = [
    {
      slug: "handbook",
      path: handbookPath,
      title: "Operational Handbook",
      description: "Comprehensive architecture, configuration, and safety guidance for the ClickUp MCP server."
    },
    {
      slug: "operations",
      path: operationsPath,
      title: "Operations Runbook",
      description: "Daily routines, incident workflows, and maintenance procedures for operators."
    }
  ];
  const slugMap = new Map<string, (typeof canonicalPages)[number]>();
  for (const page of canonicalPages) {
    slugMap.set(page.slug, page);
  }
  const handbookPage = canonicalPages[0];
  slugMap.set("configuration", handbookPage);
  slugMap.set("configuration-guide", handbookPage);
  slugMap.set("setup", handbookPage);

  registerResource(
    "configuration_guide",
    configurationGuideUri,
    {
      title: "ClickUp MCP Configuration Guide",
      description: "Environment prerequisites and runtime configuration extracted from the operational handbook.",
      mimeType: "text/markdown"
    },
    async uri => {
      const content = await readMarkdownResource(handbookPath, "configuration_guide", context.logger);
      return {
        contents: [
          {
            uri: uri.href,
            text: content,
            mimeType: "text/markdown"
          }
        ]
      };
    }
  );

  registerResource(
    "list_clickup_reference_links",
    referenceIndexUri,
    {
      title: "ClickUp MCP Reference Index",
      description: "Index of configuration, operations, and tooling knowledge for Smithery clients.",
      mimeType: "application/json"
    },
    async uri => {
      const references = canonicalPages.map(page => ({
        slug: page.slug,
        title: page.title,
        description: page.description,
        uri: `clickup-reference://${page.slug}`
      }));
      references.push({
        slug: "configuration-guide",
        title: "Configuration Guide",
        description: "Direct link to the setup guidance sourced from the operational handbook.",
        uri: configurationGuideUri
      });
      references.push({
        slug: "tool-reference",
        title: "Tool Reference",
        description: "Generated catalogue describing every MCP tool and its input schema.",
        uri: toolReferenceUri
      });
      const payload = { references };
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(payload, null, 2),
            mimeType: "application/json"
          }
        ]
      };
    }
  );

  registerResource(
    "fetch_clickup_reference_page",
    referenceTemplate,
    {
      title: "Fetch ClickUp reference page",
      description: "Resolve Markdown pages for operational and configuration references by slug.",
      mimeType: "text/markdown"
    },
    async (uri, variables) => {
      const slugValue = variables.slug;
      const slug = Array.isArray(slugValue) ? slugValue[0] : slugValue;
      const normalised = typeof slug === "string" ? slug.trim().toLowerCase() : "";
      const page = slugMap.get(normalised);
      if (!page) {
        throw new McpError(ErrorCode.InvalidParams, `Unknown reference slug: ${slug}`);
      }
      const content = await readMarkdownResource(page.path, `reference:${page.slug}`, context.logger);
      return {
        contents: [
          {
            uri: uri.href,
            text: content,
            mimeType: "text/markdown"
          }
        ]
      };
    }
  );

  registerResource(
    "tool_reference",
    toolReferenceUri,
    {
      title: "ClickUp MCP Tool Reference",
      description: "Summaries and JSON schemas for every registered MCP tool.",
      mimeType: "text/markdown"
    },
    async uri => {
      const body = buildToolReferenceDocument(context.toolList);
      return {
        contents: [
          {
            uri: uri.href,
            text: body,
            mimeType: "text/markdown"
          }
        ]
      };
    }
  );
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

export async function createServer(input?: Partial<AppConfig>): Promise<Server> {
  ensureGatewayPatched();
  const resolved = mergeConfig(input ?? {});
  const validation = validateConfig(resolved);
  const runtime = loadRuntimeConfig();
  configureLogging({ level: runtime.logLevel });
  const server = new Server({ name: PROJECT_NAME, version: PACKAGE_VERSION });
  server.registerCapabilities({ tools: { listChanged: true }, resources: { listChanged: true } });
  if (!validation.ok) {
    server.setRequestHandler(InitializeRequestSchema, () => {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Missing apiToken. Provide in Smithery config UI or set CLICKUP_TOKEN."
      );
    });
    return server;
  }
  const schemaConfig = toSchemaConfig(resolved);
  const sessionConfig = toSessionConfig(schemaConfig);
  const toolGate = createToolGate({
    allowList: resolved.toolAllowList,
    denyList: resolved.toolDenyList
  });
  const defaultConnectionId = "smithery";
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
    resources: new Map(),
    resourceTemplates: new Map(),
    resourceList: [],
    resourceTemplateList: [],
    ready: Promise.resolve()
  };
  const registerResource = setupResourceHandling(server, context, sessionConfig, defaultConnectionId);
  const ready = (async () => {
    const tools = await registerTools(server, runtime);
    const { kept, skipped } = filterToolsInPlace(tools, toolGate);
    for (const entry of skipped) {
      logger.info("tool_gated", { tool: entry.tool.name, reason: entry.reason });
    }
    context.tools = kept;
    context.toolMap = new Map<string, RegisteredTool>(kept.map(tool => [tool.name, tool]));
    context.toolList = buildToolList(kept);
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
