import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";

const serverContextSymbol = Symbol.for("clickup.mcp.serverContext");

type ToolListEntry = {
  name: string;
  description: string;
  annotations: { readOnlyHint: boolean; idempotentHint: boolean; destructiveHint: boolean };
  inputSchema: Record<string, unknown>;
};

type ServerContext = {
  notifier: { notify: (method: string, params: unknown) => Promise<void> };
  toolList: ToolListEntry[];
  logger: { info: (message: string, extras?: Record<string, unknown>) => void; error: (message: string, extras?: Record<string, unknown>) => void };
};

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

function getContext(server: Server): ServerContext {
  const context = Reflect.get(server, serverContextSymbol) as ServerContext | undefined;
  if (!context) {
    throw new Error("Server context unavailable");
  }
  return context;
}

function addCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
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

function parseJson(body: string): unknown {
  if (!body) {
    return undefined;
  }
  return JSON.parse(body) as unknown;
}

function methodNotFound(id: string | number | null): { jsonrpc: "2.0"; error: JsonRpcError; id: string | number | null } {
  return { jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id };
}

function parseUrl(raw: string | undefined): URL {
  return new URL(raw ?? "", "http://localhost");
}

export async function startHttpBridge(
  server: Server,
  opts: { port: number; host?: string }
): Promise<void> {
  const context = getContext(server);
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
    const response: JsonRpcResponseMessage = {
      jsonrpc: "2.0",
      id: idValue,
      result: payload.result,
      error: payload.error as JsonRpcError | undefined
    };
    entry.resolve(response);
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

  async function sendRequest(method: string, params: unknown, timeoutMs?: number): Promise<JsonRpcResponseMessage> {
    const id = nextId++;
    const payload = {
      jsonrpc: "2.0" as const,
      id,
      method,
      params: isRecord(params) ? params : undefined
    };
    return new Promise((resolve, reject) => {
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
    });
  }

  const httpServer = createHttpServer(async (request, response) => {
    addCorsHeaders(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    const url = parseUrl(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname !== "/mcp") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Not Found" }));
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Method Not Allowed" }));
      return;
    }
    let payload: JsonRpcRequest;
    try {
      const body = await readBody(request);
      const parsed = parseJson(body);
      payload = (parsed ?? {}) as JsonRpcRequest;
    } catch (error) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null })
      );
      context.logger.error("http_request_parse_error", {
        reason: error instanceof Error ? error.message : String(error)
      });
      return;
    }
    if (payload.jsonrpc !== "2.0" || typeof payload.method !== "string") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(invalidRequest(payload.id ?? null)));
      return;
    }
    const allowed = payload.method === "initialize" || payload.method === "tools/list" || payload.method === "tools/call";
    if (!allowed) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(methodNotFound(payload.id ?? null)));
      return;
    }
    const timeout = payload.method === "initialize" ? 8000 : undefined;
    try {
      const result = await sendRequest(payload.method, payload.params, timeout);
      const id = payload.id ?? null;
      response.writeHead(200, { "content-type": "application/json" });
      if (result.error) {
        response.end(JSON.stringify({ jsonrpc: "2.0", id, error: result.error }));
      } else {
        response.end(JSON.stringify({ jsonrpc: "2.0", id, result: result.result ?? null }));
      }
    } catch (error) {
      const id = payload.id ?? null;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: "Server error", data: { reason: error instanceof Error ? error.message : String(error) } }
        })
      );
      context.logger.error("http_request_failed", {
        method: payload.method,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    const onListen = () => {
      httpServer.off("error", reject);
      resolve();
    };
    if (opts.host) {
      httpServer.listen(opts.port, opts.host, onListen);
    } else {
      httpServer.listen(opts.port, onListen);
    }
  });

  console.log("ready");
  await context.notifier.notify("tools/list_changed", { tools: context.toolList });
  context.logger.info("server_started", {
    transport: "http",
    port: opts.port,
    host: opts.host ?? "0.0.0.0"
  });
}
