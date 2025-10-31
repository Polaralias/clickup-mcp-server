import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer, waitForServerReady } from "../src/server/factory.js";
import { startHttpBridge } from "../src/server/httpBridge.js";

async function main(): Promise<void> {
  process.env.MCP_TRANSPORT = "http";
  process.env.CLICKUP_TOKEN = process.env.CLICKUP_TOKEN ?? "test-token";
  process.env.CLICKUP_DEFAULT_TEAM_ID = process.env.CLICKUP_DEFAULT_TEAM_ID ?? "1";
  process.env.MCP_DEBUG = process.env.MCP_DEBUG ?? "0";

  const server = await createServer();
  const http = await startHttpBridge(server, { port: 0 });
  const client = new Client({ name: "inspector-verify", version: "0.0.1" });
  try {
    await waitForServerReady(server);

    const baseUrl = new URL(`http://127.0.0.1:${http.port}/mcp`);
    const transport = new StreamableHTTPClientTransport(baseUrl);

    await client.connect(transport);
    const tools = await client.listTools();
    if (!tools.tools.some(tool => tool.name === "ping")) {
      throw new Error("Inspector client did not discover the ping tool");
    }
    const call = await client.callTool({ name: "ping", arguments: { text: "inspector" } });
    const callResult = call.result ?? call;
    const echoed =
      callResult.structuredContent?.data?.content?.[0]?.text ??
      callResult.content?.[0]?.text;
    if (echoed !== "inspector") {
      throw new Error("Inspector client ping call failed");
    }
  } finally {
    await client.close();
    await http.close();
    await server.close();
  }
}

main().catch(error => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
});
