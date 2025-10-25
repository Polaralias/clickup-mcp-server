import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../src/config/runtime.js";

const BASE_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...BASE_ENV };
});

afterAll(() => {
  process.env = { ...BASE_ENV };
});

describe("runtime configuration", () => {
  it("defaults to stdio transport", () => {
    delete process.env.MCP_TRANSPORT;
    const config = loadRuntimeConfig();
    expect(config.transport).toEqual({ kind: "stdio" });
  });

  it("configures http transport when requested", () => {
    process.env.MCP_TRANSPORT = "http";
    process.env.MCP_HTTP_PORT = "8080";
    process.env.MCP_HTTP_HOST = "127.0.0.1";
    process.env.MCP_HTTP_CORS_ALLOW_ORIGIN = "https://example.com";
    process.env.MCP_HTTP_CORS_ALLOW_HEADERS = "X-Test";
    process.env.MCP_HTTP_CORS_ALLOW_METHODS = "POST";
    process.env.MCP_HTTP_ENABLE_JSON_RESPONSE = "false";
    process.env.MCP_HTTP_ALLOWED_HOSTS = "example.com,api.example.com";
    process.env.MCP_HTTP_ALLOWED_ORIGINS = "https://example.com";
    process.env.MCP_HTTP_ENABLE_DNS_REBINDING_PROTECTION = "true";

    const config = loadRuntimeConfig();
    expect(config.transport.kind).toBe("http");
    if (config.transport.kind !== "http") {
      throw new Error("Expected HTTP transport configuration");
    }
    expect(config.transport.port).toBe(8080);
    expect(config.transport.host).toBe("127.0.0.1");
    expect(config.transport.corsAllowOrigin).toBe("https://example.com");
    expect(config.transport.corsAllowHeaders).toBe("X-Test");
    expect(config.transport.corsAllowMethods).toBe("POST");
    expect(config.transport.enableJsonResponse).toBe(false);
    expect(config.transport.allowedHosts).toEqual(["example.com", "api.example.com"]);
    expect(config.transport.allowedOrigins).toEqual(["https://example.com"]);
    expect(config.transport.enableDnsRebindingProtection).toBe(true);
  });
});
