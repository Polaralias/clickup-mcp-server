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

const paths = ["/mcp", "/"] as const;
const methods = new Set(["POST", "GET", "DELETE"]);

for (const path of paths) {
  app.options(path, (_req, res) => {
    res.status(204).end();
  });

  app.all(path, async (req, res) => {
    if (!methods.has(req.method)) {
      res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32601, message: "Method Not Allowed" },
        id: null
      });
      return;
    }

    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
    });

    const parsedBody = req.method === "POST" ? req.body : undefined;
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  });
}

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
app.listen(port, () => {
  process.stdout.write(`Streamable HTTP example listening on http://localhost:${port}/mcp\n`);
});
