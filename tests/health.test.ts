import { describe, expect, it } from "vitest";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import "./setup.js";
import type { RuntimeConfig } from "../src/config/runtime.js";
import { healthTool } from "../src/mcp/tools/registerTools.js";

describe("health tool", () => {
  it("returns server status", async () => {
    const runtime: RuntimeConfig = { logLevel: "info", featurePersistence: true };
    const result = await healthTool.execute({}, { server: {} as McpServer, runtime });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    const payload = result.data;
    expect(payload.service).toBe("ClickUp-MCP");
    expect(typeof payload.version).toBe("string");
    expect(payload.version.length).toBeGreaterThan(0);
    expect(typeof payload.pid).toBe("number");
    expect(payload.character_limit).toBe(25000);
    expect(payload.features.persistence).toBe(runtime.featurePersistence);
    expect(payload.now).toBe("2025-01-01T12:00:00.000Z");
  });
});
