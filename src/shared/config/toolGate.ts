import type { RegisteredTool } from "../../mcp/tools/registerTools.js";

type ToolGateOptions = {
  allowList?: string[] | readonly string[] | string | null;
  denyList?: string[] | readonly string[] | string | null;
  env?: Record<string, string | undefined>;
};

export type ToolGate = {
  allow: Set<string>;
  deny: Set<string>;
  isActive: boolean;
};

export type ToolGateSkipReason = "not_allowed" | "denied";

export type ToolGateSkip<TTool extends { name: string }> = {
  tool: TTool;
  reason: ToolGateSkipReason;
};

export const TOOL_ALLOW_ENV_KEY = "MCP_TOOLS_ALLOW" as const;
export const TOOL_DENY_ENV_KEY = "MCP_TOOLS_DENY" as const;

function ensureArray(value: string | readonly string[] | null | undefined): readonly string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value;
  }
  return value.split(/[\s,]+/);
}

export function normaliseToolListInput(
  source: string | readonly string[] | null | undefined
): string[] | undefined {
  const raw = ensureArray(source);
  if (!raw) {
    return undefined;
  }
  if (Array.isArray(source) && source.length === 0) {
    return [];
  }
  const unique: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    if (!unique.includes(trimmed)) {
      unique.push(trimmed);
    }
  }
  if (unique.length === 0) {
    return undefined;
  }
  return unique;
}

function readEnvList(env: Record<string, string | undefined>, key: string): string[] | undefined {
  const raw = env[key];
  return normaliseToolListInput(raw ?? undefined);
}

export function createToolGate(options?: ToolGateOptions): ToolGate {
  const env = options?.env ?? process.env;
  const envAllow = readEnvList(env, TOOL_ALLOW_ENV_KEY) ?? undefined;
  const envDeny = readEnvList(env, TOOL_DENY_ENV_KEY) ?? undefined;
  const allowOverride =
    options && Object.prototype.hasOwnProperty.call(options, "allowList")
      ? normaliseToolListInput(options.allowList ?? undefined)
      : undefined;
  const denyOverride =
    options && Object.prototype.hasOwnProperty.call(options, "denyList")
      ? normaliseToolListInput(options.denyList ?? undefined)
      : undefined;
  const allow = allowOverride !== undefined ? allowOverride : envAllow;
  const deny = denyOverride !== undefined ? denyOverride : envDeny;
  const allowSet = new Set(allow ?? []);
  const denySet = new Set(deny ?? []);
  return {
    allow: allowSet,
    deny: denySet,
    isActive: allowSet.size > 0 || denySet.size > 0
  };
}

export function filterToolsInPlace(
  tools: RegisteredTool[],
  gate: ToolGate
): { kept: RegisteredTool[]; skipped: ToolGateSkip<RegisteredTool>[] } {
  if (!gate.isActive) {
    return { kept: tools, skipped: [] };
  }
  const kept: RegisteredTool[] = [];
  const skipped: ToolGateSkip<RegisteredTool>[] = [];
  for (const tool of tools) {
    const name = tool.name;
    if (gate.deny.has(name)) {
      skipped.push({ tool, reason: "denied" });
      continue;
    }
    if (gate.allow.size > 0 && !gate.allow.has(name)) {
      skipped.push({ tool, reason: "not_allowed" });
      continue;
    }
    kept.push(tool);
  }
  if (kept.length !== tools.length) {
    tools.splice(0, tools.length, ...kept);
  }
  return { kept: tools, skipped };
}
