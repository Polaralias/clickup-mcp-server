#!/usr/bin/env node

/**
 * SPDX-FileCopyrightText: © 2025 Talib Kareem <taazkareem@icloud.com>
 * SPDX-License-Identifier: MIT
 *
 * ClickUp MCP Server
 * 
 * This custom server implements the Model Context Protocol (MCP) specification to enable
 * AI applications to interact with ClickUp workspaces. It provides a standardized 
 * interface for managing tasks, lists, folders and other ClickUp entities using Natural Language.
 * 
 * Key Features:
 * - Complete task management (CRUD operations, moving, duplicating)
 * - Workspace organization (spaces, folders, lists)
 * - Bulk operations with concurrent processing
 * - Natural language date parsing
 * - File attachments support
 * - Name-based entity resolution
 * - Markdown formatting
 * - Built-in rate limiting
 * - Multiple transport options (STDIO, SSE, HTTP Streamable)
 *
 * For full documentation and usage examples, please refer to the README.md file.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { info, error } from './logger.js';
import config, { getConfiguration, initializeConfiguration, validateConfig } from './config.js';
import { z } from 'zod';

// =============================
// MCP Configuration Schema
// =============================
export const configSchema = z.object({
  clickupApiKey: z.string().describe("Your ClickUp API key."),
  clickupTeamId: z.string().describe("Your ClickUp Team ID.")
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  error("Uncaught Exception", { message: err.message, stack: err.stack });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  error("Unhandled Rejection", { reason });
  process.exit(1);
});

async function startStdioServer() {
  info('Starting ClickUp MCP Server...');

  // Log essential environment information
  info('Server environment', {
    pid: process.pid,
    node: process.version,
    os: process.platform,
    arch: process.arch,
  });

  const configuration = getConfiguration();
  const requiredCredentialKeys = ['clickupApiKey', 'clickupTeamId'] as const;
  try {
    validateConfig(configuration);
  } catch (validationError) {
    const missing = requiredCredentialKeys.filter((key) => !configuration[key]);
    error('Missing required configuration', {
      missing,
      message: validationError instanceof Error ? validationError.message : String(validationError)
    });
    process.exit(1);
  }

  // Detect and log configuration source
  const keySource = config.credentialSources.clickupApiKey;
  const teamSource = config.credentialSources.clickupTeamId;
  info('Configuration source', {
    clickupApiKey: keySource,
    clickupTeamId: teamSource
  });

  // Backfill process.env for downstream consumers that still rely on it
  process.env.CLICKUP_API_KEY = configuration.clickupApiKey;
  process.env.CLICKUP_TEAM_ID = configuration.clickupTeamId;

  // Configure the server with all handlers
  info('Configuring server request handlers');
  const { configureServer, server } = await import('./server.js');
  await configureServer();

  // Connect using stdio transport
  info('Connecting to MCP stdio transport');
  const transport = new StdioServerTransport();
  await server.connect(transport);

  info('Server startup complete - ready to handle requests');
}

/**
 * Application entry point that configures and starts the MCP server.
 */
async function main() {
  try {
    if (config.enableSSE) {
      // Start the new SSE server with HTTP Streamable support
      const { startSSEServer } = await import('./sse_server.js');
      startSSEServer();
    } else {
      // Start the traditional STDIO server
      await startStdioServer();
    }
  } catch (err) {
    error('Error during server startup', {
      message: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }
}

main().catch((err) => {
  error("Unhandled server error", { message: err.message, stack: err.stack });
  process.exit(1);
});

export default async function createServer({
  config: sessionConfig,
}: {
  config: z.infer<typeof configSchema>;
}): Promise<McpServer> {
  const runtimeConfig = initializeConfiguration({
    clickupApiKey: sessionConfig.clickupApiKey,
    clickupTeamId: sessionConfig.clickupTeamId,
  });

  process.env.CLICKUP_API_KEY = runtimeConfig.clickupApiKey;
  process.env.CLICKUP_TEAM_ID = runtimeConfig.clickupTeamId;

  const { configureServer, server } = await import('./server.js');
  await configureServer();
  return server as unknown as McpServer;
}
