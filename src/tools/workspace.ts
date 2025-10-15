/**
 * SPDX-FileCopyrightText: © 2025 Talib Kareem <taazkareem@icloud.com>
 * SPDX-License-Identifier: MIT
 *
 * ClickUp MCP Workspace Tools
 * 
 * This module defines workspace-related tools like retrieving workspace hierarchy.
 * It handles the workspace tool definitions and the implementation of their handlers.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { WorkspaceTree, WorkspaceNode } from '../services/clickup/types.js';
import { Logger } from '../logger.js';
import { sponsorService } from '../utils/sponsor-service.js';
import { getWorkspaceService } from '../services/shared.js';

// Create a logger for workspace tools
const logger = new Logger('WorkspaceTool');

// Helper accessor so we always read the latest workspace service instance
const workspaceService = () => getWorkspaceService();

/**
 * Tool definition for retrieving the complete workspace hierarchy
 */
export const workspaceHierarchyTool: Tool = {
  name: 'get_workspace_hierarchy',
  description: `Gets complete workspace hierarchy (spaces, folders, lists). No parameters needed. Returns tree structure with names and IDs for navigation.`,
  inputSchema: {
    type: 'object',
    properties: {}
  }
};

/**
 * Handler for the get_workspace_hierarchy tool
 */
export async function handleGetWorkspaceHierarchy() {
  try {
    // Get workspace hierarchy from the workspace service
    const hierarchy = await workspaceService().getWorkspaceHierarchy();
    
    // Generate tree representation
    const treeOutput = formatTreeOutput(hierarchy);
    
    // Use sponsor service to create the response with optional sponsor message
    return sponsorService.createResponse({ hierarchy: treeOutput }, true);
  } catch (error: any) {
    return sponsorService.createErrorResponse(`Error getting workspace hierarchy: ${error.message}`);
  }
}

/**
 * Format the hierarchy as a tree string
 */
function formatTreeOutput(hierarchy: WorkspaceTree): string {
  // Helper function to format a node and its children as a tree
  const formatNodeAsTree = (node: WorkspaceNode | WorkspaceTree['root'], level: number = 0, isLast: boolean = true, parentPrefix: string = ''): string[] => {
    const lines: string[] = [];
    
    // Calculate the current line's prefix
    const currentPrefix = level === 0 ? '' : parentPrefix + (isLast ? '└── ' : '├── ');
    
    // Format current node with descriptive ID type
    const idType = 'type' in node ? `${node.type.charAt(0).toUpperCase() + node.type.slice(1)} ID` : 'Workspace ID';
    lines.push(`${currentPrefix}${node.name} (${idType}: ${node.id})`);
    
    // Calculate the prefix for children
    const childPrefix = level === 0 ? '' : parentPrefix + (isLast ? '    ' : '│   ');
    
    // Process children
    const children = node.children || [];
    children.forEach((child, index) => {
      const childLines = formatNodeAsTree(
        child,
        level + 1,
        index === children.length - 1,
        childPrefix
      );
      lines.push(...childLines);
    });
    
    return lines;
  };

  // Generate tree representation
  const treeLines = formatNodeAsTree(hierarchy.root);
  
  // Return plain text instead of adding code block markers
  return treeLines.join('\n');
} 