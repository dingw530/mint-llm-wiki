import { v4 as uuidv4 } from 'uuid';
import * as mcpServerRepository from '../../infrastructure/persistence/mcp-server-repository.js';
import { mcpService } from '../../bootstrap/mcp-client.js';
import type { McpServer } from '../../types.js';

type EditableMcpServer = Partial<
  Pick<McpServer, 'name' | 'command' | 'args' | 'env' | 'url' | 'headers'>
>;

function mcpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw mcpError(400, 'args must be an array of strings');
  }
  return value;
}

function parseStringRecord(value: unknown, field: string): Record<string, string> {
  if (!isStringRecord(value)) throw mcpError(400, `${field} must be an object of strings`);
  return value;
}

function validateConfig(name: unknown, command: unknown, url: unknown): void {
  if (!name) throw mcpError(400, 'name is required');
  if (!command && !url) throw mcpError(400, 'command or url is required');
  if (command && url) throw mcpError(400, 'command and url are mutually exclusive');
  if (url) {
    try {
      if (typeof url !== 'string') throw new Error();
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      throw mcpError(400, 'url must be a valid http(s) URL');
    }
  }
}

/** Return configured MCP servers together with the current connection tool cache. */
export function listMcpServers(): { servers: Array<McpServer & { tools: unknown[] }> } {
  const servers = mcpServerRepository.findAll();
  return {
    servers: servers.map((server) => ({
      ...server,
      tools: mcpService.getServerTools(server.name),
    })),
  };
}

/** Read one persisted MCP server configuration. */
export function getMcpServer(id: string): { server: McpServer } {
  const server = mcpServerRepository.findById(id);
  if (!server) throw mcpError(404, 'MCP Server not found');
  return { server };
}

/** Persist and connect one MCP server while retaining the existing best-effort startup result. */
export async function createMcpServer(
  data: Record<string, unknown>,
): Promise<{ server: McpServer }> {
  const name = typeof data.name === 'string' ? data.name : '';
  const command = typeof data.command === 'string' ? data.command : '';
  const url = data.url === null ? null : typeof data.url === 'string' ? data.url : null;
  validateConfig(data.name, data.command, data.url);
  const server = mcpServerRepository.create({
    id: uuidv4(),
    name,
    command,
    args: data.args === undefined ? [] : parseStringArray(data.args),
    env: data.env === undefined ? {} : parseStringRecord(data.env, 'env'),
    url,
    headers: data.headers === undefined ? {} : parseStringRecord(data.headers, 'headers'),
  });
  try {
    await mcpService.connectServer(server);
  } catch {
    // Connection status is recorded by the manager; config creation remains successful.
  }
  return { server };
}

/** Reconfigure an MCP server by disconnecting the old transport before reconnecting. */
export async function updateMcpServer(
  id: string,
  data: Record<string, unknown>,
): Promise<{ server: McpServer }> {
  const existing = mcpServerRepository.findById(id);
  if (!existing) throw mcpError(404, 'MCP Server not found');
  const fields: EditableMcpServer = {};
  if (data.name !== undefined) {
    if (typeof data.name !== 'string') throw mcpError(400, 'name must be a string');
    fields.name = data.name;
  }
  if (data.command !== undefined) {
    if (typeof data.command !== 'string') throw mcpError(400, 'command must be a string');
    fields.command = data.command;
  }
  if (data.args !== undefined) fields.args = parseStringArray(data.args);
  if (data.env !== undefined) fields.env = parseStringRecord(data.env, 'env');
  if (data.url !== undefined) {
    if (data.url !== null && typeof data.url !== 'string')
      throw mcpError(400, 'url must be a string or null');
    fields.url = data.url;
  }
  if (data.headers !== undefined) fields.headers = parseStringRecord(data.headers, 'headers');

  const nextCommand = fields.command !== undefined ? fields.command : existing.command;
  const nextUrl = fields.url !== undefined ? fields.url : existing.url;
  validateConfig(fields.name || existing.name, nextCommand, nextUrl);
  await mcpService.disconnectServer(existing.name);
  const updated = mcpServerRepository.update(id, fields);
  if (!updated) throw mcpError(404, 'MCP Server not found');
  try {
    await mcpService.connectServer(updated);
  } catch {
    // Connection status is recorded by the manager; config update remains successful.
  }
  return { server: updated };
}

/** Delete an MCP server after closing its connection. */
export async function deleteMcpServer(id: string): Promise<{ success: true }> {
  const server = mcpServerRepository.findById(id);
  if (!server) throw mcpError(404, 'MCP Server not found');
  await mcpService.disconnectServer(server.name);
  mcpServerRepository.deleteById(id);
  return { success: true };
}

/** Restart one MCP server by its persisted id. */
export async function restartMcpServer(id: string): Promise<{ server: McpServer | null }> {
  const server = mcpServerRepository.findById(id);
  if (!server) throw mcpError(404, 'MCP Server not found');
  await mcpService.restartServer(server.name);
  return { server: mcpServerRepository.findById(id) };
}
