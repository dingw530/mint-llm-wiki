import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Message, SendCallbacks } from '@/types';
import { parseAgentRunStatusData } from '../components/AgentRunStatus';
import type { AgentRunStatusData } from '../components/AgentRunStatus';
import type { ReactReducerEvent } from './useReactEventReducer';

interface StreamCallbackOptions {
  tempId: string;
  isAutoRoute: boolean;
  streamBufferRef: MutableRefObject<{ id: string; content: string }>;
  flushStream: () => void;
  scheduleFlush: () => void;
  finishStream: (tempId: string, error?: Error) => void;
  onCompleted?: () => void;
  updateTempMessage: (tempId: string, update: (message: Message) => Message) => void;
  setActiveAgent: (agentId: string) => void;
  setAutoRoutedAgent: (agentId: string) => void;
  setAgentRunStatus: Dispatch<SetStateAction<AgentRunStatusData | null>>;
  dispatchReactEvent: (event: ReactReducerEvent) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** 为普通对话运行构造统一的 SSE 回调。 */
export function createChatStreamCallbacks({
  tempId,
  isAutoRoute,
  streamBufferRef,
  flushStream,
  scheduleFlush,
  finishStream,
  onCompleted,
  updateTempMessage,
  setActiveAgent,
  setAutoRoutedAgent,
  setAgentRunStatus,
  dispatchReactEvent,
}: StreamCallbackOptions): SendCallbacks {
  return {
    onRunStarted: (data) => {
      dispatchReactEvent({ type: 'run_started', ...data });
      const runId = data.runId;
      if (typeof runId !== 'string' || !runId) return;
      updateTempMessage(tempId, (message) => ({ ...message, runId }));
    },
    onRoundStarted: (data) => dispatchReactEvent({ type: 'round_started', ...data }),
    onAgentStatus: (data) => {
      const status = parseAgentRunStatusData(data);
      if (status) setAgentRunStatus(status);
    },
    onLoopDetected: (data) => dispatchReactEvent({ type: 'loop_detected', ...data }),
    onRunCompleted: (data) => {
      dispatchReactEvent({ type: 'run_completed', ...data });
      const totalTokens = Number(data.totalTokens);
      const inputTokens = Number(data.inputTokens);
      const outputTokens = Number(data.outputTokens);
      if ([totalTokens, inputTokens, outputTokens].every(Number.isFinite))
        updateTempMessage(tempId, (message) => ({
          ...message,
          tokenUsage: { totalTokens, inputTokens, outputTokens },
          estimatedTokens: undefined,
        }));
    },
    onRunCancelled: (data) => {
      dispatchReactEvent({ type: 'run_cancelled', ...data });
      setAgentRunStatus((previous) => (previous ? { ...previous, phase: 'cancelled' } : previous));
    },
    onTokenUsage: (data) => {
      const estimatedTokens = Number(data.estimatedTokens);
      if (Number.isFinite(estimatedTokens))
        updateTempMessage(tempId, (message) => ({ ...message, estimatedTokens }));
    },
    onChunk: (content) => {
      streamBufferRef.current.content += content;
      scheduleFlush();
    },
    onA2ui: (data) => {
      const segmentId = typeof data.segmentId === 'string' ? data.segmentId : '';
      const message = data.message;
      if (!segmentId || !isRecord(message)) return;
      flushStream();
      updateTempMessage(tempId, (current) => {
        const segments = [...(current.segments || [])];
        const existing = segments.find(
          (segment) => segment.type === 'a2ui' && segment.segmentId === segmentId,
        );
        if (existing && existing.type === 'a2ui') {
          return {
            ...current,
            segments: segments.map((segment) =>
              segment.type === 'a2ui' && segment.segmentId === segmentId
                ? { ...segment, messages: [...segment.messages, message] }
                : segment,
            ),
          };
        } else {
          segments.push({ type: 'a2ui', segmentId, messages: [message] });
        }
        return { ...current, segments };
      });
    },
    onReasoning: (content) =>
      updateTempMessage(tempId, (message) => {
        const segments = [...(message.segments || [])];
        const last = segments[segments.length - 1];
        if (last?.type === 'thinking')
          segments[segments.length - 1] = { ...last, content: last.content + content };
        else segments.push({ type: 'thinking', content });
        return { ...message, reasoning: `${message.reasoning || ''}${content}`, segments };
      }),
    onRouting: (agentId) => {
      setAutoRoutedAgent(agentId);
      if (isAutoRoute) setActiveAgent(agentId);
    },
    onThought: (content) => {
      if (!content) return;
      dispatchReactEvent({ type: 'thought', content });
      updateTempMessage(tempId, (message) => {
        const segments = [...(message.segments || [])];
        const last = segments[segments.length - 1];
        if (last?.type === 'text')
          segments[segments.length - 1] = { ...last, content: last.content + content };
        else segments.push({ type: 'text', content });
        return { ...message, content: message.content + content, segments };
      });
    },
    onToolCallStart: (data) => {
      dispatchReactEvent({ type: 'tool_call_start', ...data });
      updateTempMessage(tempId, (message) => ({
        ...message,
        segments: [
          ...(message.segments || []),
          {
            type: 'tool_call',
            callId: typeof data.callId === 'string' ? data.callId : undefined,
            toolName: String(data.toolName || ''),
            summary: typeof data.summary === 'string' ? data.summary : undefined,
            status: 'running',
            arguments: data.arguments,
          },
        ],
      }));
    },
    onToolCallEnd: (data) => {
      dispatchReactEvent({ type: 'tool_call_end', ...data });
      updateTempMessage(tempId, (message) => ({
        ...message,
        segments: message.segments?.map((segment) =>
          segment.type === 'tool_call' &&
          segment.status === 'running' &&
          (data.callId ? segment.callId === data.callId : segment.toolName === data.toolName)
            ? {
                ...segment,
                status: 'done' as const,
                result: typeof data.result === 'string' ? data.result : String(data.result || ''),
                duration: typeof data.duration === 'number' ? data.duration : undefined,
                summary: typeof data.summary === 'string' ? data.summary : segment.summary,
              }
            : segment,
        ),
      }));
    },
    onToolCallError: (data) => {
      dispatchReactEvent({ type: 'tool_call_error', ...data });
      updateTempMessage(tempId, (message) => ({
        ...message,
        segments: message.segments?.map((segment) =>
          segment.type === 'tool_call' &&
          segment.status === 'running' &&
          (data.callId ? segment.callId === data.callId : segment.toolName === data.toolName)
            ? {
                ...segment,
                status: 'error' as const,
                error: typeof data.error === 'string' ? data.error : String(data.error || ''),
                retryCount: typeof data.retryCount === 'number' ? data.retryCount : undefined,
              }
            : segment,
        ),
      }));
    },
    onToolApprovalRequired: (data) => {
      dispatchReactEvent({ type: 'approval_required', ...data });
      updateTempMessage(tempId, (message) => ({
        ...message,
        segments: message.segments?.map((segment) =>
          segment.type === 'tool_call' &&
          segment.status === 'running' &&
          segment.callId === data.callId
            ? {
                ...segment,
                status: 'approval_required' as const,
                approvalId: typeof data.approvalId === 'string' ? data.approvalId : undefined,
                approvalReason: typeof data.reason === 'string' ? data.reason : undefined,
              }
            : segment,
        ),
      }));
    },
    onAnswerReady: () => dispatchReactEvent({ type: 'answer_ready' }),
    onDone: () => {
      finishStream(tempId);
      onCompleted?.();
    },
    onError: (error) => {
      dispatchReactEvent({ type: 'run_failed', error: error.message });
      finishStream(tempId, error);
    },
  };
}

/** 为工具审批恢复构造只更新审批消息的 SSE 回调。 */
export function createToolApprovalCallbacks(
  approvalId: string,
  updateApprovalMessage: (update: (message: Message) => Message) => void,
  setSending: (value: boolean) => void,
  setStreamingId: (value: string | null) => void,
  setAgentRunStatus: Dispatch<SetStateAction<AgentRunStatusData | null>>,
  dispatchReactEvent: (event: ReactReducerEvent) => void,
): SendCallbacks {
  return {
    onRunStarted: (data) => dispatchReactEvent({ type: 'run_started', ...data }),
    onRoundStarted: (data) => dispatchReactEvent({ type: 'round_started', ...data }),
    onAgentStatus: (data) => {
      const status = parseAgentRunStatusData(data);
      if (status) setAgentRunStatus(status);
    },
    onChunk: (content) =>
      updateApprovalMessage((message) => {
        const segments = [...(message.segments || [])];
        const last = segments[segments.length - 1];
        if (last?.type === 'text')
          segments[segments.length - 1] = { ...last, content: last.content + content };
        else segments.push({ type: 'text', content });
        return { ...message, content: message.content + content, segments };
      }),
    onReasoning: (content) =>
      updateApprovalMessage((message) => ({
        ...message,
        reasoning: `${message.reasoning || ''}${content}`,
      })),
    onToolCallEnd: (data) =>
      updateApprovalMessage((message) => ({
        ...message,
        segments: message.segments?.map((segment) =>
          segment.type === 'tool_call' &&
          (segment.approvalId === approvalId || segment.callId === data.callId)
            ? { ...segment, status: 'done' as const, result: String(data.result || '') }
            : segment,
        ),
      })),
    onToolCallError: (data) =>
      updateApprovalMessage((message) => ({
        ...message,
        segments: message.segments?.map((segment) =>
          segment.type === 'tool_call' &&
          (segment.approvalId === approvalId || segment.callId === data.callId)
            ? { ...segment, status: 'error' as const, error: String(data.error || '') }
            : segment,
        ),
      })),
    onRunCompleted: (data) => dispatchReactEvent({ type: 'run_completed', ...data }),
    onRunCancelled: (data) => {
      dispatchReactEvent({ type: 'run_cancelled', ...data });
      setAgentRunStatus((previous) => (previous ? { ...previous, phase: 'cancelled' } : previous));
    },
    onDone: () => {
      setSending(false);
      setStreamingId(null);
    },
    onError: (error) => {
      updateApprovalMessage((message) => ({
        ...message,
        segments: message.segments?.map((segment) =>
          segment.type === 'tool_call' && segment.approvalId === approvalId
            ? { ...segment, status: 'error' as const, error: error.message }
            : segment,
        ),
      }));
      setSending(false);
      setStreamingId(null);
    },
  };
}
