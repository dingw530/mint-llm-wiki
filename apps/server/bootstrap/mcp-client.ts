import { McpClientManager } from '../infrastructure/mcp/mcp-client-manager.js';

/** Process-scoped MCP connection manager composed by server startup and application services. */
export const mcpService = new McpClientManager();
