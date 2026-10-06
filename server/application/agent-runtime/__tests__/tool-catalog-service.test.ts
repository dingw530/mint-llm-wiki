import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BaseTool } from '../../../agent-runtime/tooling/base-tool.js';
import { ToolRegistry } from '../tooling/tool-registry.js';
import { ToolCatalogService, type AgentToolScope } from '../tool-catalog-service.js';

interface AgentRecord extends AgentToolScope {
  id: string;
}

interface McpRecord {
  serverName: string;
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, never> };
}

class FakeTool extends BaseTool<Record<string, never>, unknown> {
  readonly inputSchema = z.object({});

  constructor(
    readonly name: string,
    readonly description = `${name} description`,
  ) {
    super();
  }

  async execute(): Promise<unknown> {
    return {};
  }

  override getCallSummary(): string {
    return `${this.name} call`;
  }

  override getResultSummary(): string {
    return `${this.name} result`;
  }
}

function createCatalog(legacyMode: boolean) {
  const registry = new ToolRegistry();
  registry.register(new FakeTool('http_fetch'));
  const records = new Map<string, McpRecord>([
    [
      'alpha__search',
      {
        serverName: 'alpha',
        name: 'search',
        description: 'Search alpha',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
    [
      'beta__write',
      {
        serverName: 'beta',
        name: 'write',
        description: 'Write beta',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  ]);
  const loadedNames = ['alpha__search', 'beta__write'];
  const agents = new Map<string, AgentRecord>([
    ['alpha-agent', { id: 'alpha-agent', available: true, mcpServerIds: ['alpha'] }],
    ['disabled-agent', { id: 'disabled-agent', available: false, mcpServerIds: ['beta'] }],
  ]);
  const service = new ToolCatalogService({
    registry,
    mcpCatalog: {
      getLoadedToolNames: () => loadedNames,
      getToolRecord: (name) => records.get(name),
      getAllToolNames: (serverIds) =>
        [...records.keys()].filter((fullName) => {
          const serverName = fullName.split('__')[0];
          return !serverIds || serverIds.includes(serverName);
        }),
    },
    findAgent: (agentId) => agents.get(agentId),
    createMcpTool: (record) =>
      new FakeTool(`${record.serverName}__${record.name}`, record.description),
    isLegacyMcpEnabled: () => legacyMode,
  });

  return { service, registry, loadedNames, records };
}

describe('ToolCatalogService', () => {
  it('exposes built-ins and only loaded MCP tools to the general Agent', async () => {
    const { service, loadedNames } = createCatalog(false);
    loadedNames.splice(1);
    const tools = await service.getAllToolDefinitions('general');
    const names = tools.map((tool) => tool.function.name);

    expect(names).toContain('http_fetch');
    expect(names).toContain('alpha__search');
    expect(names).not.toContain('beta__write');
  });

  it('filters loaded MCP schemas to the Agent server allowlist', async () => {
    const { service } = createCatalog(false);
    const tools = await service.getAllToolDefinitions('alpha-agent');
    const names = tools.map((tool) => tool.function.name);

    expect(names).toContain('alpha__search');
    expect(names).not.toContain('beta__write');
  });

  it('uses discover-compatible full schemas only in legacy MCP mode', async () => {
    const { service } = createCatalog(true);
    const tools = await service.getAllToolDefinitions('alpha-agent');
    const names = tools.map((tool) => tool.function.name);

    expect(names).toContain('alpha__search');
    expect(names).not.toContain('beta__write');
  });

  it('returns only global handlers for missing or unavailable Agents', async () => {
    const { service } = createCatalog(false);
    const tools = await service.getAllToolDefinitions('disabled-agent');

    expect(tools.map((tool) => tool.function.name)).toEqual(['http_fetch']);
    expect(await service.getAllToolDefinitions('missing')).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: 'http_fetch' }) }),
    ]);
  });

  it('safely returns summaries for registered tools and ignores malformed arguments', () => {
    const { service } = createCatalog(false);
    const call = {
      id: 'catalog-summary',
      type: 'function' as const,
      function: { name: 'http_fetch', arguments: '{}' },
    };

    expect(service.getToolCallSummary(call)).toBe('http_fetch call');
    expect(
      service.getToolCallSummary({
        ...call,
        function: { ...call.function, arguments: '{' },
      }),
    ).toBeUndefined();
    expect(service.getToolResultSummary(call, {})).toBe('http_fetch result');
  });
});
