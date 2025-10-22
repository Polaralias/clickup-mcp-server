import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { createRequire } from "module";
import { z } from "zod";
import { CHARACTER_LIMIT, PROJECT_NAME } from "../../config/constants.js";
import type { RuntimeConfig } from "../../config/runtime.js";
import { err, ok, Result } from "../../shared/Result.js";
import { DocSearchInput, DocSearchOutput, BulkDocSearchInput, BulkDocSearchOutput } from "./schemas/doc.js";
import { DocSearch } from "../../application/usecases/DocSearch.js";
import { BulkDocSearch } from "../../application/usecases/BulkDocSearch.js";
import { ApiCache } from "../../infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../../shared/KV.js";
import { HttpClient } from "../../infrastructure/http/HttpClient.js";
import { ClickUpGateway } from "../../infrastructure/clickup/ClickUpGateway.js";
import type { ClickUpGatewayConfig, AuthScheme } from "../../infrastructure/clickup/ClickUpGateway.js";

type PackageMetadata = { version: string };

type ToolAnnotations = { readOnlyHint: boolean; idempotentHint: boolean; destructiveHint: boolean };

type ToolContext = { server: McpServer; runtime: RuntimeConfig };

type ToolExecutor<TOutput> = (input: unknown, context: ToolContext) => Promise<Result<TOutput>>;

type JsonSchema = Record<string, unknown>;

type ToolDependencies = { gateway?: ClickUpGateway; cache?: ApiCache };

type DocSearchOutputType = z.infer<typeof DocSearchOutput>;
type BulkDocSearchOutputType = z.infer<typeof BulkDocSearchOutput>;

const require = createRequire(import.meta.url);
const packageMetadata = require("../../../package.json") as PackageMetadata;

export type RegisteredTool<TOutput = unknown> = {
  name: string;
  description: string;
  annotations: ToolAnnotations;
  inputSchema: z.ZodTypeAny;
  inputJsonSchema: JsonSchema;
  execute: ToolExecutor<TOutput>;
};

const healthInputSchema = z.object({}).strict();
const healthInputJsonSchema: JsonSchema = { type: "object", properties: {}, required: [], additionalProperties: false };

const docSearchInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    workspaceId: { type: "integer", minimum: 1 },
    query: { type: "string", minLength: 1 },
    limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    page: { type: "integer", minimum: 0, default: 0 },
    contentFormat: { type: "string", enum: ["text/md", "text/html", "application/json"] }
  },
  required: ["workspaceId", "query"],
  additionalProperties: false
};

const bulkDocSearchInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    workspaceId: { type: "integer", minimum: 1 },
    queries: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 25 },
    options: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50 },
        page: { type: "integer", minimum: 0 },
        concurrency: { type: "integer", minimum: 1, maximum: 10 },
        retryCount: { type: "integer", minimum: 0, maximum: 6 },
        retryDelayMs: { type: "integer", minimum: 0 },
        exponentialBackoff: { type: "boolean" },
        continueOnError: { type: "boolean" }
      },
      required: [],
      additionalProperties: false,
      default: {}
    }
  },
  required: ["workspaceId", "queries"],
  additionalProperties: false
};

type HealthPayload = {
  service: string;
  version: string;
  pid: number;
  character_limit: number;
  features: { persistence: boolean };
  now: string;
};

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
}

function resolveAuthScheme(value: string | undefined): AuthScheme {
  if (value === "oauth" || value === "personal_token" || value === "auto") {
    return value;
  }
  return "auto";
}

function resolveGatewayConfig(): ClickUpGatewayConfig {
  const baseUrl = process.env.CLICKUP_BASE_URL ?? "https://api.clickup.com";
  const token = process.env.CLICKUP_TOKEN ?? "";
  const authScheme = resolveAuthScheme(process.env.CLICKUP_AUTH_SCHEME);
  const timeoutMs = parseNumber(process.env.CLICKUP_TIMEOUT_MS, 10000);
  const defaultTeamId = parseNumber(process.env.CLICKUP_DEFAULT_TEAM_ID, 0);
  return { baseUrl, token, authScheme, timeoutMs, defaultTeamId };
}

function resolveDependencies(deps?: ToolDependencies): { gateway: ClickUpGateway; cache: ApiCache } {
  if (deps?.gateway && deps?.cache) {
    return { gateway: deps.gateway, cache: deps.cache };
  }
  const cache = deps?.cache ?? new ApiCache(makeMemoryKV());
  if (deps?.gateway) {
    return { gateway: deps.gateway, cache };
  }
  const config = resolveGatewayConfig();
  const client = new HttpClient({ baseUrl: config.baseUrl });
  const gateway = new ClickUpGateway(client, cache, config);
  return { gateway, cache };
}

async function executeHealth(input: unknown, context: ToolContext): Promise<Result<HealthPayload>> {
  const parsed = healthInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
  }
  return ok({
    service: PROJECT_NAME,
    version: packageMetadata.version,
    pid: process.pid,
    character_limit: CHARACTER_LIMIT,
    features: { persistence: context.runtime.featurePersistence },
    now: new Date().toISOString()
  });
}

export const healthTool: RegisteredTool<HealthPayload> = {
  name: "health",
  description: "Basic server status",
  annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  inputSchema: healthInputSchema,
  inputJsonSchema: healthInputJsonSchema,
  execute: executeHealth
};

export async function registerTools(server: McpServer, runtime: RuntimeConfig, deps?: ToolDependencies): Promise<RegisteredTool[]> {
  void server;
  const { gateway, cache } = resolveDependencies(deps);
  const docSearch = new DocSearch(gateway, cache);
  const bulkDocSearch = new BulkDocSearch(gateway, cache);
  const docTool: RegisteredTool<DocSearchOutputType> = {
    name: "clickup_doc_search",
    description: "Search ClickUp Docs by query with pagination",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: DocSearchInput,
    inputJsonSchema: docSearchInputJsonSchema,
    execute: async (input, context) => docSearch.execute(context, input as z.infer<typeof DocSearchInput>)
  };
  const bulkTool: RegisteredTool<BulkDocSearchOutputType> = {
    name: "clickup_bulk_doc_search",
    description: "Run multiple doc searches concurrently and merge unique pages",
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    inputSchema: BulkDocSearchInput,
    inputJsonSchema: bulkDocSearchInputJsonSchema,
    execute: async (input, context) => bulkDocSearch.execute(context, input as z.infer<typeof BulkDocSearchInput>)
  };
  void runtime;
  return [healthTool, docTool, bulkTool];
}
