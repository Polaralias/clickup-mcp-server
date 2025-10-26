# Audit Log

## 2024-08-17
- Increased the HTTP bridge initialise timeout to 45s by default, exposed `MCP_HTTP_INITIALIZE_TIMEOUT_MS`, and aligned timeout errors with MCP expectations.

## 2025-10-26
- Updated the Smithery deployment configuration to use the container runtime with the explicit start command to satisfy schema validation.

## 2025-02-14
- Extended the HTTP bridge to accept `/` and `/mcp`, added a fast initialise handshake, health endpoint, and guarded debug logging, and deferred heavy warm-ups until after the ready signal.
