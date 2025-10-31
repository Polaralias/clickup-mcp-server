process.env.MCP_TRANSPORT = "stdio";
if (!process.env.MCP_DEBUG) {
  process.env.MCP_DEBUG = "1";
}
await import("../src/hosts/stdio.js");
