import { describe, expect, it, vi } from "vitest";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import "./setup.js";
import type { RuntimeConfig } from "../src/config/runtime.js";
import { ApiCache } from "../src/infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../src/shared/KV.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { registerTools } from "../src/mcp/tools/registerTools.js";

type GatewayFns = {
  create_doc: ReturnType<typeof vi.fn>;
  attach_file_to_task: ReturnType<typeof vi.fn>;
  start_timer: ReturnType<typeof vi.fn>;
  stop_timer: ReturnType<typeof vi.fn>;
};

function createGateway(): { gateway: ClickUpGateway; fns: GatewayFns } {
  const fns: GatewayFns = {
    create_doc: vi.fn(async () => ({ doc_id: "DOC-1", title: "Doc" })),
    attach_file_to_task: vi.fn(async () => ({})),
    start_timer: vi.fn(async () => ({})),
    stop_timer: vi.fn(async () => ({}))
  };
  const base: Partial<ClickUpGateway> = {
    create_doc: fns.create_doc,
    attach_file_to_task: fns.attach_file_to_task,
    start_timer: fns.start_timer,
    stop_timer: fns.stop_timer,
    search_docs: vi.fn(async () => ({ total: 0, items: [] })),
    fetch_tasks_for_index: vi.fn(async () => []),
    get_task_by_id: vi.fn(async () => ({}))
  };
  const gateway = new Proxy(base, {
    get(target, prop) {
      if (prop in target) {
        return target[prop as keyof typeof target];
      }
      return vi.fn();
    }
  }) as ClickUpGateway;
  return { gateway, fns };
}

function findTool(tools: Awaited<ReturnType<typeof registerTools>>, name: string) {
  const tool = tools.find(entry => entry.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} not registered`);
  }
  return tool;
}

describe("safety confirmation", () => {
  const context: { runtime: RuntimeConfig; server: McpServer } = {
    runtime: {
      logLevel: "info",
      featurePersistence: false,
      transport: { kind: "stdio" },
      httpInitializeTimeoutMs: 45_000
    },
    server: {} as McpServer
  };

  it("requires confirm for attachment tool", async () => {
    const { gateway, fns } = createGateway();
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(context.server, context.runtime, { gateway, cache });
    const tool = findTool(tools, "clickup_attach_file_to_task");
    const baseArgs = {
      taskId: "TASK-1",
      dataUri: "data:text/plain;base64,QQ==",
      name: "note.txt"
    };
    const missing = await tool.execute(baseArgs, context);
    expect(missing.isError).toBe(true);
    if (!missing.isError) {
      throw new Error("Expected missing confirm to fail");
    }
    expect(missing.code).toBe("INVALID_PARAMETER");
    expect(fns.attach_file_to_task).not.toHaveBeenCalled();

    const confirmed = await tool.execute({ ...baseArgs, confirm: "yes" }, context);
    expect(confirmed.isError).toBe(false);
    expect(fns.attach_file_to_task).toHaveBeenCalledTimes(1);
  });

  it("requires confirm for start timer", async () => {
    const { gateway, fns } = createGateway();
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(context.server, context.runtime, { gateway, cache });
    const tool = findTool(tools, "clickup_start_timer");
    const missing = await tool.execute({ taskId: "TASK-1" }, context);
    expect(missing.isError).toBe(true);
    if (!missing.isError) {
      throw new Error("Expected missing confirm to fail");
    }
    expect(missing.code).toBe("INVALID_PARAMETER");
    expect(fns.start_timer).not.toHaveBeenCalled();

    const confirmed = await tool.execute({ taskId: "TASK-1", confirm: "yes" }, context);
    expect(confirmed.isError).toBe(false);
    expect(fns.start_timer).toHaveBeenCalledTimes(1);
  });

  it("requires confirm for stop timer", async () => {
    const { gateway, fns } = createGateway();
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(context.server, context.runtime, { gateway, cache });
    const tool = findTool(tools, "clickup_stop_timer");
    const missing = await tool.execute({ taskId: "TASK-1" }, context);
    expect(missing.isError).toBe(true);
    if (!missing.isError) {
      throw new Error("Expected missing confirm to fail");
    }
    expect(missing.code).toBe("INVALID_PARAMETER");
    expect(fns.stop_timer).not.toHaveBeenCalled();

    const confirmed = await tool.execute({ taskId: "TASK-1", confirm: "yes" }, context);
    expect(confirmed.isError).toBe(false);
    expect(fns.stop_timer).toHaveBeenCalledTimes(1);
  });

  it("requires confirm for create doc", async () => {
    const { gateway, fns } = createGateway();
    const cache = new ApiCache(makeMemoryKV());
    const tools = await registerTools(context.server, context.runtime, { gateway, cache });
    const tool = findTool(tools, "clickup_create_doc");
    const baseArgs = { workspaceId: 1, title: "Doc", visibility: "PRIVATE" as const };
    const missing = await tool.execute(baseArgs, context);
    expect(missing.isError).toBe(true);
    if (!missing.isError) {
      throw new Error("Expected missing confirm to fail");
    }
    expect(missing.code).toBe("INVALID_PARAMETER");
    expect(fns.create_doc).not.toHaveBeenCalled();

    const confirmed = await tool.execute({ ...baseArgs, confirm: "yes" }, context);
    expect(confirmed.isError).toBe(false);
    expect(fns.create_doc).toHaveBeenCalledTimes(1);
  });
});

