import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer, waitForServerReady } from "../src/server/factory.js";
import { startHttpBridge } from "../src/server/httpBridge.js";

async function main(): Promise<void> {
  process.env.MCP_TRANSPORT = "http";
  process.env.CLICKUP_TOKEN = process.env.CLICKUP_TOKEN ?? "demo-token";
  process.env.CLICKUP_DEFAULT_TEAM_ID = process.env.CLICKUP_DEFAULT_TEAM_ID ?? "1";
  process.env.MCP_DEBUG = process.env.MCP_DEBUG ?? "0";

  const server = await createServer();
  const http = await startHttpBridge(server, { port: 0 });
  const client = new Client({ name: "smithery-cli", version: "1.0.0" });
  try {
    await waitForServerReady(server);

    const baseUrl = new URL(`http://127.0.0.1:${http.port}/mcp`);
    const transport = new StreamableHTTPClientTransport(baseUrl);

    await client.connect(transport);
    const tools = await client.listTools();
    const ping = tools.tools.find(tool => tool.name === "ping");
    if (!ping) {
      throw new Error("Smithery compatibility check could not find ping tool");
    }
    const call = await client.callTool({ name: "ping", arguments: { text: "smithery" } });
    const callResult = call.result ?? call;
    const echoed =
      callResult.structuredContent?.data?.content?.[0]?.text ??
      callResult.content?.[0]?.text;
    if (echoed !== "smithery") {
      throw new Error("Smithery compatibility ping failed");
    }

    const resource = await client.readResource({ uri: new URL("hello://world") });
    const resourceResult = resource.result ?? resource;
    const resourceText = resourceResult.contents?.[0]?.text;
    if (resourceText !== "hello world") {
      throw new Error("Smithery compatibility resource fetch failed");
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
