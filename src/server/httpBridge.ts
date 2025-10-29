import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";
import type { HttpTransportConfig } from "../config/runtime.js";
import { getServerContext } from "./factory.js";

const SUPPORTED_PATHS = new Set(["/", "/mcp"]);
const HEALTH_PATH = "/healthz";

function parseUrl(raw: string | undefined): URL {
  return new URL(raw ?? "", "http://localhost");
}

function debugEnabled(): boolean {
  const value = process.env.MCP_DEBUG ?? "";
  if (!value) {
    return false;
  }
  const normalised = value.toLowerCase();
  return normalised !== "0" && normalised !== "false";
}

function applyCors(response: ServerResponse, config?: HttpTransportConfig): void {
  const allowOrigin = config?.corsAllowOrigin ?? "*";
  const allowHeaders = config?.corsAllowHeaders ?? "Content-Type, MCP-Session-Id, MCP-Protocol-Version";
  const allowMethods = config?.corsAllowMethods ?? "GET,POST,DELETE,OPTIONS";
  response.setHeader("Access-Control-Allow-Origin", allowOrigin);
  response.setHeader("Access-Control-Allow-Headers", allowHeaders);
  response.setHeader("Access-Control-Allow-Methods", allowMethods);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (!response.headersSent) {
    response.writeHead(status, { "Content-Type": "application/json" });
  }
  response.end(JSON.stringify(body));
}

function logRequest(request: IncomingMessage, response: ServerResponse, startedAt: number): void {
  if (!debugEnabled()) {
    return;
  }
  response.on("finish", () => {
    const elapsed = Date.now() - startedAt;
    console.log(
      JSON.stringify({
        method: request.method ?? "",
        url: request.url ?? "",
        status: response.statusCode,
        elapsedMs: elapsed
      })
    );
  });
}

export async function startHttpBridge(server: Server, options: { port: number; host?: string }): Promise<number> {
  const { port, host } = options;
  const context = getServerContext(server);
  const httpConfig = context.runtime.transport.kind === "http" ? context.runtime.transport : undefined;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: httpConfig?.enableJsonResponse ?? true,
    allowedHosts: httpConfig?.allowedHosts,
    allowedOrigins: httpConfig?.allowedOrigins,
    enableDnsRebindingProtection: httpConfig?.enableDnsRebindingProtection ?? false
  });

  transport.onerror = error => {
    const reason = error instanceof Error ? error.message : String(error);
    context.logger.error("http_transport_error", { reason });
  };

  await server.connect(transport);

  const httpServer = createHttpServer(async (request, response) => {
    const startedAt = Date.now();
    logRequest(request, response, startedAt);
    const url = parseUrl(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS" && (SUPPORTED_PATHS.has(path) || path === HEALTH_PATH)) {
      applyCors(response, httpConfig);
      response.writeHead(204).end();
      return;
    }

    if (request.method === "GET" && path === HEALTH_PATH) {
      applyCors(response, httpConfig);
      writeJson(response, 200, { ok: true });
      return;
    }

    if (!SUPPORTED_PATHS.has(path)) {
      applyCors(response, httpConfig);
      writeJson(response, 404, { error: "Not Found" });
      return;
    }

    if (process.env.MCP_PANIC_MODE === "1") {
      applyCors(response, httpConfig);
      writeJson(response, 200, { jsonrpc: "2.0", id: null, result: {} });
      return;
    }

    applyCors(response, httpConfig);

    try {
      await transport.handleRequest(request as IncomingMessage, response);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      context.logger.error("http_request_failed", { reason, method: request.method, path });
      writeJson(response, 500, { error: "Internal Server Error" });
    }
  });

  const timeoutMs = httpConfig?.initializeTimeoutMs ?? context.runtime.httpInitializeTimeoutMs;
  httpServer.requestTimeout = timeoutMs;
  httpServer.headersTimeout = timeoutMs;
  httpServer.keepAliveTimeout = 5000;

  const actualPort = await new Promise<number>((resolve, reject) => {
    httpServer.once("error", reject);
    const onListen = () => {
      httpServer.off("error", reject);
      const address = httpServer.address();
      if (address && typeof address === "object") {
        resolve((address as AddressInfo).port);
        return;
      }
      if (typeof address === "number") {
        resolve(address);
        return;
      }
      resolve(port);
    };
    if (host) {
      httpServer.listen(port, host, onListen);
    } else {
      httpServer.listen(port, onListen);
    }
  });

  return actualPort;
}
