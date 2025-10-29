type EnvSource = Record<string, string | undefined>;

type ToolGateOverrides = {
  allow?: string | string[] | null;
  deny?: string | string[] | null;
};

export type ToolGateInit = {
  env?: EnvSource;
  overrides?: ToolGateOverrides;
};

export type ToolGateSnapshot = {
  allowList?: string[];
  denyList?: string[];
};

export type ToolGateReason = "deny_list" | "not_allowlisted";

export type ToolGate = {
  readonly allowList?: string[];
  readonly denyList?: string[];
  isAllowed(name: string): boolean;
  filter<T extends { name: string }>(
    tools: T[],
    onSkip?: (tool: T, detail: { reason: ToolGateReason }) => void
  ): T[];
  snapshot(): ToolGateSnapshot;
};

const ALLOW_ENV_KEYS = [
  "MCP_TOOLS_ALLOW",
  "MCP_TOOLS_ALLOW_LIST",
  "MCP_TOOL_ALLOW",
  "MCP_TOOL_ALLOW_LIST"
];

const DENY_ENV_KEYS = [
  "MCP_TOOLS_DENY",
  "MCP_TOOLS_DENY_LIST",
  "MCP_TOOL_DENY",
  "MCP_TOOL_DENY_LIST"
];

function normaliseStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function parseStringList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[") || trimmed.startsWith("\"")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        const entries: string[] = [];
        for (const item of parsed) {
          if (typeof item === "string") {
            entries.push(item);
          }
        }
        return normaliseStrings(entries);
      }
    } catch {
      // fall through to delimiter parsing
    }
  }
  const segments = trimmed.split(/[,;\n]/).map(token => token.trim());
  return normaliseStrings(segments);
}

function parseUnknownList(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = parseStringList(trimmed);
    return parsed;
  }
  if (Array.isArray(value)) {
    const entries = value.filter((entry): entry is string => typeof entry === "string");
    return normaliseStrings(entries);
  }
  return undefined;
}

function readEnvList(env: EnvSource | undefined, keys: string[]): string[] | undefined {
  if (!env) {
    return undefined;
  }
  for (const key of keys) {
    const raw = env[key];
    if (typeof raw !== "string") {
      continue;
    }
    const parsed = parseStringList(raw);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return undefined;
}

function resolveAllowList(env: EnvSource | undefined, overrides: ToolGateOverrides | undefined): string[] | undefined {
  const override = parseUnknownList(overrides?.allow);
  if (override !== undefined) {
    return override;
  }
  const fromEnv = readEnvList(env, ALLOW_ENV_KEYS);
  return fromEnv;
}

function resolveDenyList(env: EnvSource | undefined, overrides: ToolGateOverrides | undefined): string[] | undefined {
  const override = parseUnknownList(overrides?.deny);
  if (override !== undefined) {
    return override;
  }
  const fromEnv = readEnvList(env, DENY_ENV_KEYS);
  return fromEnv;
}

export function createToolGate(init?: ToolGateInit): ToolGate {
  const env = init?.env ?? process.env;
  const overrides = init?.overrides;
  const allowList = resolveAllowList(env, overrides);
  const denyList = resolveDenyList(env, overrides);
  const allowSet = allowList ? new Set(allowList) : undefined;
  const denySet = denyList ? new Set(denyList) : new Set<string>();
  return {
    allowList,
    denyList,
    isAllowed(name: string) {
      if (denySet.has(name)) {
        return false;
      }
      if (allowSet && !allowSet.has(name)) {
        return false;
      }
      return true;
    },
    filter(tools, onSkip) {
      const filtered: typeof tools = [];
      for (const tool of tools) {
        const { name } = tool;
        if (denySet.has(name)) {
          onSkip?.(tool, { reason: "deny_list" });
          continue;
        }
        if (allowSet && !allowSet.has(name)) {
          onSkip?.(tool, { reason: "not_allowlisted" });
          continue;
        }
        filtered.push(tool);
      }
      return filtered;
    },
    snapshot() {
      return { allowList, denyList };
    }
  };
}
