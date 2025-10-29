import { describe, expect, it, vi } from "vitest";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import "./setup.js";
import { registerTools } from "../src/mcp/tools/registerTools.js";
import type { RuntimeConfig } from "../src/config/runtime.js";
import { ApiCache } from "../src/infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../src/shared/KV.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { createTestSession } from "./helpers/session.js";

type ToolName = "clickup_delete_task" | "clickup_delete_time_entry";

type GatewayStub = Partial<Record<keyof ClickUpGateway, unknown>> & {
  delete_task?: ReturnType<typeof vi.fn>;
  delete_time_entry?: ReturnType<typeof vi.fn>;
  fetch_tasks_for_index?: ReturnType<typeof vi.fn>;
};

async function resolveTool(name: ToolName, gateway: GatewayStub) {
  const runtime: RuntimeConfig = {
    logLevel: "info",
    featurePersistence: false,
    transport: { kind: "stdio" },
    httpInitializeTimeoutMs: 45_000
  };
  const server = {} as McpServer;
  const cache = new ApiCache(makeMemoryKV());
  const tools = await registerTools(server, runtime, createTestSession(), {
    gateway: gateway as unknown as ClickUpGateway,
    cache
  });
  const tool = tools.find(entry => entry.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} not registered`);
  }
  return { tool, runtime, server };
}

describe("safety middleware", () => {
  it("blocks delete task without confirmation and allows confirmed execution", async () => {
    const deleteTask = vi.fn().mockResolvedValue({});
    const gateway: GatewayStub = {
      delete_task: deleteTask,
      delete_time_entry: vi.fn(),
      fetch_tasks_for_index: vi.fn().mockResolvedValue([])
    };
    const { tool, runtime, server } = await resolveTool("clickup_delete_task", gateway);
    const context = { server, runtime };

    const missingConfirm = await tool.execute({ taskId: "task-1" }, context);
    expect(missingConfirm).toMatchObject({
      isError: true,
      code: "INVALID_PARAMETER",
      message: "confirm must be 'yes'"
    });
    expect(deleteTask).not.toHaveBeenCalled();

    const confirmed = await tool.execute({ taskId: "task-1", confirm: "yes" }, context);
    expect(deleteTask).toHaveBeenCalledTimes(1);
    expect(confirmed.isError).toBe(false);
  });

  it("blocks delete time entry without confirmation and allows confirmed execution", async () => {
    const deleteEntry = vi.fn().mockResolvedValue({});
    const gateway: GatewayStub = {
      delete_task: vi.fn(),
      delete_time_entry: deleteEntry,
      fetch_tasks_for_index: vi.fn().mockResolvedValue([])
    };
    const { tool, runtime, server } = await resolveTool("clickup_delete_time_entry", gateway);
    const context = { server, runtime };

    const missingConfirm = await tool.execute({ entryId: "entry-1" }, context);
    expect(missingConfirm).toMatchObject({
      isError: true,
      code: "INVALID_PARAMETER",
      message: "confirm must be 'yes'"
    });
    expect(deleteEntry).not.toHaveBeenCalled();

    const confirmed = await tool.execute({ entryId: "entry-1", confirm: "yes" }, context);
    expect(deleteEntry).toHaveBeenCalledTimes(1);
    expect(confirmed.isError).toBe(false);
  });
});
