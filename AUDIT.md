# Audit Log

## 2025-10-29
- Swapped the HTTP bridge to the SDK’s Streamable HTTP transport and introduced tool-level token checks so Smithery sessions without credentials can initialise successfully while still failing authenticated tool calls explicitly.

## 2025-10-28
- Pointed the Smithery start command at `src/server/smithery.ts:createServerFromSmithery` so configuration and auth schemas load correctly in the UI.

## 2025-10-26
- Updated the Smithery deployment configuration to use the container runtime with the explicit start command to satisfy schema validation.
- Normalised ClickUp authentication handling, allowing explicit `CLICKUP_AUTH_SCHEME` overrides and improved auto-detection for Smithery deployments.

## 2025-02-14
- Extended the HTTP bridge to accept `/` and `/mcp`, added a fast initialise handshake, health endpoint, and guarded debug logging, and deferred heavy warm-ups until after the ready signal.

## 2024-08-17
- Increased the HTTP bridge initialise timeout to 45s by default, exposed `MCP_HTTP_INITIALIZE_TIMEOUT_MS`, and aligned timeout errors with MCP expectations.
