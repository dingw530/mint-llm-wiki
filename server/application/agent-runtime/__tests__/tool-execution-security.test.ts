import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BaseTool } from '../../../agent-runtime/tooling/base-tool.js';
import { ToolExecutor } from '../../../application/agent-runtime/tooling/tool-executor.js';
import { ToolRegistry } from '../../../application/agent-runtime/tooling/tool-registry.js';
import { evaluateToolPolicy } from '../../../application/agent-runtime/tooling/tool-policy.js';
import { ToolApprovalStore } from '../../../application/agent-runtime/tooling/tool-approval-store.js';
import { getMintWorkspacePath } from '../../../infrastructure/filesystem/mint-workspace.js';

const context = { conversationId: 'security-test' };

class SideEffectTool extends BaseTool<{ value: string }, string> {
  readonly name = 'side_effect';
  readonly description = 'test side effect';
  readonly inputSchema = z.object({ value: z.string() });
  getMetadata() {
    return {
      source: 'builtin' as const,
      riskLevel: 'high' as const,
      sideEffect: 'external' as const,
      requiresApproval: true,
    };
  }
  execute = vi.fn(async (input: { value: string }) => input.value);
}

class SlowTool extends BaseTool<Record<string, never>, string> {
  readonly name = 'slow';
  readonly description = 'test timeout';
  readonly inputSchema = z.object({});
  readonly executionTimeoutMs = 10;
  async execute(): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return 'done';
  }
}

describe('tool runtime security policy', () => {
  it('denies private and unsupported HTTP targets', () => {
    expect(
      evaluateToolPolicy({
        toolName: 'http_fetch',
        metadata: { source: 'builtin', riskLevel: 'medium', sideEffect: 'network' },
        input: { url: 'http://127.0.0.1:3000' },
        context,
      }),
    ).toEqual({ action: 'deny', reason: expect.stringContaining('禁止访问') });
    expect(
      evaluateToolPolicy({
        toolName: 'http_fetch',
        metadata: { source: 'builtin', riskLevel: 'medium', sideEffect: 'network' },
        input: { url: 'file:///tmp/a' },
        context,
      }).action,
    ).toBe('deny');
  });

  it('requires approval for writes and denies Bash directory escape', () => {
    expect(
      evaluateToolPolicy({
        toolName: 'http_fetch',
        metadata: { source: 'builtin', riskLevel: 'medium', sideEffect: 'network' },
        input: { url: 'https://example.com', method: 'POST' },
        context,
      }).action,
    ).toBe('approval_required');
    expect(
      evaluateToolPolicy({
        toolName: 'bash',
        metadata: { source: 'builtin', riskLevel: 'medium', sideEffect: 'filesystem' },
        input: { command: 'cat /etc/hosts', cwd: '/tmp' },
        context: { ...context, allowedWorkingDirectory: '/tmp/project' },
      }).action,
    ).toBe('deny');
  });

  it('allows unrestricted Bash commands in the default Mint workspace', () => {
    expect(
      evaluateToolPolicy({
        toolName: 'bash',
        metadata: { source: 'builtin', riskLevel: 'medium', sideEffect: 'filesystem' },
        input: { command: 'rm -rf ./build-cache', cwd: getMintWorkspacePath() },
        context,
      }),
    ).toEqual({ action: 'allow' });
    expect(
      evaluateToolPolicy({
        toolName: 'bash',
        metadata: { source: 'builtin', riskLevel: 'medium', sideEffect: 'filesystem' },
        input: { command: 'ls /tmp', cwd: getMintWorkspacePath() },
        context,
      }).action,
    ).toBe('deny');
  });

  it('does not execute a denied or unapproved tool and emits audit events', async () => {
    const tool = new SideEffectTool();
    const registry = new ToolRegistry();
    registry.register(tool);
    const executor = new ToolExecutor(registry);
    const audit = vi.fn();
    const denied = await executor.execute('side_effect', { value: 'x' }, { ...context, audit });
    expect(denied.success).toBe(false);
    expect(denied.error).toContain('Approval required');
    expect(tool.execute).not.toHaveBeenCalled();
    const result = await executor.execute(
      'side_effect',
      { value: 'x' },
      { ...context, audit, approvalGranted: true },
    );
    expect(result.success).toBe(true);
    expect(tool.execute).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'approval_required', toolName: 'side_effect' }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'completed', toolName: 'side_effect' }),
    );
  });

  it('returns a structured approval request and consumes it once', async () => {
    const tool = new SideEffectTool();
    const registry = new ToolRegistry();
    registry.register(tool);
    const approvalStore = new ToolApprovalStore();
    const result = await new ToolExecutor(registry).execute(
      'side_effect',
      { value: 'x' },
      {
        ...context,
        requestApproval: ({ reason }) =>
          approvalStore.create({
            conversationId: context.conversationId,
            toolCall: {
              id: 'call-1',
              type: 'function',
              function: { name: 'side_effect', arguments: '{"value":"x"}' },
            },
            reason,
          }),
      },
    );

    expect(result.success).toBe(false);
    expect(result.approvalRequired?.approvalId).toBeTruthy();
    const approvalId = result.approvalRequired!.approvalId!;
    expect(approvalStore.consume(context.conversationId, approvalId, 'approve')).toMatchObject({
      reason: expect.any(String),
    });
    expect(approvalStore.consume(context.conversationId, approvalId, 'approve')).toBeUndefined();
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('keeps an approved Bash directory grant within the same conversation', () => {
    const approvalStore = new ToolApprovalStore();
    const conversationId = 'directory-grant-test';
    const approvalId = approvalStore.create({
      conversationId,
      reason: '需要确认',
      scopePath: '/Users/wangding/WorkSpace/personal/ai-chat',
      toolCall: {
        id: 'directory-grant-call',
        type: 'function',
        function: {
          name: 'bash',
          arguments: '{"command":"ls -la /Users/wangding/WorkSpace/personal/ai-chat"}',
        },
      },
    });

    approvalStore.consume(conversationId, approvalId, 'approve');

    expect(
      approvalStore.isGranted(conversationId, {
        id: 'child-call',
        type: 'function',
        function: { name: 'bash', arguments: '{"command":"ls client/src"}' },
      }),
    ).toBe(false);
    expect(
      approvalStore.isGranted(conversationId, {
        id: 'child-call-absolute',
        type: 'function',
        function: {
          name: 'bash',
          arguments: '{"command":"ls -la /Users/wangding/WorkSpace/personal/ai-chat/client/src"}',
        },
      }),
    ).toBe(true);
    expect(
      approvalStore.isGranted('other-conversation', {
        id: 'other-call',
        type: 'function',
        function: {
          name: 'bash',
          arguments: '{"command":"ls -la /Users/wangding/WorkSpace/personal/ai-chat/client/src"}',
        },
      }),
    ).toBe(false);
  });

  it('reports timeout and passes cancellation to the tool', async () => {
    const registry = new ToolRegistry();
    registry.register(new SlowTool());
    const audit = vi.fn();
    const result = await new ToolExecutor(registry).execute('slow', {}, { ...context, audit });
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'timed_out' }));
  });
});
