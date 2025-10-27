import { pathToFileURL } from "node:url";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";
import { loadRuntimeConfig } from "./config/runtime.js";
import { createServer as createServerFactory } from "./server/factory.js";
import {
  fromEnv,
  validateOrThrow,
  type AppConfig
} from "./shared/config/schema.js";

const smitheryConfigSchema = z
  .object({
    apiToken: z
      .string()
      .min(1, "ClickUp API token is required")
      .describe("API token used to authorise ClickUp requests")
      .optional(),
    defaultTeamId: z
      .coerce.number()
      .int()
      .positive()
      .describe("Default ClickUp team identifier")
      .optional(),
    primaryLanguage: z
      .string()
      .min(2)
      .describe("Primary language header to include with ClickUp requests")
      .optional(),
    baseUrl: z
      .string()
      .min(1)
      .describe("Override for the ClickUp API base URL")
      .optional(),
    requestTimeoutMs: z
      .coerce.number()
      .int()
      .positive()
      .describe("Request timeout in milliseconds")
      .optional(),
    defaultHeadersJson: z
      .string()
      .min(1)
      .describe("JSON payload containing additional headers for ClickUp requests")
      .optional()
  })
  .strict();

type SmitheryConfig = z.infer<typeof smitheryConfigSchema>;

export type SmitheryCommandContext = {
  config?: unknown;
  env?: Record<string, string | undefined>;
  auth?: unknown;
};

function mergeAppConfig(base: AppConfig, overrides: SmitheryConfig | undefined): AppConfig {
  if (!overrides) {
    return base;
  }
  const merged: AppConfig = { ...base };
  if (overrides.apiToken) {
    merged.apiToken = overrides.apiToken;
  }
  if (overrides.defaultTeamId !== undefined) {
    merged.defaultTeamId = overrides.defaultTeamId;
  }
  if (overrides.primaryLanguage) {
    merged.primaryLanguage = overrides.primaryLanguage;
  }
  if (overrides.baseUrl) {
    merged.baseUrl = overrides.baseUrl;
  }
  if (overrides.requestTimeoutMs !== undefined) {
    merged.requestTimeoutMs = overrides.requestTimeoutMs;
  }
  if (overrides.defaultHeadersJson) {
    merged.defaultHeadersJson = overrides.defaultHeadersJson;
  }
  return merged;
}

function isTruthy(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalised = value.trim().toLowerCase();
  return normalised === "1" || normalised === "true" || normalised === "yes";
}

function shouldUseHttp(): boolean {
  const runtime = loadRuntimeConfig();
  if (runtime.transport.kind === "http") {
    return true;
  }
  if (isTruthy(process.env.SMITHERY_HTTP)) {
    return true;
  }
  return Boolean(process.env.PORT);
}

async function startHost(): Promise<void> {
  const modulePath = shouldUseHttp() ? "./hosts/http.js" : "./hosts/stdio.js";
  await import(modulePath);
}

export const configSchema = smitheryConfigSchema;

export default function createServer(
  context?: SmitheryCommandContext
): Server {
  const envSource: Record<string, string | undefined> = {
    ...process.env,
    ...(context?.env ?? {})
  };
  const baseConfig = fromEnv(envSource);
  const overrides = context?.config
    ? smitheryConfigSchema.parse(context.config)
    : undefined;
  const config = mergeAppConfig(baseConfig, overrides);
  validateOrThrow(config);
  return createServerFactory(config);
}

function resolveInvocationHref(): string | undefined {
  if (!Array.isArray(process.argv) || process.argv.length <= 1) {
    return undefined;
  }
  const target = process.argv[1];
  if (!target) {
    return undefined;
  }
  if (target.startsWith("file://")) {
    return target;
  }
  if (target.startsWith("/")) {
    return pathToFileURL(target).href;
  }
  const base = pathToFileURL(`${process.cwd()}/`).href;
  return new URL(target, base).href;
}

const invokedDirectly =
  typeof process !== "undefined" &&
  import.meta.url === resolveInvocationHref();

if (invokedDirectly) {
  startHost().catch(error => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(reason);
    process.exitCode = 1;
  });
}
