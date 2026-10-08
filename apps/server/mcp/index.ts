import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerListTool } from './tools/list.js';
import { registerReadTool } from './tools/read.js';
import { registerSearchTool } from './tools/search.js';
import { registerSchemaTool } from './tools/schema.js';
import { registerLintTool } from './tools/lint.js';

/**
 * Context object passed to each MCP tool handler,
 * providing access to wiki services and configuration.
 */
export interface WikiServiceContext {
  /** Absolute path to the wiki knowledge base root directory */
  wikiPath: string;
}

/**
 * Create a configured MCP server with all wiki tools registered.
 *
 * @param ctx - Wiki service context providing wikiPath and service access
 * @returns A configured McpServer instance ready to be connected to a transport
 */
export function createMcpServer(ctx: WikiServiceContext): McpServer {
  const server = new McpServer({
    name: 'mint-wiki-server',
    version: '1.0.0',
  });

  registerListTool(server, ctx);
  registerReadTool(server, ctx);
  registerSearchTool(server, ctx);
  registerSchemaTool(server, ctx);
  registerLintTool(server, ctx);

  return server;
}
