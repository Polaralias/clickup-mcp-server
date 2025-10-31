import type { Request, Response, NextFunction } from "express";
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import type { HttpTransportConfig } from "../config/runtime.js";
import { PROJECT_NAME } from "../config/constants.js";
import { PACKAGE_VERSION } from "../shared/version.js";
import { getServerContext } from "./factory.js";

const JSON_BODY_LIMIT = "1mb";
const MCP_PATHS = ["/mcp", "/"] as const;
const HEALTH_PATH = "/healthz";
const REQUIRED_ACCEPT_TYPES = ["application/json", "text/event-stream"] as const;
const SESSION_IDLE_TIMEOUT_MS = 60_000;

function isDebugEnabled(): boolean {
  const value = process.env.MCP_DEBUG ?? "";
  if (!value) {
    return false;
  }
  const normalised = value.trim().toLowerCase();
  return normalised !== "0" && normalised !== "false";
}

export function normaliseAcceptHeader(value: string | string[] | undefined): string {
  if (!value) {
    return REQUIRED_ACCEPT_TYPES.join(", ");
  }
  const items = Array.isArray(value) ? value : value.split(",");
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    const base = trimmed.split(";")[0]?.trim().toLowerCase();
    if (!base || seen.has(base)) {
      continue;
    }
    seen.add(base);
    result.push(trimmed);
  }
  for (const required of REQUIRED_ACCEPT_TYPES) {
    if (!seen.has(required)) {
      seen.add(required);
      result.push(required);
    }
  }
  return result.join(", ");
}

function ensureAcceptHeader(request: Request): void {
  request.headers.accept = normaliseAcceptHeader(request.headers.accept);
}

function createCorsMiddleware(config?: HttpTransportConfig) {
  const allowOrigin = config?.corsAllowOrigin ?? "*";
  const allowHeaders =
    config?.corsAllowHeaders ?? "Content-Type, MCP-Session-Id, MCP-Protocol-Version";
  const allowMethods = config?.corsAllowMethods ?? "GET,POST,DELETE,OPTIONS";
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    res.setHeader("Access-Control-Allow-Headers", allowHeaders);
    res.setHeader("Access-Control-Allow-Methods", allowMethods);
    next();
  };
}

function createRequestLogger(subsystem: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isDebugEnabled()) {
      next();
      return;
    }
    const startedAt = Date.now();
    res.on("finish", () => {
      const elapsed = Date.now() - startedAt;
      const payload = {
        subsystem,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        elapsedMs: elapsed
      };
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    });
    next();
  };
}

function createJsonRpcLogger(subsystem: string) {
  return {
    inbound(message: unknown) {
      if (!isDebugEnabled()) {
        return;
      }
      const record = typeof message === "object" && message !== null ? (message as Record<string, unknown>) : undefined;
      const type = Array.isArray(message) ? "batch" : record?.method ? "request" : record?.result !== undefined || record?.error !== undefined ? "response" : "unknown";
      const payload = {
        subsystem,
        direction: "inbound",
        type,
        id: record?.id ?? null,
        method: record?.method
      };
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    },
    outbound(message: unknown) {
      if (!isDebugEnabled()) {
        return;
      }
      const record = typeof message === "object" && message !== null ? (message as Record<string, unknown>) : undefined;
      const payload = {
        subsystem,
        direction: "outbound",
        id: record?.id ?? null,
        method: record?.method ?? null,
        hasError: Boolean(record?.error)
      };
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    }
  };
}

function applyTransportObservers(
  transport: StreamableHTTPServerTransport,
  logger: ReturnType<typeof createJsonRpcLogger>
): void {
  const existingSend = transport.send.bind(transport);
  transport.send = async (message, options) => {
    logger.outbound(message);
    return existingSend(message, options);
  };
  const previousOnMessage = transport.onmessage;
  transport.onmessage = (message, extra) => {
    logger.inbound(message);
    previousOnMessage?.(message, extra);
  };
}

function respondWithJson(res: Response, status: number, body: unknown): void {
  if (!res.headersSent) {
    res.status(status).json(body);
    return;
  }
  res.end();
}

export async function startHttpBridge(
  server: Server,
  options: { port: number; host?: string }
): Promise<{ port: number; close: () => Promise<void> }> {
  const { port, host } = options;
  const context = getServerContext(server);
  const httpConfig = context.runtime.transport.kind === "http" ? context.runtime.transport : undefined;
  const app = express();
  app.disable("x-powered-by");
  app.use(createCorsMiddleware(httpConfig));
  app.use(createRequestLogger("http.server"));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  const activeTransports = new Set<StreamableHTTPServerTransport>();
  const sessionTransports = new Map<string, StreamableHTTPServerTransport>();
  const transportIdleTimers = new Map<StreamableHTTPServerTransport, ReturnType<typeof setTimeout>>();

  const clearIdleTimer = (transport: StreamableHTTPServerTransport) => {
    const timer = transportIdleTimers.get(transport);
    if (timer) {
      clearTimeout(timer);
      transportIdleTimers.delete(transport);
    }
  };

  const unregisterTransport = (transport: StreamableHTTPServerTransport) => {
    clearIdleTimer(transport);
    const sessionId = transport.sessionId;
    if (sessionId !== undefined && sessionTransports.get(sessionId) === transport) {
      sessionTransports.delete(sessionId);
    }
    activeTransports.delete(transport);
  };

  const disposeTransport = async (transport: StreamableHTTPServerTransport, reason: string) => {
    const isActive = activeTransports.has(transport);
    unregisterTransport(transport);
    if (!isActive) {
      return;
    }
    try {
      await transport.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error("http_transport_close_failed", { reason, error: message });
    }
  };

  const scheduleIdleCleanup = (transport: StreamableHTTPServerTransport) => {
    if (SESSION_IDLE_TIMEOUT_MS <= 0) {
      return;
    }
    clearIdleTimer(transport);
    if (!activeTransports.has(transport)) {
      return;
    }
    const timeout = setTimeout(() => {
      transportIdleTimers.delete(transport);
      if (!activeTransports.has(transport)) {
        unregisterTransport(transport);
        return;
      }
      void disposeTransport(transport, "idle_timeout");
    }, SESSION_IDLE_TIMEOUT_MS);
    if (typeof timeout.unref === "function") {
      timeout.unref();
    }
    transportIdleTimers.set(transport, timeout);
  };

  const createTransport = async () => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: httpConfig?.enableJsonResponse ?? true,
      allowedHosts: httpConfig?.allowedHosts,
      allowedOrigins: httpConfig?.allowedOrigins,
      enableDnsRebindingProtection: httpConfig?.enableDnsRebindingProtection ?? false,
      onsessioninitialized: sessionId => {
        if (!sessionId) {
          return;
        }
        sessionTransports.set(sessionId, transport);
        scheduleIdleCleanup(transport);
      },
      onsessionclosed: sessionId => {
        if (sessionId) {
          sessionTransports.delete(sessionId);
        }
        unregisterTransport(transport);
      }
    });
    transport.onerror = error => {
      const reason = error instanceof Error ? error.message : String(error);
      context.logger.error("http_transport_error", { reason });
    };
    transport.onclose = () => {
      unregisterTransport(transport);
    };
    applyTransportObservers(transport, createJsonRpcLogger("http.rpc"));
    activeTransports.add(transport);
    scheduleIdleCleanup(transport);
    await server.connect(transport);
    return transport;
  };

  const getSessionId = (req: Request): { sessionId?: string; errorStatus?: number; errorBody?: unknown } => {
    const header = req.headers["mcp-session-id"];
    if (header === undefined) {
      return {};
    }
    if (Array.isArray(header)) {
      return {
        errorStatus: 400,
        errorBody: {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: Mcp-Session-Id header must be a single value" },
          id: null
        }
      };
    }
    return { sessionId: header };
  };

  for (const path of MCP_PATHS) {
    app.options(path, (_req, res) => {
      res.status(204).end();
    });
  }

  app.get(HEALTH_PATH, (_req, res) => {
    res.json({
      ok: true,
      transport: "http",
      name: PROJECT_NAME,
      version: PACKAGE_VERSION,
      tools: context.tools.map(tool => tool.name)
    });
  });

  const supportedMethods = new Set(["POST", "GET", "DELETE"]);

  for (const path of MCP_PATHS) {
    app.all(path, async (req, res) => {
      if (!supportedMethods.has(req.method)) {
        respondWithJson(res, 405, {
          jsonrpc: "2.0",
          error: { code: -32601, message: "Method Not Allowed" },
          id: null
        });
        return;
      }

      try {
        const parsedBody = req.method === "POST" ? req.body : undefined;
        if (req.method === "POST") {
          ensureAcceptHeader(req);
        }
        const { sessionId, errorStatus, errorBody } = getSessionId(req);
        if (errorStatus !== undefined) {
          respondWithJson(res, errorStatus, errorBody);
          return;
        }
        let transport: StreamableHTTPServerTransport;
        let isNewTransport = false;
        if (sessionId) {
          const existing = sessionTransports.get(sessionId);
          if (!existing) {
            respondWithJson(res, 404, {
              jsonrpc: "2.0",
              error: { code: -32001, message: "Session not found" },
              id: null
            });
            return;
          }
          transport = existing;
        } else {
          transport = await createTransport();
          isNewTransport = true;
        }
        try {
          clearIdleTimer(transport);
          await transport.handleRequest(req, res, parsedBody);
        } finally {
          if (isNewTransport) {
            const session = transport.sessionId;
            const isRegistered = session !== undefined && sessionTransports.get(session) === transport;
            if (!isRegistered) {
              await disposeTransport(transport, "uninitialised_session");
            }
          }
          if (activeTransports.has(transport)) {
            scheduleIdleCleanup(transport);
          }
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        context.logger.error("http_request_failed", {
          reason,
          method: req.method,
          path: req.path
        });
        respondWithJson(res, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal Server Error" },
          id: null
        });
      }
    });
  }

  app.use((req, res) => {
    respondWithJson(res, 404, { error: "Not Found" });
  });

  const serverInstance = app.listen(port, host);
  const actualPort = await new Promise<number>((resolve, reject) => {
    serverInstance.once("error", reject);
    serverInstance.once("listening", () => {
      serverInstance.off("error", reject);
      const address = serverInstance.address();
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

  const close = async () => {
    await new Promise<void>((resolve, reject) => {
      serverInstance.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    const transports = Array.from(activeTransports);
    await Promise.all(transports.map(transport => disposeTransport(transport, "shutdown")));
  };

  return { port: actualPort, close };
}
