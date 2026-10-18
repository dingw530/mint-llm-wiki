import { describe, expect, it, vi } from 'vitest';
import { createChatStreamCallbacks, createToolApprovalCallbacks } from '../chatStreamCallbacks';
import type { Message } from '@/types';

function createOptions() {
  return {
    tempId: 'assistant-1',
    isAutoRoute: true,
    streamBufferRef: { current: { id: 'assistant-1', content: '' } },
    flushStream: vi.fn(),
    scheduleFlush: vi.fn(),
    finishStream: vi.fn(),
    updateTempMessage: vi.fn(),
    setActiveAgent: vi.fn(),
    setAutoRoutedAgent: vi.fn(),
    setAgentRunStatus: vi.fn(),
    dispatchReactEvent: vi.fn(),
  };
}

describe('createChatStreamCallbacks', () => {
  it('runs completion work after the stream is finished', () => {
    const options = createOptions();
    const onCompleted = vi.fn();
    const callbacks = createChatStreamCallbacks({ ...options, onCompleted });

    callbacks.onDone?.();

    expect(options.finishStream).toHaveBeenCalledWith('assistant-1');
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(options.finishStream.mock.invocationCallOrder[0]).toBeLessThan(
      onCompleted.mock.invocationCallOrder[0],
    );
  });

  it('associates the current run with the temporary assistant message', () => {
    const options = createOptions();
    const callbacks = createChatStreamCallbacks(options);

    callbacks.onRunStarted?.({ type: 'run_started', runId: 'run-1' });

    expect(options.updateTempMessage).toHaveBeenCalledWith('assistant-1', expect.any(Function));
    const update = options.updateTempMessage.mock.calls[0][1] as (message: { content: string }) => {
      runId?: string;
    };
    expect(update({ content: '' })).toEqual({ content: '', runId: 'run-1' });
  });

  it('flushes text before inserting an A2UI segment', () => {
    const options = createOptions();
    const callbacks = createChatStreamCallbacks(options);
    callbacks.onChunk?.('before');
    callbacks.onA2ui?.({
      type: 'a2ui',
      segmentId: 'segment-1',
      message: { version: 'v0.9', createSurface: { surfaceId: 'surface-1', catalogId: 'mint' } },
    });

    expect(options.flushStream).toHaveBeenCalledOnce();
    expect(options.updateTempMessage).toHaveBeenCalledOnce();
  });

  it('does not associate another resumed tool call error with the approved call', () => {
    const originalMessage: Message = {
      id: 'message-1',
      conversationId: 'conversation-1',
      role: 'assistant',
      createdAt: '2026-10-18T00:00:00.000Z',
      content: '',
      segments: [
        {
          type: 'tool_call',
          callId: 'approved-call',
          toolName: 'write_file',
          status: 'done',
          approvalId: 'approval-1',
          result: 'saved',
        },
      ],
    };
    let updatedMessage: Message | undefined;
    const callbacks = createToolApprovalCallbacks(
      'approval-1',
      (update) => {
        updatedMessage = update(originalMessage);
      },
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );

    callbacks.onToolCallError?.({
      callId: 'next-call',
      toolName: 'write_file',
      error: '工具元数据要求审批',
    });

    expect(updatedMessage?.segments).toEqual(originalMessage.segments);
  });

  it('associates resumed tool call errors with the exact callId', () => {
    const originalMessage: Message = {
      id: 'message-1',
      conversationId: 'conversation-1',
      role: 'assistant',
      createdAt: '2026-10-18T00:00:00.000Z',
      content: '',
      segments: [
        {
          type: 'tool_call',
          callId: 'approved-call',
          toolName: 'write_file',
          status: 'done',
          approvalId: 'approval-1',
          result: 'saved',
        },
      ],
    };
    let updatedMessage: Message | undefined;
    const callbacks = createToolApprovalCallbacks(
      'approval-1',
      (update) => {
        updatedMessage = update(originalMessage);
      },
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );

    callbacks.onToolCallError?.({
      callId: 'approved-call',
      toolName: 'write_file',
      error: '执行失败',
    });

    expect(updatedMessage?.segments).toEqual([
      {
        ...originalMessage.segments?.[0],
        status: 'error',
        error: '执行失败',
      },
    ]);
  });

  it('does not associate another resumed tool call result with the approved call', () => {
    const originalMessage: Message = {
      id: 'message-1',
      conversationId: 'conversation-1',
      role: 'assistant',
      createdAt: '2026-10-18T00:00:00.000Z',
      content: '',
      segments: [
        {
          type: 'tool_call',
          callId: 'approved-call',
          toolName: 'write_file',
          status: 'done',
          approvalId: 'approval-1',
          result: 'saved',
        },
      ],
    };
    let updatedMessage: Message | undefined;
    const callbacks = createToolApprovalCallbacks(
      'approval-1',
      (update) => {
        updatedMessage = update(originalMessage);
      },
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );

    callbacks.onToolCallEnd?.({
      callId: 'next-call',
      toolName: 'write_file',
      result: 'different result',
    });

    expect(updatedMessage?.segments).toEqual(originalMessage.segments);
  });

  it('keeps a follow-up approval attached to its own callId', () => {
    let updatedMessage: Message = {
      id: 'message-1',
      conversationId: 'conversation-1',
      role: 'assistant',
      createdAt: '2026-10-18T00:00:00.000Z',
      content: '',
      segments: [
        {
          type: 'tool_call',
          callId: 'approved-call',
          toolName: 'write_file',
          status: 'done',
          approvalId: 'approval-1',
          result: 'saved',
        },
      ],
    };
    const callbacks = createToolApprovalCallbacks(
      'approval-1',
      (update) => {
        updatedMessage = update(updatedMessage);
      },
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );

    callbacks.onToolCallStart?.({
      callId: 'next-call',
      toolName: 'write_file',
      arguments: { path: 'pages/next.md' },
    });
    callbacks.onToolApprovalRequired?.({
      callId: 'next-call',
      toolName: 'write_file',
      approvalId: 'approval-2',
      reason: 'requires another approval',
    });
    callbacks.onToolCallError?.({
      callId: 'next-call',
      toolName: 'write_file',
      error: 'requires another approval',
      status: 'approval_required',
    });

    expect(updatedMessage.segments).toEqual([
      {
        type: 'tool_call',
        callId: 'approved-call',
        toolName: 'write_file',
        status: 'done',
        approvalId: 'approval-1',
        result: 'saved',
      },
      {
        type: 'tool_call',
        callId: 'next-call',
        toolName: 'write_file',
        summary: undefined,
        status: 'approval_required',
        arguments: { path: 'pages/next.md' },
        approvalId: 'approval-2',
        approvalReason: 'requires another approval',
      },
    ]);
  });
});
