import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

async function main(): Promise<void> {
  const server = new McpServer({ name: "clickup-mcp-example", version: "0.1.0" });
  const pingSchema = { text: z.string() };

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Echo text over stdio",
      inputSchema: pingSchema
    },
    async ({ text }) => ({
      content: [{ type: "text", text }]
    })
  );

  server.registerResource(
    "hello",
    "hello://world",
    { title: "Hello", description: "World resource" },
    async uri => ({
      contents: [{ uri: uri.href, text: "hello world" }]
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(error => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
});
