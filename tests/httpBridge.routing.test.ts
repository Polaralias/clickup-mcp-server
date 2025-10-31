import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "./setup.js";
import { createServer, waitForServerReady } from "../src/server/factory.js";
import { startHttpBridge } from "../src/server/httpBridge.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.CLICKUP_TOKEN = process.env.CLICKUP_TOKEN ?? "test-token";
  process.env.CLICKUP_DEFAULT_TEAM_ID = process.env.CLICKUP_DEFAULT_TEAM_ID ?? "1";
  process.env.MCP_TRANSPORT = "http";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("http bridge routing", () => {
  it("serves streamable http GET requests", async () => {
    const server = await createServer();
    const http = await startHttpBridge(server, { port: 0 });
    try {
      await waitForServerReady(server);
      const baseUrl = `http://127.0.0.1:${http.port}/mcp`;
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream"
      } satisfies Record<string, string>;

      const initialize = await fetch(baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "init",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "routing-test", version: "1.0.0" }
          }
        })
      });
      expect(initialize.status).toBe(200);
      const sessionId = initialize.headers.get("mcp-session-id");
      expect(sessionId).toBeTruthy();
      const negotiatedProtocol =
        initialize.headers.get("mcp-protocol-version") ?? "2024-11-05";
      await initialize.text();

      const stream = await fetch(baseUrl, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          "MCP-Session-Id": sessionId ?? "",
          "MCP-Protocol-Version": negotiatedProtocol
        }
      });
      expect(stream.status).toBe(200);
      expect(stream.headers.get("content-type") ?? "").toContain("text/event-stream");
      await stream.body?.cancel();
    } finally {
      await http.close();
      await server.close();
    }
  });

  it("accepts post requests on the root path", async () => {
    const server = await createServer();
    const http = await startHttpBridge(server, { port: 0 });
    try {
      await waitForServerReady(server);
      const baseUrl = `http://127.0.0.1:${http.port}/`;
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream"
      } satisfies Record<string, string>;

      const initialise = await fetch(baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "init",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "routing-test", version: "1.0.0" }
          }
        })
      });
      expect(initialise.status).toBe(200);
      const sessionId = initialise.headers.get("mcp-session-id");
      expect(sessionId).toBeTruthy();
      const negotiatedProtocol =
        initialise.headers.get("mcp-protocol-version") ?? "2024-11-05";
      await initialise.text();

      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          ...headers,
          "MCP-Session-Id": sessionId ?? "",
          "MCP-Protocol-Version": negotiatedProtocol
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "list",
          method: "tools/list"
        })
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(Array.isArray(payload.result?.tools)).toBe(true);
    } finally {
      await http.close();
      await server.close();
    }
  });
});
