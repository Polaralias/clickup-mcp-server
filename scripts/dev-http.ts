process.env.MCP_TRANSPORT = "http";
if (!process.env.MCP_DEBUG) {
  process.env.MCP_DEBUG = "1";
}
await import("../src/hosts/http.js");
