import { describe, expect, it, vi } from 'vitest';
import { ToolExecutionService } from '../tool-execution-service.js';
import { ToolRegistry } from '../tooling/tool-registry.js';
import { ToolApprovalStore } from '../tooling/tool-approval-store.js';
import type { ToolExecutor } from '../tooling/tool-executor.js';
import { BaseTool } from '../../../agent-runtime/tooling/base-tool.js';
import { z } from 'zod';
import { getMintWorkspacePath } from '../../../infrastructure/filesystem/mint-workspace.js';

class TestTool extends BaseTool<{ value: string }, string> {
  readonly name: string = 'test_tool';
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
    const auditSink = { record: vi.fn() };
    const service = new ToolExecutionService(
      new ToolRegistry(),
      executor as unknown as ToolExecutor,
      new ToolApprovalStore(),
      () => undefined,
      sync,
      undefined,
      auditSink,
    );
    const toolCall = {
      id: 'unknown-call',
      type: 'function' as const,
      function: { name: 'missing', arguments: '{}' },
    };

    await expect(service.executeTool(toolCall)).resolves.toEqual({
      error: '未知工具: missing',
      errorCode: 'UNKNOWN_TOOL',
      retryable: false,
    });
    expect(sync).toHaveBeenCalledOnce();
    expect(executor.executeFromToolCall).not.toHaveBeenCalled();
    expect(auditSink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'failed',
        invocationId: expect.any(String),
        callId: 'unknown-call',
        errorCode: 'UNKNOWN_TOOL',
      }),
    );
  });

  it('injects the allowed workspace into Bash policy context', async () => {
    const registry = new ToolRegistry();
    registry.register(
      new (class extends TestTool {
        override readonly name = 'bash';
      })(),
    );
    const executor = {
      executeFromToolCall: vi.fn().mockResolvedValue({ success: true, data: {}, duration: 1 }),
    };
    const service = new ToolExecutionService(
      registry,
      executor as unknown as ToolExecutor,
      new ToolApprovalStore(),
    );
    await service.executeTool(
      {
        id: 'bash-call',
        type: 'function',
        function: { name: 'bash', arguments: '{"command":"ls"}' },
      },
      'conversation-bash',
    );

    expect(executor.executeFromToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ function: expect.objectContaining({ name: 'bash' }) }),
      expect.objectContaining({ allowedWorkingDirectory: getMintWorkspacePath() }),
    );
  });
});
