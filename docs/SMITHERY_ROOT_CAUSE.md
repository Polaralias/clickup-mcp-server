# Smithery connectivity root cause

## Summary
Smithery exercises the Model Context Protocol Streamable HTTP transport by opening a fresh HTTP POST for every JSON-RPC exchange. The pre-refactor HTTP bridge created **one** `StreamableHTTPServerTransport` instance at start-up and reused it for every request. This violated the SDK guidance to create a new transport for each HTTP request and caused internal bookkeeping inside the transport to leak across clients.

When two HTTP exchanges overlapped – e.g. Smithery's initial `initialize` call immediately followed by `tools/list` – the shared transport attempted to route the second response through state that was already disposed. The SDK raised an internal error (`No connection established for request ID …` / `request aborted`), we caught the exception, and the bridge returned `HTTP/1.1 500 Internal Server Error`.

## Reproduction steps
1. Restore the legacy bridge (`git checkout HEAD src/server/httpBridge.ts`).
2. Start the server in HTTP mode (e.g. `npx tsx tmp/run-old-server.ts`).
3. Issue the two requests Smithery sends in quick succession (pipeline over a single connection):
   ```sh
   { printf 'POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:42999\r\nContent-Type: application/json\r\nAccept: application/json\r\nContent-Length: 159\r\n\r\n'; \
     printf '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smithery","version":"1.0.0"}}}'; \
     printf '\r\nPOST /mcp HTTP/1.1\r\nHost: 127.0.0.1:42999\r\nContent-Type: application/json\r\nAccept: application/json\r\nContent-Length: 48\r\n\r\n'; \
     printf '{"jsonrpc":"2.0","id":"2","method":"tools/list"}'; } | nc 127.0.0.1 42999
   ```
4. The bridge logs show the second request fails and a 500 response is emitted:
   ```json
   {"protocolVersion":"2024-11-05","ts":"2025-10-31T07:18:58.448Z","level":"info","subsystem":"mcp.server","msg":"initialize_completed","correlationId":"274883c0-8cc7-4141-8b0a-12aa62919e7e"}
   {"reason":"request aborted","ts":"2025-10-31T07:18:59.012Z","level":"error","subsystem":"mcp.server","msg":"http_transport_error"}
   ```
5. Curl receives `HTTP/1.1 500 Internal Server Error` for the second response.

*(The log excerpt above was captured from `/tmp/old-server.log` while replaying the Smithery pipeline locally.)*

## Why the fix works
The new Express bridge (`src/server/httpBridge.ts`) allocates a fresh `StreamableHTTPServerTransport` inside the `POST /mcp` handler and calls `await server.connect(transport)` before invoking `transport.handleRequest`. Each HTTP exchange now gets isolated state, mirroring the SDK reference implementation. The bridge also:

* Normalises the `Accept` header so Smithery's `application/json` requests are accepted.
* Tears down the per-request transport on `res.close()` to avoid dangling state.
* Adds structured request/response logging and JSON-RPC tracing gated behind `MCP_DEBUG` so future regressions are observable.

With the per-request transport in place, Smithery, the MCP Inspector, and the verification scripts consistently complete `initialize`, `tools/list`, and `tools/call` without hitting the transport error path.
