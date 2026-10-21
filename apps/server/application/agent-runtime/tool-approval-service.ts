import { toolRegistry } from './tooling/tool-registry.js';
import {
  toolApprovalStore,
  type ApprovalAction,
  type PendingToolApproval,
} from './tooling/tool-approval-store.js';
import { toolLoopEngine } from './tool-round-engine.js';
import { runAgentChat } from '../../bootstrap/agent-runtime.js';
import { AccumulatingSink } from '../../infrastructure/transports/sinks.js';
import { persistApprovalContinuation } from './approval-message-persistence.js';
import { v4 as uuidv4 } from 'uuid';
import { ReactEventEmitter } from '../../agent-runtime/react-events.js';
import type { Sink } from '../../agent-runtime/output-sink.js';
import { agentRunRegistry } from '../../agent-runtime/agent-run.js';
import type { AgentRun } from '../../agent-runtime/agent-run.js';
import { subscribeReactEvents } from '../../agent-runtime/react-events.js';
import type { ToolExecutionResult } from '../../agent-runtime/tooling/tool-round-contracts.js';
import type { StreamResult } from '../../types.js';
import {
  createRuntimeContext,
  type SessionRecordingPort,
} from '../../agent-runtime/tooling/runtime-context.js';
import { toStoredSessionMessage } from '../../agent-runtime/session-message-adapter.js';
import { completeRecoveryAction } from './agent-run-recovery-service.js';
class ReactEventSink extends AccumulatingSink {
  readonly events: Record<string, unknown>[] = [];

  override write(data: string): void {
    super.write(data);
    try {
      const event = JSON.parse(data) as Record<string, unknown>;
      this.events.push(event);
    } catch {
      // Non-event output is retained by AccumulatingSink but is not part of the UI event stream.
    }
  }
}

interface ActiveRunApprovalResult {
  status: 'denied' | 'completed' | 'failed';
  toolName: string;
  reason?: string;
  result?: unknown;
  error?: string;
  continuation?: {
    content: string;
    reasoning: string;
    events: Record<string, unknown>[];
  };
}

/** Resubmits a failed approved call to ReAct, disabling tools when its side-effect outcome is unknown. */
async function continueAfterToolFailure(
  request: PendingToolApproval,
  execution: ToolExecutionResult,
  sink: Sink,
  existingRun?: AgentRun,
): Promise<StreamResult | undefined> {
  if (!request.resume) return undefined;
  const continuation = await runAgentChat(
    [...request.resume.messages, execution.assistantMsg, execution.toolMsg],
    request.resume.settings,
    sink,
    request.resume.agent,
    undefined,
    request.conversationId,
    execution.outcomeUnknown ? { maxToolCalls: 0 } : undefined,
    existingRun,
    createApprovalRuntimeContext(request),
  );
  persistApprovalContinuation(request.conversationId, continuation.content, continuation.reasoning);
  return continuation;
}

/**
 * 为审批继续阶段重建携带 Session 记录端口的运行时上下文。
 * @param request 待消费的工具审批请求。
 * @returns 可用的运行时上下文；旧审批没有记录端口时返回 undefined。
 */
function createApprovalRuntimeContext(request: PendingToolApproval) {
  const sessionRecorder = request.resume?.sessionRecorder;
  return sessionRecorder
    ? createRuntimeContext({
        sessionRecorder,
        ...(request.resume?.recoveryActionId
          ? { recoveryActionId: request.resume.recoveryActionId }
          : {}),
      })
    : undefined;
}

/**
 * 将审批后的工具结果写入模型可见历史。
 * @param request 待消费的工具审批请求。
 * @param execution 已完成的工具执行结果。
 * @returns 无返回值。
 */
function recordApprovalToolResult(
  request: PendingToolApproval,
  execution: ToolExecutionResult,
): void {
  const recorder = request.resume?.sessionRecorder;
  if (!recorder) return;
  recorder.recordToolResult({
    callId: request.toolCall.id,
    toolName: request.toolCall.function.name,
    status: execution.outcomeUnknown
      ? 'outcome_unknown'
      : execution.succeeded
        ? 'success'
        : execution.errorCode === 'CANCELLED'
          ? 'cancelled'
          : 'failed',
    message: toStoredSessionMessage(execution.toolMsg),
  });
}

/**
 * 写入运行终态并释放已不再等待审批的会话租约。
 * @param recorder Session 语义事件记录端口。
 * @param run 当前持久 Agent 运行。
 * @returns 无返回值。
 */
function finishApprovalSession(
  recorder: SessionRecordingPort | undefined,
  run: AgentRun,
  recoveryActionId?: string,
): void {
  if (!recorder) return;
  const phase = run.getSnapshot().phase;
  if (phase === 'paused_for_approval') return;
  try {
    if (phase === 'completed' || phase === 'failed' || phase === 'cancelled') {
      recorder.recordRunTerminal(phase);
      if (recoveryActionId) completeRecoveryAction(recoveryActionId);
    } else {
      recorder.recordInterrupted('unknown');
    }
  } finally {
    recorder.close();
  }
}

/** Finds the original paused run only when the approval still belongs to that run and conversation. */
function findPausedRun(request: PendingToolApproval, approvalId: string): AgentRun | undefined {
  const runId = request.resume?.runId;
  if (!runId) return undefined;
  const run = agentRunRegistry.get(runId);
  const snapshot = run?.getSnapshot();
  if (
    !run ||
    snapshot?.conversationId !== request.conversationId ||
    snapshot.phase !== 'paused_for_approval' ||
    snapshot.approval?.approvalId !== approvalId
  )
    return undefined;
  return run;
}

/** Completes an active approval after a tool error, resuming ReAct under the outcome policy. */
async function completeActiveToolFailure(
  request: PendingToolApproval,
  execution: ToolExecutionResult,
  events: ReactEventEmitter,
  round: number,
  sink: Sink,
  run: AgentRun,
  detachSink: () => void,
): Promise<ActiveRunApprovalResult> {
  events.emit({
    type: 'tool_call_error',
    round,
    callId: request.toolCall.id,
    toolName: request.toolCall.function.name,
    error: execution.toolMsg.content,
    retryCount: 0,
    phase: 'final',
    status: 'failed',
  });
  if (request.resume) {
    detachSink();
    const continuation = await continueAfterToolFailure(request, execution, sink, run);
    return {
      status: 'failed',
      toolName: request.toolCall.function.name,
      error: execution.toolMsg.content,
      ...(continuation
        ? {
            continuation: {
              content: continuation.content,
              reasoning: continuation.reasoning,
              events: sink instanceof ReactEventSink ? sink.events : [],
            },
          }
        : {}),
    };
  }
  events.emit({ type: 'run_completed', state: 'completed', content: '', reasoning: '' });
  detachSink();
  sink.end();
  return {
    status: 'failed',
    toolName: request.toolCall.function.name,
    error: execution.toolMsg.content,
  };
}

/** 记录拒绝决定并关闭暂停中的工具调用。 */
function denyActiveApproval(
  request: PendingToolApproval,
  sessionRecorder: SessionRecordingPort | undefined,
  events: ReactEventEmitter,
  round: number,
  sink: Sink,
  run: AgentRun,
  detachSink: () => void,
): ActiveRunApprovalResult {
  sessionRecorder?.recordApproval({
    callId: request.toolCall.id,
    toolName: request.toolCall.function.name,
    status: 'denied',
    reason: request.reason,
  });
  if (sessionRecorder) {
    sessionRecorder.recordToolResult({
      callId: request.toolCall.id,
      toolName: request.toolCall.function.name,
      status: 'failed',
      message: toStoredSessionMessage({
        role: 'tool',
        tool_call_id: request.toolCall.id,
        content: '已拒绝执行',
      }),
    });
  }
  events.emit({
    type: 'tool_call_error',
    round,
    callId: request.toolCall.id,
    toolName: request.toolCall.function.name,
    error: '已拒绝执行',
    retryCount: 0,
    phase: 'final',
    status: 'failed',
  });
  events.emit({ type: 'run_completed', state: 'completed', content: '', reasoning: '' });
  detachSink();
  sink.end();
  return { status: 'denied', toolName: request.toolCall.function.name, reason: request.reason };
}

/** 将已批准但已不存在的工具作为失败结果写回会话。 */
function rejectMissingApprovedTool(
  request: PendingToolApproval,
  sessionRecorder: SessionRecordingPort | undefined,
  events: ReactEventEmitter,
  sink: Sink,
  run: AgentRun,
  detachSink: () => void,
): ActiveRunApprovalResult {
  sessionRecorder?.recordApproval({
    callId: request.toolCall.id,
    toolName: request.toolCall.function.name,
    status: 'approved',
  });
  if (sessionRecorder) {
    sessionRecorder.recordToolResult({
      callId: request.toolCall.id,
      toolName: request.toolCall.function.name,
      status: 'failed',
      message: toStoredSessionMessage({
        role: 'tool',
        tool_call_id: request.toolCall.id,
        content: '工具不存在',
      }),
    });
  }
  events.emit({
    type: 'run_failed',
    state: 'failed',
    error: `Tool not found: ${request.toolCall.function.name}`,
  });
  detachSink();
  sink.end();
  return { status: 'failed', toolName: request.toolCall.function.name, error: 'Tool not found' };
}

/** Continues an approval-linked AgentRun without assigning a new run ID or resetting its sequence. */
async function continueActiveRun(
  request: PendingToolApproval,
  approvalId: string,
  action: ApprovalAction,
  sink: Sink,
): Promise<ActiveRunApprovalResult | undefined> {
  const run = findPausedRun(request, approvalId);
  if (!run) return undefined;
  const detachSink = subscribeReactEvents(run, sink);
  const events = new ReactEventEmitter(run);
  const round = Math.max(1, run.getSnapshot().round);

  if (!run.resumeApproval(approvalId)) {
    detachSink();
    return undefined;
  }

  const sessionRecorder = request.resume?.sessionRecorder;
  try {
    if (action === 'deny')
      return denyActiveApproval(request, sessionRecorder, events, round, sink, run, detachSink);

    const tool = toolRegistry.get(request.toolCall.function.name);
    if (!tool)
      return rejectMissingApprovedTool(request, sessionRecorder, events, sink, run, detachSink);

    sessionRecorder?.recordApproval({
      callId: request.toolCall.id,
      toolName: request.toolCall.function.name,
      status: 'approved',
    });
    const runtimeContext = createApprovalRuntimeContext(request);

    const execution = await toolLoopEngine.executeToolCallWithRetry(
      request.toolCall,
      request.resume?.reasoning,
      request.resume?.settings.toolMaxRetries ?? 0,
      undefined,
      request.conversationId,
      { approvalGranted: true, runId: request.resume?.runId, runtimeContext },
    );
    recordApprovalToolResult(request, execution);

    if (!execution.succeeded) {
      const result = await completeActiveToolFailure(
        request,
        execution,
        events,
        round,
        sink,
        run,
        detachSink,
      );
      return result;
    }

    events.emit({
      type: 'tool_call_end',
      round,
      callId: request.toolCall.id,
      toolName: request.toolCall.function.name,
      result: execution.toolMsg.content,
      duration: 0,
      status: 'success',
    });
    detachSink();

    if (!request.resume) {
      events.emit({ type: 'run_completed', state: 'completed', content: '', reasoning: '' });
      sink.end();
      return {
        status: 'completed',
        toolName: request.toolCall.function.name,
        result: parseToolResult(execution.toolMsg.content),
      };
    }

    const continuation = await runAgentChat(
      [...request.resume.messages, execution.assistantMsg, execution.toolMsg],
      request.resume.settings,
      sink,
      request.resume.agent,
      undefined,
      request.conversationId,
      undefined,
      run,
      runtimeContext,
    );
    persistApprovalContinuation(
      request.conversationId,
      continuation.content,
      continuation.reasoning,
    );

    return {
      status: 'completed',
      toolName: request.toolCall.function.name,
      result: parseToolResult(execution.toolMsg.content),
      continuation: {
        content: continuation.content,
        reasoning: continuation.reasoning,
        events: sink instanceof ReactEventSink ? sink.events : [],
      },
    };
  } finally {
    finishApprovalSession(sessionRecorder, run, request.resume?.recoveryActionId);
  }
}

/**
 * 消费一次工具审批请求，并在批准时重新进入统一 Runtime。
 * @param conversationId 会话 ID
 * @param approvalId 一次性审批 ID
 * @param action 用户选择
 * @returns 审批消费结果
 */
export async function resolveToolApproval(
  conversationId: string,
  approvalId: string,
  action: ApprovalAction,
) {
  const request = toolApprovalStore.consume(conversationId, approvalId, action);
  if (!request) {
    const error = new Error('审批不存在、已过期或已被消费');
    Object.assign(error, { status: 404 });
    throw error;
  }

  const activeSink = new ReactEventSink();
  const activeRunResult = await continueActiveRun(request, approvalId, action, activeSink);
  if (activeRunResult) return { approvalId, ...activeRunResult };
  if (request.resume?.runId) {
    const error = new Error('关联的 AgentRun 已结束或不再等待此审批');
    Object.assign(error, { status: 409 });
    throw error;
  }

  if (action === 'deny') {
    return {
      status: 'denied' as const,
      approvalId,
      toolName: request.toolCall.function.name,
      reason: request.reason,
    };
  }

  const tool = toolRegistry.get(request.toolCall.function.name);
  if (!tool) {
    const error = new Error(`Tool not found: ${request.toolCall.function.name}`);
    Object.assign(error, { status: 404 });
    throw error;
  }

  const execution = await toolLoopEngine.executeToolCallWithRetry(
    request.toolCall,
    request.resume?.reasoning,
    request.resume?.settings.toolMaxRetries ?? 0,
    undefined,
    conversationId,
    { approvalGranted: true, runId: request.resume?.runId ?? uuidv4() },
  );

  const response = {
    status: execution.succeeded ? ('completed' as const) : ('failed' as const),
    approvalId,
    toolName: request.toolCall.function.name,
    result: execution.succeeded ? parseToolResult(execution.toolMsg.content) : undefined,
    error: execution.succeeded ? undefined : execution.toolMsg.content,
  };

  if (!request.resume) return response;

  const continuationSink = new ReactEventSink();
  const continuation = execution.succeeded
    ? await runAgentChat(
        [...request.resume.messages, execution.assistantMsg, execution.toolMsg],
        request.resume.settings,
        continuationSink,
        request.resume.agent,
        undefined,
        conversationId,
      )
    : await continueAfterToolFailure(request, execution, continuationSink);
  if (!continuation) return response;
  if (execution.succeeded) {
    persistApprovalContinuation(conversationId, continuation.content, continuation.reasoning);
  }

  return {
    ...response,
    continuation: {
      content: continuation.content,
      reasoning: continuation.reasoning,
      events: continuationSink.events,
    },
  };
}

/**
 * Consume an approval through the chat SSE channel and resume the interrupted ReAct run.
 * @param conversationId Conversation owning the approval
 * @param approvalId One-time approval identifier
 * @param action User decision
 * @param sink Chat SSE sink
 */
export async function streamToolApproval(
  conversationId: string,
  approvalId: string,
  action: ApprovalAction,
  sink: Sink,
): Promise<void> {
  const request = toolApprovalStore.consume(conversationId, approvalId, action);
  if (!request) {
    sink.write(
      JSON.stringify({
        type: 'run_failed',
        state: 'failed',
        error: '审批不存在、已过期或已被消费',
      }),
    );
    sink.end();
    return;
  }

  const activeRunResult = await continueActiveRun(request, approvalId, action, sink);
  if (activeRunResult) return;
  if (request.resume?.runId) {
    sink.write(
      JSON.stringify({
        type: 'run_failed',
        state: 'failed',
        error: '关联的 AgentRun 已结束或不再等待此审批',
      }),
    );
    sink.end();
    return;
  }

  const runId = uuidv4();
  const events = new ReactEventEmitter(sink, runId);
  if (action === 'deny') {
    events.emit({
      type: 'tool_call_error',
      round: 1,
      callId: request.toolCall.id,
      toolName: request.toolCall.function.name,
      error: '已拒绝执行',
      retryCount: 0,
      phase: 'final',
      status: 'failed',
    });
    events.emit({ type: 'run_completed', state: 'completed', content: '', reasoning: '' });
    sink.end();
    return;
  }

  const execution = await toolLoopEngine.executeToolCallWithRetry(
    request.toolCall,
    request.resume?.reasoning,
    request.resume?.settings.toolMaxRetries ?? 0,
    undefined,
    conversationId,
    { approvalGranted: true, runId },
  );

  if (!execution.succeeded) {
    events.emit({
      type: 'tool_call_error',
      round: 1,
      callId: request.toolCall.id,
      toolName: request.toolCall.function.name,
      error: execution.toolMsg.content,
      retryCount: 0,
      phase: 'final',
      status: 'failed',
    });
    if (!request.resume) {
      events.emit({ type: 'run_completed', state: 'completed', content: '', reasoning: '' });
      sink.end();
      return;
    }
    await continueAfterToolFailure(request, execution, sink);
    return;
  }

  events.emit({
    type: 'tool_call_end',
    round: 1,
    callId: request.toolCall.id,
    toolName: request.toolCall.function.name,
    result: execution.toolMsg.content,
    duration: 0,
    status: 'success',
  });

  if (!request.resume) {
    events.emit({ type: 'run_completed', state: 'completed', content: '', reasoning: '' });
    sink.end();
    return;
  }

  const continuation = await runAgentChat(
    [...request.resume.messages, execution.assistantMsg, execution.toolMsg],
    request.resume.settings,
    sink,
    request.resume.agent,
    undefined,
    conversationId,
  );
  persistApprovalContinuation(conversationId, continuation.content, continuation.reasoning);
}

function parseToolResult(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}
