import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, waitForServerReady } from "../src/server/factory.js";
import { startHttpBridge } from "../src/server/httpBridge.js";

async function runCurl(url: string, payload: Record<string, unknown>): Promise<{ status: number; body: string }> {
  const args = [
    "-sS",
    "-o",
    "-",
    "-w",
    "\\n%{http_code}",
    "-H",
    "Content-Type: application/json",
    "-H",
    "Accept: application/json",
    "-d",
    JSON.stringify(payload),
    url
  ];
  const child = spawn("curl", args);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", chunk => stdout.push(chunk as Buffer));
  child.stderr.on("data", chunk => stderr.push(chunk as Buffer));
  await once(child, "close").then(([code]) => {
    if (code !== 0) {
      const errorOutput = Buffer.concat(stderr).toString() || `curl exited with code ${code}`;
      throw new Error(errorOutput.trim());
    }
  });
  const output = Buffer.concat(stdout).toString().trimEnd();
  const lastNewline = output.lastIndexOf("\n");
  const statusLine = lastNewline === -1 ? output : output.slice(lastNewline + 1);
  const body = lastNewline === -1 ? "" : output.slice(0, lastNewline);
  const status = Number.parseInt(statusLine, 10);
  return { status, body };
}

async function main(): Promise<void> {
  process.env.MCP_TRANSPORT = "http";
  process.env.CLICKUP_TOKEN = process.env.CLICKUP_TOKEN ?? "test-token";
  process.env.CLICKUP_DEFAULT_TEAM_ID = process.env.CLICKUP_DEFAULT_TEAM_ID ?? "1";
  process.env.MCP_DEBUG = process.env.MCP_DEBUG ?? "0";

  const server = await createServer();
  const http = await startHttpBridge(server, { port: 0 });
  try {
    await waitForServerReady(server);

    const baseUrl = `http://127.0.0.1:${http.port}/mcp`;
    const initializeResponse = await runCurl(baseUrl, {
      jsonrpc: "2.0",
      id: "1",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "verify-http", version: "1.0.0" }
      }
    });
    if (initializeResponse.status !== 200) {
      throw new Error(`initialize returned HTTP ${initializeResponse.status}`);
    }
    const initializeBody = JSON.parse(initializeResponse.body);
    const serverName = initializeBody.result?.serverInfo?.name;
    if (!serverName || serverName.toLowerCase() !== "clickup-mcp") {
      throw new Error("initialize response missing serverInfo");
    }

    const listResponse = await runCurl(baseUrl, {
      jsonrpc: "2.0",
      id: "2",
      method: "tools/list"
    });
    if (listResponse.status !== 200) {
      throw new Error(`tools/list returned HTTP ${listResponse.status}`);
    }
    const listBody = JSON.parse(listResponse.body);
    const tools = listBody.result?.tools ?? [];
    if (!Array.isArray(tools) || !tools.some((tool: { name?: string }) => tool.name === "ping")) {
      throw new Error("ping tool not found in list response");
    }

    const callResponse = await runCurl(baseUrl, {
      jsonrpc: "2.0",
      id: "3",
      method: "tools/call",
      params: {
        name: "ping",
        arguments: { text: "verification" }
      }
    });
    if (callResponse.status !== 200) {
      throw new Error(`tools/call returned HTTP ${callResponse.status}`);
    }
    const callBody = JSON.parse(callResponse.body);
    const structured = callBody.result?.structuredContent;
    const fallbackContent = callBody.result?.content;
    const echoed =
      structured?.data?.content?.[0]?.text ??
      (Array.isArray(fallbackContent) ? fallbackContent[0]?.text : undefined);
    if (echoed !== "verification") {
      throw new Error("ping tool did not echo input text");
    }
  } finally {
    await http.close();
    await server.close();
  }
}

main().catch(error => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
});
