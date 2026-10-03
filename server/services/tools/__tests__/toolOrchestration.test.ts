import { describe, expect, it, vi, beforeEach } from 'vitest';

// Must mock before importing
vi.mock('../../../domains/agents/index.js', () => ({
  findById: vi.fn(),
}));

vi.mock('../../api/mcpService.js', () => ({
  mcpService: {
    getTools: vi.fn().mockResolvedValue([]),
    callTool: vi.fn(),
  },
}));

vi.mock('../index.js', () => {
  // Simulate the tool registry with a few tools
  const toolMap = new Map<string, any>();
  const fetchTool = {
    name: 'http_fetch',
    isEnabled: () => true,
    getDefinition: () => ({
      type: 'function',
      function: { name: 'http_fetch', description: 'HTTP fetch', parameters: {} },
    }),
  };
  toolMap.set('http_fetch', fetchTool);

  return {
    toolRegistry: {
      has: (name: string) => toolMap.has(name),
      get: (name: string) => toolMap.get(name),
      getCallSummary: (name: string, input: unknown) => toolMap.get(name)?.getCallSummary?.(input),
      getResultSummary: (name: string, result: unknown) =>
        toolMap.get(name)?.getResultSummary?.(result),
      getAllEnabled: () => Array.from(toolMap.values()),
    },
    toolExecutor: {
      executeFromToolCall: vi.fn().mockResolvedValue({ success: true, data: 'done' }),
    },
    toolApprovalStore: {
      isGranted: vi.fn().mockReturnValue(false),
      create: vi.fn().mockReturnValue('approval-test-id'),
    },
    initializeTools: vi.fn(),
  };
});

import * as agentRepo from '../../../domains/agents/index.js';
import { mcpService } from '../../api/mcpService.js';
import { toolExecutor } from '../index.js';

const { getAllToolDefinitions, executeTool, getToolCallSummary, getToolResultSummary } =
  await import('../../toolOrchestration.js');

describe('toolRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAllToolDefinitions', () => {
    it('returns global tools for general agent', async () => {
      vi.mocked(mcpService.getTools).mockResolvedValue([
        {
          type: 'function',
          function: {
            name: 'remote__search',
            description: 'Search remotely',
            parameters: {},
          },
        },
      ]);
      const tools = await getAllToolDefinitions('general');
      expect(tools.length).toBeGreaterThan(0);
      const names = tools.map((t) => t.function.name);
      expect(names).toContain('http_fetch');
      expect(names).not.toContain('remote__search');
    });

    it('returns global tools when no agent id', async () => {
      const tools = await getAllToolDefinitions();
      const names = tools.map((t) => t.function.name);
      expect(names).toContain('http_fetch');
    });

    it('loads MCP tools for custom agent', async () => {
      vi.mocked(agentRepo.findById).mockReturnValue({
        id: 'custom-agent',
        name: 'Custom',
        description: 'A custom agent',
        type: 'custom',
        systemPrompt: 'helpful',
        mcpServerIds: ['my-tools'],
        available: true,
        errorMessage: null,
        triggerKeywords: [],
        createdAt: '',
        updatedAt: '',
      });

      vi.mocked(mcpService.getTools).mockResolvedValue([
        {
          type: 'function',
          function: {
            name: 'my-tools__read_file',
            description: 'Read a file',
            parameters: {},
          },
        },
      ]);

      const tools = await getAllToolDefinitions('custom-agent');
      const names = tools.map((t) => t.function.name);
      expect(names).not.toContain('my-tools__read_file');
    });

    it('returns global tools when custom agent not found', async () => {
      vi.mocked(agentRepo.findById).mockReturnValue(null);
      const tools = await getAllToolDefinitions('nonexistent');
      const names = tools.map((t) => t.function.name);
    });
  });

  describe('executeTool', () => {
    it('executes builtin tools', async () => {
      const result = await executeTool(
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'http_fetch', arguments: '{"url":"https://example.com"}' },
        },
        'conv-1',
      );
      expect(result).toBe('done');
      expect(toolExecutor.executeFromToolCall).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'call-1' }),
        expect.objectContaining({
          conversationId: 'conv-1',
          requestApproval: expect.any(Function),
        }),
      );
    });

    it('handles unknown tools', async () => {
      const result = await executeTool({
        id: 'call-2',
        type: 'function',
        function: { name: 'unknown_tool', arguments: '{}' },
      });
      expect(result).toHaveProperty('error');
      expect((result as any).error).toContain('未知工具');
    });

    it('does not execute an unloaded MCP tool outside the Runtime', async () => {
      vi.mocked(mcpService.callTool).mockResolvedValue('mcp result');
      const result = await executeTool({
        id: 'call-3',
        type: 'function',
        function: { name: 'fileserver__list', arguments: '{}' },
      });
      expect(result).toEqual({ error: '未知工具: fileserver__list' });
    });

    it('returns a structured unknown-tool error for unloaded MCP tools', async () => {
      vi.mocked(mcpService.callTool).mockRejectedValue(new Error('connection failed'));
      const result = await executeTool({
        id: 'call-4',
        type: 'function',
        function: { name: 'fileserver__list', arguments: '{}' },
      });
      expect((result as any).error).toContain('未知工具');
    });
  });

  describe('summary', () => {
    const unknownCall = {
      id: 'summary-call',
      type: 'function' as const,
      function: { name: 'missing', arguments: '{}' },
    };

    it('returns undefined for unknown tools and invalid arguments', () => {
      expect(getToolCallSummary(unknownCall)).toBeUndefined();
      expect(
        getToolCallSummary({
          ...unknownCall,
          function: { ...unknownCall.function, arguments: '{' },
        }),
      ).toBeUndefined();
      expect(getToolResultSummary(unknownCall, {})).toBeUndefined();
    });
  });
});
