import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";
import { PROJECT_NAME } from "../config/constants.js";
import { PACKAGE_VERSION } from "../shared/version.js";
import { getServerContext, waitForServerReady } from "./factory.js";
import { withSessionScope } from "../shared/config/session.js";

const INITIALISE_TIMEOUT_MS = 8000;
const ALLOWED_METHODS = new Set(["initialize", "tools/list", "tools/call"]);
const SUPPORTED_PATHS = new Set(["/", "/mcp"]);
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

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

class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
    this.name = "PayloadTooLargeError";
  }
}

function addCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    request.on("data", chunk => {
      if (aborted) {
        return;
      }
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      total += buffer.length;
      if (total > MAX_BODY_BYTES) {
        aborted = true;
        reject(new PayloadTooLargeError());
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      if (aborted) {
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", error => {
      if (aborted) {
        return;
      }
      aborted = true;
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

function debugEnabled(): boolean {
  const value = process.env.MCP_DEBUG ?? "";
  if (!value) {
    return false;
  }
  const normalised = value.toLowerCase();
  return normalised !== "0" && normalised !== "false";
}

export async function startHttpBridge(server: Server, port: number): Promise<number> {
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
    options?: { timeoutMs?: number; skipReady?: boolean }
  ): Promise<JsonRpcResponseMessage> {
    if (!options?.skipReady) {
      await waitForServerReady(server);
    }
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
        const timer = options?.timeoutMs
          ? setTimeout(() => {
              pending.delete(id);
              reject(new Error("Request timed out"));
            }, options.timeoutMs)
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
    const path = url.pathname;
    const method = request.method ?? "";
    const shouldLog = debugEnabled();
    if (shouldLog) {
      response.on("finish", () => {
        context.logger.info("http_request", {
          method,
          path,
          contentLength: request.headers["content-length"],
          status: response.statusCode
        });
      });
    }
    if (method === "OPTIONS" && SUPPORTED_PATHS.has(path)) {
      response.writeHead(204);
      response.end();
      return;
    }
    if (method === "GET" && path === "/healthz") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (!(method === "POST" && SUPPORTED_PATHS.has(path))) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not Found" }));
      return;
    }
    let payload: JsonRpcRequest;
    try {
      const body = await readBody(request);
      payload = (body ? (JSON.parse(body) as JsonRpcRequest) : {}) ?? {};
    } catch (error) {
      const status = error instanceof PayloadTooLargeError ? 413 : 400;
      const reason = error instanceof Error ? error.message : String(error);
      const body =
        error instanceof PayloadTooLargeError
          ? { error: "Payload Too Large" }
          : { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null };
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
      context.logger.warn("http_request_parse_error", {
        reason
      });
      return;
    }
    if (payload.jsonrpc !== "2.0" || typeof payload.method !== "string") {
      response.writeHead(400, { "Content-Type": "application/json" });
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
    if (payload.method === "initialize") {
      const methodName = payload.method;
      const id = payload.id ?? null;
      const params = isRecord(payload.params) ? payload.params : {};
      const protocolVersionRaw = params.protocolVersion;
      const protocolVersion = typeof protocolVersionRaw === "string" && protocolVersionRaw.length > 0
        ? protocolVersionRaw
        : DEFAULT_PROTOCOL_VERSION;
      const result = {
        protocolVersion,
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: PROJECT_NAME, version: PACKAGE_VERSION }
      };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      setImmediate(() => {
        void dispatch(methodName, payload.params, connectionId, {
          timeoutMs: timeout,
          skipReady: true
        }).catch(error => {
          const reason = error instanceof Error ? error.message : String(error);
          context.logger.warn("http_initialize_forward_failed", { reason });
        });
      });
      return;
    }
    try {
      const result = await dispatch(payload.method, payload.params, connectionId, { timeoutMs: timeout });
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
  const actualPort = await new Promise<number>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, () => {
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
    });
  });
  return actualPort;
}
