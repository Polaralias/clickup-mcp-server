import { describe, expect, it } from "vitest";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import "./setup.js";
import { registerTools } from "../src/mcp/tools/registerTools.js";
import type { RuntimeConfig } from "../src/config/runtime.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { ApiCache } from "../src/infrastructure/cache/ApiCache.js";
import { makeMemoryKV } from "../src/shared/KV.js";

describe("Tool annotations", () => {
  it("enforce mutation and deletion metadata policies", async () => {
    const runtime: RuntimeConfig = {
      logLevel: "info",
      featurePersistence: false,
      transport: { kind: "stdio" },
      httpInitializeTimeoutMs: 45_000
    };
    const server = {} as McpServer;
    const cache = new ApiCache(makeMemoryKV());
    const gateway = {} as ClickUpGateway;

    const tools = await registerTools(server, runtime, { gateway, cache });

    const lookup = (name: string) => {
      const tool = tools.find(entry => entry.name === name);
      if (!tool) {
        throw new Error(`Tool ${name} not registered`);
      }
      return tool.annotations;
    };

    const cases: [string, { readOnlyHint: boolean; idempotentHint: boolean; destructiveHint: boolean }][] = [
      ["clickup_doc_search", { readOnlyHint: true, idempotentHint: true, destructiveHint: false }],
      ["clickup_create_doc", { readOnlyHint: false, idempotentHint: false, destructiveHint: true }],
      ["clickup_update_doc_page", { readOnlyHint: false, idempotentHint: false, destructiveHint: true }],
      ["clickup_create_task", { readOnlyHint: false, idempotentHint: false, destructiveHint: true }],
      ["clickup_update_task", { readOnlyHint: false, idempotentHint: false, destructiveHint: false }],
      ["clickup_move_task", { readOnlyHint: false, idempotentHint: false, destructiveHint: true }],
      ["clickup_duplicate_task", { readOnlyHint: false, idempotentHint: false, destructiveHint: true }],
      ["clickup_comment_task", { readOnlyHint: false, idempotentHint: false, destructiveHint: true }],
      ["clickup_attach_file_to_task", { readOnlyHint: false, idempotentHint: false, destructiveHint: true }],
      ["clickup_add_tags_to_task", { readOnlyHint: false, idempotentHint: false, destructiveHint: true }],
      ["clickup_remove_tags_from_task", { readOnlyHint: false, idempotentHint: false, destructiveHint: true }],
      ["clickup_start_timer", { readOnlyHint: false, idempotentHint: false, destructiveHint: true }],
      ["clickup_stop_timer", { readOnlyHint: false, idempotentHint: false, destructiveHint: true }],
      ["clickup_create_time_entry", { readOnlyHint: false, idempotentHint: false, destructiveHint: true }],
      ["clickup_delete_task", { readOnlyHint: false, idempotentHint: false, destructiveHint: true }],
      ["clickup_delete_time_entry", { readOnlyHint: false, idempotentHint: false, destructiveHint: true }]
    ];

    for (const [name, expected] of cases) {
      expect(lookup(name)).toEqual(expected);
    }
  });
});
