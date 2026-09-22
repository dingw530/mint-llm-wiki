import type { DecisionTraceItem, ReActStep } from '@/types';

export type ReactEventStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ReactEventState {
  runId: string | null;
  status: ReactEventStatus;
  lastSequence: number;
  steps: ReActStep[];
  decisionTrace: DecisionTraceItem[];
  error?: string;
}

export interface ReactReducerEvent {
  type: string;
  runId?: string;
  callId?: string;
  toolName?: string;
  arguments?: unknown;
  result?: string;
  summary?: string;
  error?: string;
  retryCount?: number;
  duration?: number;
  content?: string;
  round?: number;
  phase?: 'retrying' | 'final';
  status?: 'retrying' | 'failed' | 'approval_required';
  approvalId?: string;
  reason?: string;
  message?: string;
  sequence?: number;
}

export function createInitialReactEventState(): ReactEventState {
  return { runId: null, status: 'idle', lastSequence: 0, steps: [], decisionTrace: [] };
}

function getNextSequence(state: ReactEventState, event: ReactReducerEvent): number | undefined {
  if (event.sequence === undefined) return state.lastSequence;
  if (!Number.isSafeInteger(event.sequence) || event.sequence <= state.lastSequence)
    return undefined;
  return event.sequence;
}

function traceItem(
  state: ReactEventState,
  item: Omit<DecisionTraceItem, 'id'>,
): DecisionTraceItem[] {
  return [
    ...state.decisionTrace,
    { ...item, id: `${state.runId || 'run'}:${state.decisionTrace.length}` },
  ];
}

function finishActiveTraceItems(items: DecisionTraceItem[]): DecisionTraceItem[] {
  return items.map((item) => (item.status === 'active' ? { ...item, status: 'done' } : item));
}

/**
 * 将新旧 ReAct 事件归约为展示状态，并按 callId 关联工具调用。
 */
export function reduceReactEvent(
  state: ReactEventState,
  event: ReactReducerEvent,
): ReactEventState {
  if (event.type === 'run_started') {
    if (event.sequence !== undefined && !Number.isSafeInteger(event.sequence)) return state;
    return {
      runId: event.runId || state.runId,
      status: 'running',
      lastSequence: event.sequence || 0,
      steps: [],
      decisionTrace: [
        {
          id: `${event.runId || 'run'}:0`,
          kind: 'start',
          label: '开始分析问题',
          status: 'active',
        },
      ],
    };
  }

  if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
    return state;
  }

  if (event.runId && state.runId && event.runId !== state.runId) return state;

  const nextSequence = getNextSequence(state, event);
  if (nextSequence === undefined) return state;
  state = { ...state, lastSequence: nextSequence };

  switch (event.type) {
    case 'round_started':
      return {
        ...state,
        status: 'running',
        decisionTrace: traceItem(state, {
          kind: 'round',
          label: `分析第 ${event.round || state.decisionTrace.length} 轮`,
          status: 'active',
        }),
      };
    case 'thought': {
      const content = event.content || '';
      if (!content) return state;
      const last = state.steps[state.steps.length - 1];
      if (last?.type === 'thought') {
        return {
          ...state,
          status: 'running',
          steps: [...state.steps.slice(0, -1), { ...last, content: last.content + content }],
        };
      }
      return { ...state, status: 'running', steps: [...state.steps, { type: 'thought', content }] };
    }
    case 'tool_call_start':
      return {
        ...state,
        status: 'running',
        decisionTrace: traceItem(state, {
          kind: 'action',
          label: `执行动作：${event.summary || event.toolName || '调用工具'}`,
          status: 'active',
        }),
        steps: [
          ...state.steps,
          {
            type: 'tool_call_start',
            callId: event.callId,
            toolName: event.toolName || '',
            arguments: event.arguments as string,
            summary: event.summary,
          },
        ],
      };
    case 'tool_call_end':
      return {
        ...state,
        status: 'running',
        decisionTrace: traceItem(state, {
          kind: 'result',
          label: `动作完成：${event.summary || event.toolName || '工具调用'}`,
          detail: event.duration ? `耗时 ${(event.duration / 1000).toFixed(1)} 秒` : undefined,
          status: 'done',
        }),
        steps: [
          ...state.steps,
          {
            type: 'tool_call_end',
            callId: event.callId,
            toolName: event.toolName || '',
            result: event.result || '',
            duration: event.duration || 0,
            summary: event.summary,
          },
        ],
      };
    case 'tool_call_error':
      return {
        ...state,
        status: 'running',
        decisionTrace: traceItem(state, {
          kind: event.phase === 'retrying' ? 'retry' : 'error',
          label:
            event.phase === 'retrying'
              ? `动作失败，准备重试：${event.toolName || '工具调用'}`
              : `动作失败：${event.toolName || '工具调用'}`,
          detail: event.phase === 'retrying' ? `第 ${event.retryCount || 0} 次重试` : undefined,
          status: event.phase === 'retrying' ? 'active' : 'error',
        }),
        steps: [
          ...state.steps,
          {
            type: 'tool_call_error',
            callId: event.callId,
            toolName: event.toolName || '',
            error: event.error || '',
            retryCount: event.retryCount || 0,
            status: event.status,
            approvalId: event.approvalId,
            approvalReason: event.reason,
          },
        ],
      };
    case 'approval_required':
      return {
        ...state,
        status: 'running',
        decisionTrace: traceItem(state, {
          kind: 'action',
          label: `等待审批：${event.toolName || '工具调用'}`,
          detail: event.reason,
          status: 'active',
        }),
      };
    case 'answer_ready': {
      const last = state.steps[state.steps.length - 1];
      return last?.type === 'thought' ? { ...state, steps: state.steps.slice(0, -1) } : state;
    }
    case 'run_completed':
      return {
        ...state,
        status: 'completed',
        decisionTrace: traceItem(
          { ...state, decisionTrace: finishActiveTraceItems(state.decisionTrace) },
          { kind: 'complete', label: '已完成回答', status: 'done' },
        ),
      };
    case 'loop_detected':
      return {
        ...state,
        status: 'running',
        decisionTrace: traceItem(state, {
          kind: 'fallback',
          label: '检测到重复动作，调整为直接回答',
          detail: event.message,
          status: 'active',
        }),
      };
    case 'run_failed':
      return {
        ...state,
        status: 'failed',
        error: event.error,
        decisionTrace: traceItem(
          { ...state, decisionTrace: finishActiveTraceItems(state.decisionTrace) },
          { kind: 'failed', label: '生成失败', status: 'error' },
        ),
      };
    case 'run_cancelled':
      return {
        ...state,
        status: 'cancelled',
        decisionTrace: traceItem(
          { ...state, decisionTrace: finishActiveTraceItems(state.decisionTrace) },
          { kind: 'cancelled', label: '已停止生成', status: 'done' },
        ),
      };
    default:
      return state;
  }
}
