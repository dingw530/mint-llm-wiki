import { describe, expect, it, vi } from 'vitest';
import { ToolExecutionService } from '../tool-execution-service.js';
import { ToolRegistry } from '../tooling/tool-registry.js';
import { ToolApprovalStore } from '../tooling/tool-approval-store.js';
import type { ToolExecutor } from '../tooling/tool-executor.js';
import { BaseTool } from '../../../agent-runtime/tooling/base-tool.js';
import { z } from 'zod';

class TestTool extends BaseTool<{ value: string }, string> {
  readonly name = 'test_tool';
  readonly description = 'test';
  readonly inputSchema = z.object({ value: z.string() });

  async execute(input: { value: string }): Promise<string> {
    return input.value;
  }
}

describe('ToolExecutionService', () => {
  it('syncs MCP handlers before dispatch and preserves call context', async () => {
    const registry = new ToolRegistry();
    registry.register(new TestTool());
    const approvals = new ToolApprovalStore();
    const events: string[] = [];
    const executor = {
      executeFromToolCall: vi.fn(async (_call, context) => {
        events.push('execute');
        return { success: true, data: context.conversationId, duration: 1 };
      }),
    };
    const service = new ToolExecutionService(
      registry,
      executor as unknown as ToolExecutor,
      approvals,
      () => undefined,
      () => events.push('sync'),
    );
    const toolCall = {
      id: 'call-1',
      type: 'function' as const,
      function: { name: 'test_tool', arguments: '{"value":"ok"}' },
    };

    const result = await service.executeTool(toolCall, 'conversation-1');

    expect(events).toEqual(['sync', 'execute']);
    expect(result).toBe('conversation-1');
    expect(executor.executeFromToolCall).toHaveBeenCalledWith(
      toolCall,
      expect.objectContaining({ conversationId: 'conversation-1' }),
    );
  });

  it('does not dispatch an unknown tool after syncing the MCP catalog', async () => {
    const executor = { executeFromToolCall: vi.fn() };
    const sync = vi.fn();
    const service = new ToolExecutionService(
      new ToolRegistry(),
      executor as unknown as ToolExecutor,
      new ToolApprovalStore(),
      () => undefined,
      sync,
    );
    const toolCall = {
      id: 'unknown-call',
      type: 'function' as const,
      function: { name: 'missing', arguments: '{}' },
    };

    await expect(service.executeTool(toolCall)).resolves.toEqual({ error: '未知工具: missing' });
    expect(sync).toHaveBeenCalledOnce();
    expect(executor.executeFromToolCall).not.toHaveBeenCalled();
  });
});
