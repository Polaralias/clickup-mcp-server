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

## Deploying with Smithery

To deploy ClickUp-MCP-Server on Smithery:

1. Ensure you have a valid ClickUp API token and team ID.
2. Configure required secrets in your Smithery environment:
   - `CLICKUP_TOKEN`
   - `CLICKUP_DEFAULT_TEAM_ID`
3. Optional tuning:
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
3. Configure optional runtime tuning variables as needed (for example `LOG_LEVEL`, `FEATURE_PERSISTENCE`, `MCP_HTTP_*`, `MAX_ATTACHMENT_MB`, or `MAX_BULK_CONCURRENCY`).
4. Deploy with:
   ```bash
   smithery deploy
   ```

Smithery will call the factory, connect over stdio, and emit tool metadata once the server is ready.
