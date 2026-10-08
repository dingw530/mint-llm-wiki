import type { McpServer } from '@/types';
import { callEndpoint } from '../api/_base';

export function getMcpServers(): Promise<{ servers: McpServer[] }> {
  return callEndpoint('mcp-servers:list');
}

export function createMcpServer(data: Partial<McpServer>): Promise<{ server: McpServer }> {
  return callEndpoint('mcp-servers:create', data);
}

export function updateMcpServer(id: string, data: Partial<McpServer>): Promise<{ server: McpServer }> {
  return callEndpoint('mcp-servers:update', id, data);
}

export function deleteMcpServer(id: string): Promise<{ success: boolean }> {
  return callEndpoint('mcp-servers:delete', id);
}

export function restartMcpServer(id: string): Promise<{ server: McpServer }> {
  return callEndpoint('mcp-servers:restart', id);
}
