# Example MCP servers

This directory contains minimal reference implementations that mirror the transports ClickUp-MCP-Server supports.

## Streamable HTTP

`examples/basic/streamableHttp.ts` starts an Express application with a single `POST /mcp` endpoint. The server registers a `ping` tool and a `hello://world` resource so clients can exercise both discovery and invocation paths.

Run it with:

```sh
npm exec tsx examples/basic/streamableHttp.ts
```

## stdio

`examples/basic/stdio.ts` demonstrates the stdio transport. It registers the same `ping` tool and `hello://world` resource and waits for a client to connect over stdin/stdout.

Run it with:

```sh
npm exec tsx examples/basic/stdio.ts
```
