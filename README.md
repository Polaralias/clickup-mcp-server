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

## Container and Smithery deploy

Local run:

CLICKUP_TOKEN=xxxxx PORT=8081 SMITHERY_HTTP=1 node dist/index.js

Health check:

curl -s http://127.0.0.1:8081/healthz

Initialise:

curl -s -X POST http://127.0.0.1:8081/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"local","version":"0.1.0"}}}'
