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
      .optional(),
    authScheme: z
      .enum(["auto", "personal_token", "oauth"])
      .describe("Authentication scheme to use when authorising ClickUp requests")
      .optional(),
    allowTools: z
      .union([z.string(), z.array(z.string())])
      .describe("Restrict available tools to this allow-list")
      .optional(),
    denyTools: z
      .union([z.string(), z.array(z.string())])
      .describe("Block these tools even when allow-listed")
      .optional()
  })
  .strip();

type SmitheryConfig = z.infer<typeof smitheryConfigSchema>;

export type SmitheryCommandContext = {
  config?: unknown;
  env?: Record<string, string | undefined>;
  auth?: unknown;
};

function extractAuthValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    const direct = candidate.value ?? candidate.secret ?? candidate.raw;
    if (typeof direct === "string") {
      return direct;
    }
  }
  return undefined;
}

function normaliseAuthSource(auth: unknown): Record<string, string | undefined> {
  if (!auth || typeof auth !== "object") {
    return {};
  }
  const entries: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(auth as Record<string, unknown>)) {
    const resolved = extractAuthValue(value);
    if (resolved !== undefined) {
      entries[key] = resolved;
    }
  }
  return entries;
}

function mergeAppConfig(base: AppConfig, overrides: SmitheryConfig | undefined): AppConfig {
  if (!overrides) {
    return base;
  }
  const merged: AppConfig = { ...base };
  const { allowTools: _allow, denyTools: _deny, ...configOverrides } = overrides;
  if (configOverrides.apiToken) {
    merged.apiToken = configOverrides.apiToken;
  }
  if (configOverrides.defaultTeamId !== undefined) {
    merged.defaultTeamId = configOverrides.defaultTeamId;
  }
  if (configOverrides.primaryLanguage) {
    merged.primaryLanguage = configOverrides.primaryLanguage;
  }
  if (configOverrides.baseUrl) {
    merged.baseUrl = configOverrides.baseUrl;
  }
  if (configOverrides.requestTimeoutMs !== undefined) {
    merged.requestTimeoutMs = configOverrides.requestTimeoutMs;
  }
  if (configOverrides.defaultHeadersJson) {
    merged.defaultHeadersJson = configOverrides.defaultHeadersJson;
  }
  if (configOverrides.authScheme) {
    merged.authScheme = configOverrides.authScheme;
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

export default async function createServer(
  context?: SmitheryCommandContext
): Promise<Server> {
  const envSource: Record<string, string | undefined> = {
    ...process.env,
    ...(context?.env ?? {}),
    ...normaliseAuthSource(context?.auth)
  };
  const baseConfig = fromEnv(envSource);
  const overrides = context?.config
    ? smitheryConfigSchema.parse(context.config)
    : undefined;
  const gateOverrides = overrides
    ? { allow: overrides.allowTools ?? null, deny: overrides.denyTools ?? null }
    : undefined;
  const config = mergeAppConfig(baseConfig, overrides);
  validateOrThrow(config);
  return createServerFactory(config, { env: envSource, overrides: gateOverrides });
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
