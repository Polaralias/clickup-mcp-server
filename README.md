# ClickUp-MCP

ClickUp-MCP is a Model Context Protocol server scaffold providing a foundation for integrating ClickUp tooling with deterministic TypeScript infrastructure.

## Getting Started

Install dependencies:

```
npm i
```

Build the project:

```
npm run build
```

Run in development mode:

```
npm run dev
```

The project now exposes dedicated launchers for each transport so you can iterate locally without touching the main entrypoint:

```sh
npm run dev:stdio
npm run dev:http
```

Run tests:

```
npm test
```

Stdout streams structured JSON logs while ClickUp-MCP communicates over standard IO transport.

To verify tools, run ClickUp-MCP with an MCP client and list the available tools.

## Local stdio run

After building the project you can launch the production bundle over stdio:

```
CLICKUP_TOKEN=xxxxx node dist/hosts/stdio.js
```

The host will validate configuration, start the MCP server, and emit a single readiness line:

```
{"event":"ready","transport":"stdio"}
```

Send `SIGINT` (`Ctrl+C`) or `SIGTERM` to trigger a graceful shutdown.

## Transport self-check

Run these probes once the HTTP bridge is listening on port 8081:

```
curl -s http://127.0.0.1:8081/healthz
curl -s -X POST http://127.0.0.1:8081/ -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0.0.1"}}}'
curl -s -X POST http://127.0.0.1:8081/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

`MCP_DEBUG=1` enables structured HTTP request logs and JSON-RPC traces. Toggle it off (set to `0`) to keep the bridge quiet during automated runs.

## Smithery quick-start

Smithery talks to ClickUp-MCP-Server over Streamable HTTP. Use the provided dev script to run the bridge with the same Express entrypoint that Smithery expects:

```sh
npm run dev:http
```

From another terminal, exercise the end-to-end handshake, tool listing, and ping tool that Smithery relies on:

```sh
npm run verify:http             # raw JSON-RPC via curl
npm run verify:inspector:http   # MCP Inspector exercising HTTP transport
npm run verify:smithery         # Smithery-compatible client calling ping and reading the hello://world resource
```

All three checks connect to `POST /mcp`, confirm the server advertises the `ping` tool and `hello://world` resource, and execute a ping round-trip.

When publishing a Smithery build, point the configuration at the Streamable HTTP endpoint (`http://<host>:<port>/mcp`) or run the stdio entrypoint (`npm run dev:stdio`) if you prefer the default transport. The examples under `examples/basic/` mirror both launch modes and are safe to copy into a Smithery project.

## Deploying with Smithery

To deploy ClickUp-MCP-Server on Smithery:

1. Ensure you have a valid ClickUp API token and team ID.
2. Configure required secrets in your Smithery environment:
   - `CLICKUP_TOKEN`
   - `CLICKUP_DEFAULT_TEAM_ID`
3. Optional tuning:
   - `CLICKUP_AUTH_SCHEME` (override auth detection to `auto`, `personal_token`, or `oauth`)
   - `MAX_ATTACHMENT_MB` (default 8)
   - `MAX_BULK_CONCURRENCY` (default 10)
   - `CHARACTER_LIMIT` (default 25000)
4. Deploy using:
   ```bash
   smithery deploy
   ```

The server will start via `scripts/start.sh` and connect over standard IO as an MCP instance.
Logs are emitted in JSON lines to stdout.

## Deploy on Smithery (TypeScript runtime)

Smithery's TypeScript runtime can instantiate the MCP server directly from the exported factory without using the HTTP bridge.

1. Create or update `smithery.yaml` so it uses the TypeScript runtime and points `startCommand.commandFunction` at `src/server/smithery.ts#createServerFromSmithery`.
2. Provide the required `CLICKUP_TOKEN` secret along with any optional ClickUp configuration variables (team ID, base URL, timeouts, custom headers, etc.).
   - Set `CLICKUP_AUTH_SCHEME` if the automatic token detection should be overridden (`auto`, `personal_token`, `oauth`).
3. Configure optional runtime tuning variables as needed (for example `LOG_LEVEL`, `FEATURE_PERSISTENCE`, `MCP_HTTP_*`, `MAX_ATTACHMENT_MB`, or `MAX_BULK_CONCURRENCY`).
4. Deploy with:
   ```bash
   smithery deploy
   ```

Smithery will call the factory, connect over stdio, and emit tool metadata once the server is ready.

## Smithery TS runtime

Smithery loads the MCP server by invoking `createServer` from `src/server/factory.ts` inside the TypeScript runtime. The runtime initialises the server without starting transports, allowing Smithery to manage connectivity.

The Smithery configuration UI maps to the runtime config: provide an `apiToken` value and optionally set `defaultTeamId`. Additional fields remain optional and fall back to environment defaults.

Environment variables such as `CLICKUP_TOKEN`, `CLICKUP_DEFAULT_TEAM_ID`, and related ClickUp settings act as defaults for the Smithery form. Updating the UI overrides those defaults for the active session.
