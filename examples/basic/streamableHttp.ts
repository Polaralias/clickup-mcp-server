import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const server = new McpServer({ name: "clickup-mcp-example", version: "0.1.0" });

const pingSchema = { text: z.string() };

server.registerTool(
  "ping",
  {
    title: "Ping",
    description: "Echo text over Streamable HTTP",
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

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
app.listen(port, () => {
  process.stdout.write(`Streamable HTTP example listening on http://localhost:${port}/mcp\n`);
});
