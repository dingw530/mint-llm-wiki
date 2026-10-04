import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../bootstrap/mcp-client.js', () => ({
  mcpService: {
    getToolCatalog: vi.fn(() => [
      { serverName: 'files', name: 'search', description: 'search files' },
      { serverName: 'mail', name: 'send', description: 'send email' },
    ]),
    getToolDefinition: vi.fn((name: string) =>
      name === 'files__search'
        ? {
            type: 'function',
            function: { name, description: 'search files', parameters: { type: 'object' } },
          }
        : undefined,
    ),
    markToolLoaded: vi.fn(),
    callTool: vi.fn(),
  },
}));

import { DiscoverToolsTool, LoadToolTool } from '../McpDiscoveryTools.js';

describe('MCP discovery tools', () => {
  it('returns lightweight keyword matches without schemas', async () => {
    const result = await new DiscoverToolsTool().execute(
      { query: 'search' },
      { conversationId: 'test' },
    );
    expect(result).toEqual({
      query: 'search',
      results: [{ serverName: 'files', name: 'search', description: 'search files', score: 1 }],
      total: 1,
    });
  });

  it('loads a compatible MCP definition for later Runtime execution', async () => {
    const result = await new LoadToolTool().execute(
      { tool: 'files__search' },
      { conversationId: 'test' },
    );
    expect(result).toMatchObject({ loaded: true, tool: { function: { name: 'files__search' } } });
  });
});
