import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { getServerContext, waitForServerReady } from "./factory.js";
import { withSessionScope } from "../shared/config/session.js";

const INITIALISE_TIMEOUT_MS = 8000;
const ALLOWED_METHODS = new Set(["initialize", "tools/list", "tools/call"]);

type JsonRpcRequest = {
  jsonrpc?: string;
  method?: string;
  params?: unknown;
  id?: string | number | null;
};

type JsonRpcError = { code: number; message: string; data?: unknown };

type JsonRpcResponseMessage = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: JsonRpcError;
};

type PendingRequest = {
  resolve: (message: JsonRpcResponseMessage) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function addCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", error => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function invalidRequest(id: string | number | null): { jsonrpc: "2.0"; error: JsonRpcError; id: string | number | null } {
  return { jsonrpc: "2.0", error: { code: -32600, message: "Invalid request" }, id };
}

function methodNotFound(id: string | number | null): { jsonrpc: "2.0"; error: JsonRpcError; id: string | number | null } {
  return { jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id };
}

function parseUrl(raw: string | undefined): URL {
  return new URL(raw ?? "", "http://localhost");
}

export async function startHttpBridge(server: Server, port: number): Promise<void> {
  const context = getServerContext(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();
  let nextId = 1;
  const pending = new Map<number, PendingRequest>();
  clientTransport.onmessage = message => {
    const payload = message as Record<string, unknown>;
    const idValue = payload?.id;
    if (typeof idValue !== "number") {
      return;
    }
    const entry = pending.get(idValue);
    if (!entry) {
      return;
    }
    pending.delete(idValue);
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.resolve({
      jsonrpc: "2.0",
      id: idValue,
      result: payload.result,
      error: payload.error as JsonRpcError | undefined
    });
  };
  clientTransport.onclose = () => {
    for (const entry of pending.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
      entry.reject(new Error("Transport closed"));
    }
    pending.clear();
  };
  async function dispatch(
    method: string,
    params: unknown,
    connectionId: string,
    timeoutMs?: number
  ): Promise<JsonRpcResponseMessage> {
    await waitForServerReady(server);
    const id = nextId++;
    const payload = {
      jsonrpc: "2.0" as const,
      id,
      method,
      params: isRecord(params) ? params : undefined
    };
    const scope = { config: context.session, connectionId };
    return withSessionScope(scope, () =>
      new Promise((resolve, reject) => {
        const timer = timeoutMs
          ? setTimeout(() => {
              pending.delete(id);
              reject(new Error("Request timed out"));
            }, timeoutMs)
          : undefined;
        pending.set(id, {
          resolve,
          reject,
          timer
        });
        clientTransport.send(payload).catch(error => {
          if (timer) {
            clearTimeout(timer);
          }
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      })
    );
  }
  const httpServer = createHttpServer(async (request, response) => {
    addCorsHeaders(response);
    const url = parseUrl(request.url);
    if (request.method === "OPTIONS" && url.pathname === "/mcp") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/healthz") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname !== "/mcp") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not Found" }));
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Method Not Allowed" }));
      return;
    }
    let payload: JsonRpcRequest;
    try {
      const body = await readBody(request);
      payload = (body ? (JSON.parse(body) as JsonRpcRequest) : {}) ?? {};
    } catch (error) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null })
      );
      context.logger.error("http_request_parse_error", {
        reason: error instanceof Error ? error.message : String(error)
      });
      return;
    }
    if (payload.jsonrpc !== "2.0" || typeof payload.method !== "string") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(invalidRequest(payload.id ?? null)));
      return;
    }
    if (!ALLOWED_METHODS.has(payload.method)) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(methodNotFound(payload.id ?? null)));
      return;
    }
    const connectionId = `${request.socket.remoteAddress ?? "unknown"}:${request.socket.remotePort ?? "0"}`;
    const timeout = payload.method === "initialize" ? INITIALISE_TIMEOUT_MS : undefined;
    try {
      const result = await dispatch(payload.method, payload.params, connectionId, timeout);
      const id = payload.id ?? null;
      response.writeHead(200, { "Content-Type": "application/json" });
      if (result.error) {
        response.end(JSON.stringify({ jsonrpc: "2.0", id, error: result.error }));
      } else {
        response.end(JSON.stringify({ jsonrpc: "2.0", id, result: result.result ?? null }));
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const id = payload.id ?? null;
      const isTimeout = reason === "Request timed out";
      const errorPayload = isTimeout
        ? { jsonrpc: "2.0" as const, id, error: { code: -32001, message: "Request timed out" as const } }
        : {
            jsonrpc: "2.0" as const,
            id,
            error: { code: -32000, message: "Server error", data: { reason } }
          };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(errorPayload));
      const logMethod = isTimeout ? context.logger.warn.bind(context.logger) : context.logger.error.bind(context.logger);
      logMethod("http_request_failed", {
        method: payload.method,
        reason
      });
    }
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  await waitForServerReady(server);
  await context.notifier.notify("tools/list_changed", { tools: context.toolList });
  context.logger.info("server_started", { transport: "http", port });
}
