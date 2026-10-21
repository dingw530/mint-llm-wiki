import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BaseTool } from '../../../agent-runtime/tooling/base-tool.js';
import { toolRegistry } from '../tooling/tool-registry.js';
import { toolApprovalStore } from '../tooling/tool-approval-store.js';
import { resolveToolApproval } from '../tool-approval-service.js';
import { runAgentChat as reactChat } from '../../../bootstrap/agent-runtime.js';
import * as conversationRepo from '../../../infrastructure/persistence/conversation-repository.js';
import { v4 as uuidv4 } from 'uuid';
import { AgentRun, agentRunRegistry } from '../../../agent-runtime/agent-run.js';
import type { SessionRecordingPort } from '../../../agent-runtime/tooling/runtime-context.js';

vi.mock('../../../bootstrap/agent-runtime.js', () => ({
  runAgentChat: vi.fn(
    async (_messages, _settings, sink, _agent, _signal, _conversationId, _policy, existingRun) => {
      if (existingRun && typeof existingRun.publish === 'function') {
        const detach = existingRun.subscribe((event: Record<string, unknown>) =>
          sink.writeEvent?.(event),
        );
        existingRun.publish({ type: 'answer', content: 'continued answer', round: 2 });
        existingRun.publish({
          type: 'run_completed',
          state: 'completed',
          content: 'continued answer',
          reasoning: '',
        });
        detach();
      } else {
        sink.writeEvent?.({
          type: 'answer',
          runId: 'resume-run',
          sequence: 1,
          content: 'continued answer',
        });
        sink.writeEvent?.({
          type: 'run_completed',
          runId: 'resume-run',
          sequence: 2,
          state: 'completed',
          content: 'continued answer',
          reasoning: '',
        });
      }
      sink.end();
      return { content: 'continued answer', reasoning: '', toolCalls: null };
    },
  ),
}));

class ApprovalServiceTool extends BaseTool<{ value: string }, string> {
  readonly name = 'approval_service_test_tool';
  readonly description = 'approval service test';
  readonly inputSchema = z.object({ value: z.string() });
  execute = vi.fn(async (input: { value: string }) => input.value.toUpperCase());

  getMetadata() {
    return {
      source: 'builtin' as const,
      riskLevel: 'high' as const,
      sideEffect: 'external' as const,
      requiresApproval: true,
    };
  }
}

class SafeFailureApprovalTool extends BaseTool<{ value: string }, string> {
  readonly name = 'safe_failure_approval_tool';
  readonly description = 'approval tool with a known no-side-effect failure';
  readonly inputSchema = z.object({ value: z.string() });
  execute = vi.fn(async () => {
    throw new Error('safe operation failed');
  });

  getMetadata() {
    return {
      source: 'builtin' as const,
      riskLevel: 'high' as const,
      sideEffect: 'none' as const,
      requiresApproval: true,
    };
  }
}

function createSessionRecorder(): SessionRecordingPort {
  return {
    record: vi.fn(() => []),
    recordModelMessage: vi.fn(),
    recordToolCatalog: vi.fn(),
    recordContextSnapshot: vi.fn(),
    recordToolDispatch: vi.fn(),
    recordToolResult: vi.fn(),
    recordApproval: vi.fn(),
    recordRunTerminal: vi.fn(),
    startHeartbeat: vi.fn(),
    pauseForApproval: vi.fn(),
    close: vi.fn(),
  } as unknown as SessionRecordingPort;
}

describe('tool approval service', () => {
  beforeEach(() => {
    agentRunRegistry.clear();
    toolApprovalStore.clear();
    vi.clearAllMocks();
  });

  it('executes an approved request once and rejects replay', async () => {
    const tool = new ApprovalServiceTool();
    toolRegistry.register(tool);
    const conversationId = 'approval-service-conversation';
    const approvalId = toolApprovalStore.create({
      conversationId,
      reason: '需要确认',
      toolCall: {
        id: 'approval-call-1',
        type: 'function',
        function: { name: tool.name, arguments: '{"value":"ok"}' },
      },
    });

    await expect(resolveToolApproval(conversationId, approvalId, 'approve')).resolves.toMatchObject(
      {
        status: 'completed',
        result: 'OK',
      },
    );
    expect(tool.execute).toHaveBeenCalledOnce();
    await expect(resolveToolApproval(conversationId, approvalId, 'approve')).rejects.toThrow(
      '审批不存在',
    );
  });

  it('continues a known no-side-effect approval failure with tools available', async () => {
    const tool = new SafeFailureApprovalTool();
    toolRegistry.register(tool);
    const conversationId = `approval-safe-failure-${uuidv4()}`;
    conversationRepo.create({
      id: conversationId,
      title: 'Approval Safe Failure',
      routingMode: 'manual',
    });
    const approvalId = toolApprovalStore.create({
      conversationId,
      reason: '需要确认',
      toolCall: {
        id: 'approval-safe-failure-call',
        type: 'function',
        function: { name: tool.name, arguments: '{"value":"resume"}' },
      },
      resume: {
        messages: [{ role: 'user', content: 'continue this task' }],
        settings: { apiUrl: 'https://api.test', apiKey: 'test-key', modelId: 'test-model' },
        agent: 'general',
      },
    });

    const result = await resolveToolApproval(conversationId, approvalId, 'approve');
    const call = vi.mocked(reactChat).mock.calls.at(-1);

    expect(result).toMatchObject({
      status: 'failed',
      continuation: { content: 'continued answer' },
    });
    expect(call?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: expect.stringContaining('safe operation failed'),
        }),
      ]),
    );
    expect(call?.[6]).toBeUndefined();
  });

  it('finalizes an unknown approval failure with tools disabled and sanitized error context', async () => {
    const tool = new ApprovalServiceTool();
    tool.execute.mockRejectedValue(new Error('wiki merge failed token=secret-value'));
    toolRegistry.register(tool);
    const conversationId = `approval-unknown-failure-${uuidv4()}`;
    conversationRepo.create({
      id: conversationId,
      title: 'Approval Unknown Failure',
      routingMode: 'manual',
    });
    const approvalId = toolApprovalStore.create({
      conversationId,
      reason: '需要确认',
      toolCall: {
        id: 'approval-unknown-failure-call',
        type: 'function',
        function: { name: tool.name, arguments: '{"value":"resume"}' },
      },
      resume: {
        messages: [{ role: 'user', content: 'continue this task' }],
        settings: { apiUrl: 'https://api.test', apiKey: 'test-key', modelId: 'test-model' },
        agent: 'general',
      },
    });

    const result = await resolveToolApproval(conversationId, approvalId, 'approve');
    const call = vi.mocked(reactChat).mock.calls.at(-1);
    const toolMessage = call?.[0].find((message) => message.role === 'tool');

    expect(result).toMatchObject({
      status: 'failed',
      continuation: { content: 'continued answer' },
    });
    expect(call?.[6]).toEqual({ maxToolCalls: 0 });
    expect(toolMessage?.content).toContain('wiki merge failed');
    expect(toolMessage?.content).toContain('token=[REDACTED]');
    expect(toolMessage?.content).not.toContain('secret-value');
  });

  it('resumes the interrupted model round after approval', async () => {
    const tool = new ApprovalServiceTool();
    toolRegistry.register(tool);
    const conversationId = `approval-resume-conversation-${uuidv4()}`;
    conversationRepo.create({
      id: conversationId,
      title: 'Approval Resume',
      routingMode: 'manual',
    });
    const approvalId = toolApprovalStore.create({
      conversationId,
      reason: '需要确认',
      toolCall: {
        id: 'approval-resume-call',
        type: 'function',
        function: { name: tool.name, arguments: '{"value":"resume"}' },
      },
      resume: {
        messages: [{ role: 'user', content: 'continue this task' }],
        settings: { apiUrl: 'https://api.test', apiKey: 'test-key', modelId: 'test-model' } as any,
        agent: 'general',
        reasoning: 'before approval',
      },
    });

    const result = await resolveToolApproval(conversationId, approvalId, 'approve');

    expect(result).toMatchObject({
      status: 'completed',
      continuation: { content: 'continued answer' },
    });
    expect(result.continuation?.events).toHaveLength(2);
    expect(reactChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        { role: 'user', content: 'continue this task' },
        expect.objectContaining({ role: 'tool', tool_call_id: 'approval-resume-call' }),
      ]),
      expect.objectContaining({ modelId: 'test-model' }),
      expect.anything(),
      'general',
      undefined,
      conversationId,
    );
  });

  it('continues the original AgentRun after approval without resetting its identity or sequence', async () => {
    const tool = new ApprovalServiceTool();
    toolRegistry.register(tool);
    const conversationId = `agent-run-approval-${uuidv4()}`;
    const runId = `original-agent-run-${uuidv4()}`;
    const sessionRecorder = createSessionRecorder();
    conversationRepo.create({
      id: conversationId,
      title: 'AgentRun Approval',
      routingMode: 'manual',
    });
    const approvalId = toolApprovalStore.create({
      conversationId,
      reason: '需要确认',
      toolCall: {
        id: 'agent-run-approval-call',
        type: 'function',
        function: { name: tool.name, arguments: '{"value":"resume"}' },
      },
      resume: {
        runId,
        messages: [{ role: 'user', content: 'continue this task' }],
        settings: { apiUrl: 'https://api.test', apiKey: 'test-key', modelId: 'test-model' },
        agent: 'general',
        sessionRecorder,
      },
    });
    const run = new AgentRun({ runId, conversationId });
    agentRunRegistry.register(run);
    run.publish({ type: 'run_started', state: 'running' });
    run.publish({
      type: 'tool_call_start',
      state: 'executing_tools',
      round: 1,
      callId: 'agent-run-approval-call',
      toolName: tool.name,
      arguments: { value: 'resume' },
    });
    run.publish({
      type: 'approval_required',
      round: 1,
      callId: 'agent-run-approval-call',
      toolName: tool.name,
      approvalId,
      reason: '需要确认',
    });

    const result = await resolveToolApproval(conversationId, approvalId, 'approve');

    expect(result.continuation?.events.map((event) => event.runId)).toEqual([runId, runId, runId]);
    expect(result.continuation?.events.map((event) => event.sequence)).toEqual([4, 5, 6]);
    expect(reactChat).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.any(Object),
      expect.anything(),
      'general',
      undefined,
      conversationId,
      undefined,
      run,
      expect.objectContaining({ sessionRecorder }),
    );
    expect(sessionRecorder.recordApproval).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'agent-run-approval-call', status: 'approved' }),
    );
    expect(sessionRecorder.recordToolDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'agent-run-approval-call' }),
    );
    expect(sessionRecorder.recordToolResult).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'agent-run-approval-call', status: 'success' }),
    );
    expect(sessionRecorder.recordRunTerminal).toHaveBeenCalledWith('completed');
    expect(sessionRecorder.close).toHaveBeenCalledOnce();
    expect(agentRunRegistry.get(runId)).toBeUndefined();
  });

  it('continues an active run after unknown approval failure with tools disabled', async () => {
    const tool = new ApprovalServiceTool();
    tool.execute.mockRejectedValue(new Error('wiki merge failed token=secret-value'));
    toolRegistry.register(tool);
    const conversationId = `agent-run-approval-failure-${uuidv4()}`;
    const runId = `original-failed-approval-run-${uuidv4()}`;
    conversationRepo.create({
      id: conversationId,
      title: 'AgentRun Approval Failure',
      routingMode: 'manual',
    });
    const approvalId = toolApprovalStore.create({
      conversationId,
      reason: '需要确认',
      toolCall: {
        id: 'agent-run-failed-approval-call',
        type: 'function',
        function: { name: tool.name, arguments: '{"value":"resume"}' },
      },
      resume: {
        runId,
        messages: [{ role: 'user', content: 'continue this task' }],
        settings: { apiUrl: 'https://api.test', apiKey: 'test-key', modelId: 'test-model' },
        agent: 'general',
      },
    });
    const run = new AgentRun({ runId, conversationId });
    agentRunRegistry.register(run);
    run.publish({ type: 'run_started', state: 'running' });
    run.publish({
      type: 'tool_call_start',
      state: 'executing_tools',
      round: 1,
      callId: 'agent-run-failed-approval-call',
      toolName: tool.name,
      arguments: { value: 'resume' },
    });
    run.publish({
      type: 'approval_required',
      round: 1,
      callId: 'agent-run-failed-approval-call',
      toolName: tool.name,
      approvalId,
      reason: '需要确认',
    });

    const result = await resolveToolApproval(conversationId, approvalId, 'approve');
    const call = vi.mocked(reactChat).mock.calls.at(-1);

    expect(result).toMatchObject({
      status: 'failed',
      continuation: { content: 'continued answer' },
    });
    expect(call?.[6]).toEqual({ maxToolCalls: 0 });
    expect(call?.[7]).toBe(run);
    expect(call?.[0]).toContainEqual(
      expect.objectContaining({
        role: 'tool',
        content: expect.stringContaining('wiki merge failed'),
      }),
    );
  });

  it('ends the original AgentRun when approval is denied without executing the tool', async () => {
    const tool = new ApprovalServiceTool();
    toolRegistry.register(tool);
    const conversationId = `agent-run-denial-${uuidv4()}`;
    conversationRepo.create({
      id: conversationId,
      title: 'AgentRun Denial',
      routingMode: 'manual',
    });
    const approvalId = toolApprovalStore.create({
      conversationId,
      reason: '需要确认',
      toolCall: {
        id: 'agent-run-denial-call',
        type: 'function',
        function: { name: tool.name, arguments: '{"value":"deny"}' },
      },
      resume: {
        runId: 'denied-agent-run',
        messages: [{ role: 'user', content: 'do not execute this task' }],
        settings: { apiUrl: 'https://api.test', apiKey: 'test-key', modelId: 'test-model' },
        agent: 'general',
      },
    });
    const run = new AgentRun({ runId: 'denied-agent-run', conversationId });
    const events: Array<{ type: string; sequence: number }> = [];
    agentRunRegistry.register(run);
    run.subscribe((event) => events.push({ type: event.type, sequence: event.sequence }));
    run.publish({ type: 'run_started', state: 'running' });
    run.publish({
      type: 'tool_call_start',
      state: 'executing_tools',
      round: 1,
      callId: 'agent-run-denial-call',
      toolName: tool.name,
      arguments: { value: 'deny' },
    });
    run.publish({
      type: 'approval_required',
      round: 1,
      callId: 'agent-run-denial-call',
      toolName: tool.name,
      approvalId,
      reason: '需要确认',
    });

    await expect(resolveToolApproval(conversationId, approvalId, 'deny')).resolves.toMatchObject({
      status: 'denied',
      toolName: tool.name,
    });

    expect(tool.execute).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'run_started', sequence: 1 },
      { type: 'tool_call_start', sequence: 2 },
      { type: 'approval_required', sequence: 3 },
      { type: 'tool_call_error', sequence: 4 },
      { type: 'run_completed', sequence: 5 },
    ]);
    expect(agentRunRegistry.get('denied-agent-run')).toBeUndefined();
  });
});
