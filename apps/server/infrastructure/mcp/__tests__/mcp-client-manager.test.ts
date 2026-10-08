import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock all the heavy dependencies
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    callTool: vi.fn().mockResolvedValue('result'),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    on: vi.fn(),
    stderr: { on: vi.fn() },
    kill: vi.fn(),
    exitCode: null,
    killed: false,
    pid: 12345,
    connected: true,
    channel: {},
  })),
  execSync: vi.fn(() => ({
    toString: () => '/usr/local/bin/npx',
    trim: () => '/usr/local/bin/npx',
  })),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => []),
}));

vi.mock('../../persistence/mcp-server-repository.js', () => ({
  findAll: vi.fn(() => []),
  findByName: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../security/encryption.js', () => ({
  decrypt: vi.fn((value: string) => value),
}));

import { McpClientManager } from '../mcp-client-manager.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

describe('McpClientManager', () => {
  let mcpService: McpClientManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mcpService = new McpClientManager();
  });

  it('initialize with no servers is a no-op', async () => {
    await mcpService.initialize();
    // No connections should be established
    expect(mcpService.getAllStatus()).toEqual({});
  });

  it('getTools returns empty when no connections', async () => {
    const tools = await mcpService.getTools();
    expect(tools).toEqual([]);
  });

  it('getStatus returns disconnected', () => {
    const status = mcpService.getStatus('nonexistent');
    expect(status.connected).toBe(false);
  });

  it('shutdown with no connections is a no-op', async () => {
    await mcpService.shutdown();
    // Should not throw
  });

  it('restartServer throws for non-existent server', async () => {
    await expect(mcpService.restartServer('nonexistent')).rejects.toThrow('not found');
  });

  it('connects URL servers with headers through streamable HTTP', async () => {
    await mcpService.connectServer({
      id: 'remote-id',
      name: 'remote',
      command: '',
      args: [],
      env: {},
      url: 'https://example.com/mcp',
      headers: { 'x-user-token': 'token' },
    });

    expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(new URL('https://example.com/mcp'), {
      requestInit: { headers: { 'x-user-token': 'token' } },
    });
    expect(mcpService.getStatus('remote').connected).toBe(true);
    await mcpService.shutdown();
  });

});
