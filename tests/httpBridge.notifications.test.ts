import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./setup.js";
import type { SessionConfig } from "../src/shared/config/schema.js";

type RequestListener = (request: unknown, response: unknown) => void | Promise<void>;

const logger = {
  warn: vi.fn(),
  error: vi.fn()
};

const sessionConfig: SessionConfig = {
  apiToken: "test",
  authScheme: "auto",
  baseUrl: "https://api.example.com/api/v2",
  requestTimeout: 30,
  defaultHeaders: {}
};

const context = {
  session: sessionConfig,
  logger
};

let capturedListener: RequestListener | undefined;

const listenMock = vi.fn(
  (port: number, hostOrCallback?: string | (() => void), callback?: () => void) => {
    const cb = typeof hostOrCallback === "function" ? hostOrCallback : callback;
    cb?.();
    return mockServer;
  }
);

let errorListener: ((error: Error) => void) | undefined;

const mockServer = {
  once: vi.fn((event: string, listener: (error: Error) => void) => {
    if (event === "error") {
      errorListener = listener;
    }
  }),
  off: vi.fn((event: string, listener: (error: Error) => void) => {
    if (event === "error" && errorListener === listener) {
      errorListener = undefined;
    }
  }),
  listen: listenMock,
  address: vi.fn(() => ({ port: 4321 } as AddressInfo)),
  requestTimeout: 0,
  headersTimeout: 0,
  keepAliveTimeout: 0
};

vi.mock("node:http", () => ({
  createServer: (handler: RequestListener) => {
    capturedListener = handler;
    return mockServer;
  }
}));

class FakeRequest extends EventEmitter {
  headers: Record<string, string>;
  method: string;
  url: string;
  socket: { remoteAddress?: string; remotePort?: number };
  #body: Buffer;

  constructor(body: string) {
    super();
    this.headers = { "content-type": "application/json" };
    this.method = "POST";
    this.url = "/";
    this.socket = { remoteAddress: "127.0.0.1", remotePort: 12345 };
    this.#body = Buffer.from(body, "utf8");
  }

  start(): void {
    this.emit("data", this.#body);
    this.emit("end");
  }

  destroy(): void {
    this.emit("aborted");
  }
}

class FakeResponse extends EventEmitter {
  statusCode = 200;
  body?: string;
  headers = new Map<string, string>();

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        this.setHeader(key, value);
      }
    }
    return this;
  }

  end(body?: string): void {
    if (body !== undefined) {
      this.body = body;
    }
    this.emit("finish");
  }

  writeContinue(): void {
    /* no-op */
  }
}

type Transport = {
  onmessage?: (payload: unknown) => void;
};

const receivedMessages: unknown[] = [];

const serverStub = {
  connect: vi.fn(async (transport: Transport & { send: (payload: unknown) => Promise<void> }) => {
    transport.onmessage = payload => {
      receivedMessages.push(payload);
    };
  })
};

const { startHttpBridge } = await import("../src/server/httpBridge.js");
async function performRequest(body: unknown): Promise<{ response: FakeResponse; request: FakeRequest }> {
  if (!capturedListener) {
    throw new Error("HTTP handler not registered");
  }
  const request = new FakeRequest(JSON.stringify(body));
  const response = new FakeResponse();
  const promise = capturedListener(request as unknown, response as unknown);
  request.start();
  await promise;
  return { response, request };
}

describe("HTTP bridge notifications", () => {
  beforeEach(() => {
    receivedMessages.length = 0;
    logger.warn.mockReset();
    logger.error.mockReset();
    serverStub.connect.mockClear();
    listenMock.mockClear();
  });

  it("responds with 204 and forwards notifications without awaiting a reply", async () => {
    const factoryModule = await import("../src/server/factory.js");
    const getServerContextSpy = vi
      .spyOn(factoryModule, "getServerContext")
      .mockReturnValue(context);
    const waitForServerReadySpy = vi
      .spyOn(factoryModule, "waitForServerReady")
      .mockResolvedValue();

    const port = await startHttpBridge(serverStub as never, { port: 0, host: "127.0.0.1" });
    expect(port).toBe(4321);
    expect(listenMock).toHaveBeenCalled();

    const payload = {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 7, reason: "timeout" }
    };

    const { response } = await performRequest(payload);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBeUndefined();
    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0]).toMatchObject({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: payload.params
    });
    expect((receivedMessages[0] as Record<string, unknown>).id).toBeUndefined();
    expect(waitForServerReadySpy).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    getServerContextSpy.mockRestore();
    waitForServerReadySpy.mockRestore();
  });
});
