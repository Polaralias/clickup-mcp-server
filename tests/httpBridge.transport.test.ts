import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./setup.js";

const observedTransportOptions: unknown[] = [];

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", async () => {
  const actual = await vi.importActual<
    typeof import("@modelcontextprotocol/sdk/server/streamableHttp.js")
  >("@modelcontextprotocol/sdk/server/streamableHttp.js");
  type TransportOptions = ConstructorParameters<typeof actual.StreamableHTTPServerTransport>[0];
  class ObservedStreamableHTTPServerTransport extends actual.StreamableHTTPServerTransport {
    constructor(options: TransportOptions) {
      observedTransportOptions.push(options);
      super(options);
    }
  }
  return {
    ...actual,
    StreamableHTTPServerTransport: ObservedStreamableHTTPServerTransport
  };
});

const { createServer, waitForServerReady } = await import("../src/server/factory.js");
const { startHttpBridge } = await import("../src/server/httpBridge.js");

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.CLICKUP_TOKEN = process.env.CLICKUP_TOKEN ?? "test-token";
  process.env.CLICKUP_DEFAULT_TEAM_ID = process.env.CLICKUP_DEFAULT_TEAM_ID ?? "1";
  observedTransportOptions.length = 0;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function issueToolsListRequest(port: number): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "list",
      method: "tools/list"
    })
  });
  expect(response.status).toBe(200);
  await response.json();
}

describe("http bridge transport configuration", () => {
  it("passes the configured initialize timeout to the streamable transport", async () => {
    process.env.MCP_TRANSPORT = "http";
    process.env.MCP_HTTP_INITIALIZE_TIMEOUT_MS = "120000";

    const server = await createServer();
    const http = await startHttpBridge(server, { port: 0 });
    try {
      await waitForServerReady(server);
      await issueToolsListRequest(http.port);
    } finally {
      await http.close();
      await server.close();
    }

    expect(observedTransportOptions.length).toBeGreaterThan(0);
    const options = observedTransportOptions.at(-1) as { initializeTimeoutMs?: number } | undefined;
    expect(options?.initializeTimeoutMs).toBe(120000);
  });

  it("falls back to the runtime initialize timeout when transport config omits it", async () => {
    delete process.env.MCP_TRANSPORT;
    process.env.MCP_HTTP_INITIALIZE_TIMEOUT_MS = "90000";

    const server = await createServer();
    const http = await startHttpBridge(server, { port: 0 });
    try {
      await waitForServerReady(server);
      await issueToolsListRequest(http.port);
    } finally {
      await http.close();
      await server.close();
    }

    expect(observedTransportOptions.length).toBeGreaterThan(0);
    const options = observedTransportOptions.at(-1) as { initializeTimeoutMs?: number } | undefined;
    expect(options?.initializeTimeoutMs).toBe(90000);
  });
});
