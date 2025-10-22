import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { createRequire } from "module";
import { z } from "zod";
import { CHARACTER_LIMIT, PROJECT_NAME } from "../../config/constants.js";
import type { RuntimeConfig } from "../../config/runtime.js";
import { err, ok, Result } from "../../shared/Result.js";

type PackageMetadata = { version: string };

type ToolAnnotations = { readOnlyHint: boolean; idempotentHint: boolean; destructiveHint: boolean };

type ToolContext = { server: McpServer; runtime: RuntimeConfig };

type ToolExecutor<TOutput> = (input: unknown, context: ToolContext) => Promise<Result<TOutput>>;

type JsonSchema = Record<string, unknown>;

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

type HealthPayload = {
  service: string;
  version: string;
  pid: number;
  character_limit: number;
  features: { persistence: boolean };
  now: string;
};

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

export async function registerTools(server: McpServer, runtime: RuntimeConfig): Promise<RegisteredTool[]> {
  void server;
  void runtime;
  return [healthTool];
}
