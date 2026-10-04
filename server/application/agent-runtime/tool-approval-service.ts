import { toolApprovalStore, toolRegistry } from '../../services/tools/index.js';
import type { ApprovalAction } from '../../services/tools/approvalStore.js';
import { toolLoopEngine } from '../../services/toolRoundEngine.js';
import { runAgentChat } from '../../bootstrap/agent-runtime.js';
import { AccumulatingSink } from '../../infrastructure/transports/sinks.js';
import { persistApprovalContinuation } from './approval-message-persistence.js';
import { v4 as uuidv4 } from 'uuid';
import { ReactEventEmitter } from '../../agent-runtime/react-events.js';
import type { Sink } from '../../agent-runtime/output-sink.js';
import { agentRunRegistry } from '../../agent-runtime/agent-run.js';
import type { AgentRun } from '../../agent-runtime/agent-run.js';
import { subscribeReactEvents } from '../../agent-runtime/react-events.js';
import type { PendingToolApproval } from '../../services/tools/approvalStore.js';

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

  if (action === 'deny') {
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

  const tool = toolRegistry.get(request.toolCall.function.name);
  if (!tool) {
    events.emit({
      type: 'run_failed',
      state: 'failed',
      error: `Tool not found: ${request.toolCall.function.name}`,
    });
    detachSink();
    sink.end();
    return { status: 'failed', toolName: request.toolCall.function.name, error: 'Tool not found' };
  }

  const execution = await toolLoopEngine.executeToolCallWithRetry(
    request.toolCall,
    request.resume?.reasoning,
    request.resume?.settings.toolMaxRetries ?? 0,
    undefined,
    request.conversationId,
    { approvalGranted: true },
  );

  if (!execution.succeeded) {
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
    events.emit({ type: 'run_completed', state: 'completed', content: '', reasoning: '' });
    detachSink();
    sink.end();
    return {
      status: 'failed',
      toolName: request.toolCall.function.name,
      error: execution.toolMsg.content,
    };
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
  );
  persistApprovalContinuation(request.conversationId, continuation.content, continuation.reasoning);

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
    { approvalGranted: true },
  );

  const response = {
    status: execution.succeeded ? ('completed' as const) : ('failed' as const),
    approvalId,
    toolName: request.toolCall.function.name,
    result: execution.succeeded ? parseToolResult(execution.toolMsg.content) : undefined,
    error: execution.succeeded ? undefined : execution.toolMsg.content,
  };

  if (!request.resume || !execution.succeeded) return response;

  const sink = new ReactEventSink();
  const continuation = await runAgentChat(
    [...request.resume.messages, execution.assistantMsg, execution.toolMsg],
    request.resume.settings,
    sink,
    request.resume.agent,
    undefined,
    conversationId,
  );

  persistApprovalContinuation(conversationId, continuation.content, continuation.reasoning);

  return {
    ...response,
    continuation: {
      content: continuation.content,
      reasoning: continuation.reasoning,
      events: sink.events,
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

  const tool = toolRegistry.get(request.toolCall.function.name);
  if (!tool) {
    events.emit({
      type: 'run_failed',
      state: 'failed',
      error: `Tool not found: ${request.toolCall.function.name}`,
    });
    sink.end();
    return;
  }

  const execution = await toolLoopEngine.executeToolCallWithRetry(
    request.toolCall,
    request.resume?.reasoning,
    request.resume?.settings.toolMaxRetries ?? 0,
    undefined,
    conversationId,
    { approvalGranted: true },
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
    events.emit({ type: 'run_completed', state: 'completed', content: '', reasoning: '' });
    sink.end();
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
