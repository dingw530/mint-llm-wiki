import type { SessionEvent } from '../contracts.js';
import { validateSessionEvents } from '../validation.js';
import type {
  TraceEntry,
  TraceEventMetadata,
  TraceRunSummary,
  TraceToolStatus,
  TraceStatus,
} from './contracts.js';

/**
 * 将语义事件投影为无敏感正文的完整轨迹行。
 * @param events 已读取的连续事件前缀。
 * @returns 可按时间线渲染的轨迹行及工具调用状态。
 */
export function projectTrace(events: readonly SessionEvent[]): {
  readonly entries: readonly TraceEntry[];
  readonly events: readonly TraceEventMetadata[];
  readonly runs: readonly TraceRunSummary[];
  readonly toolStatuses: readonly TraceToolStatus[];
} {
  const validated = validateSessionEvents(events);
  const entries: TraceEntry[] = [];
  const toolIndexes = new Map<string, number>();
  const toolFacts = new Map<string, TraceToolStatus>();

  for (const event of validated) {
    if (event.type === 'tool_dispatch_committed') {
      const key = invocationKey(event.runId, event.callId);
      const entry = projectSingleEvent(event);
      toolIndexes.set(key, entries.push(entry) - 1);
      toolFacts.set(key, {
        runId: event.runId,
        callId: event.callId,
        toolName: event.toolName,
        status: 'running',
        dispatchEventId: event.eventId,
      });
      continue;
    }
    if (event.type === 'tool_result' || event.type === 'recovery_result') {
      updateToolEntry(entries, toolIndexes, toolFacts, event);
      continue;
    }
    entries.push(projectSingleEvent(event));
  }

  return {
    entries,
    events: validated.map(projectEventMetadata),
    runs: projectRuns(validated),
    toolStatuses: [...toolFacts.values()],
  };
}

/** 将单个会话事件投影为不含敏感正文的传输元数据。 */
function projectEventMetadata(event: SessionEvent): TraceEventMetadata {
  const entry = projectSingleEvent(event);
  return {
    eventId: event.eventId,
    seq: event.seq,
    runId: event.runId,
    turnId: event.turnId,
    type: event.type,
    lane: entry.lane,
    kind: entry.kind,
    label: entry.label,
    createdAt: event.createdAt,
    detailAvailable: true,
    synthetic: entry.synthetic,
    relatedIds: relatedIds(event),
    ...(entry.round === undefined ? {} : { round: entry.round }),
    ...(entry.callId ? { callId: entry.callId } : {}),
    ...(entry.status ? { status: entry.status } : {}),
    ...('durationMs' in event && event.durationMs !== undefined
      ? { durationMs: event.durationMs }
      : {}),
    ...(event.type === 'turn_started' && event.originRunId
      ? { originRunId: event.originRunId }
      : {}),
  };
}

/** 为安全事件元数据生成稳定的单事件展示行。 */
function projectSingleEvent(event: SessionEvent): TraceEntry {
  switch (event.type) {
    case 'turn_started':
      return createEntry(
        event,
        'input',
        'turn',
        event.recoveryActionId ? '继续已中断运行' : '新一轮对话',
        {
          ...(event.originRunId ? { detailEventIds: [event.eventId] } : {}),
        },
      );
    case 'user_message':
      return createEntry(event, 'input', 'message', '用户输入', {
        detailEventIds: [event.eventId],
      });
    case 'context_snapshot':
      return createEntry(event, 'input', 'context', event.source, {
        detailEventIds: [event.eventId],
      });
    case 'tool_catalog':
      return createEntry(event, 'input', 'context', `本轮可用工具：${event.tools.length} 项`, {
        round: event.round,
        detailEventIds: [event.eventId],
      });
    case 'model_message': {
      if (event.messages.length === 0) {
        return createEntry(event, 'model', 'message', '重复模型响应（已忽略）', {
          round: event.round,
          detailEventIds: [event.eventId],
          synthetic: true,
        });
      }
      const callCount = event.messages.reduce(
        (count, message) =>
          message.role === 'assistant' && Array.isArray(message.tool_calls)
            ? count + message.tool_calls.length
            : count,
        0,
      );
      return createEntry(
        event,
        'model',
        'message',
        callCount > 0 ? `模型请求调用 ${callCount} 项工具` : '模型输出',
        {
          round: event.round,
          detailEventIds: [event.eventId],
        },
      );
    }
    case 'tool_dispatch_committed':
      return createEntry(event, 'tool', 'tool', event.toolName, {
        round: event.round,
        callId: event.callId,
        status: 'running',
        detailEventIds: [event.eventId],
      });
    case 'tool_result':
      return createEntry(event, 'tool', 'tool', event.toolName, {
        round: event.round,
        callId: event.callId,
        status: event.status,
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        detailEventIds: [event.eventId],
      });
    case 'recovery_result':
      return createEntry(event, 'tool', 'tool', event.toolName, {
        round: event.round,
        callId: event.callId,
        status: event.status,
        synthetic: true,
        detailEventIds: [event.eventId],
      });
    case 'approval':
      return createEntry(event, 'tool', 'approval', `工具审批：${event.toolName}`, {
        callId: event.callId,
        status: approvalStatus(event.status),
        detailEventIds: [event.eventId],
      });
    case 'run_terminal':
      return createEntry(event, 'lifecycle', 'lifecycle', `运行${terminalLabel(event.outcome)}`, {
        status: event.outcome,
      });
    case 'turn_interrupted':
      return createEntry(event, 'lifecycle', 'lifecycle', '本轮意外停止', {
        status: 'interrupted',
        synthetic: true,
      });
    default:
      return assertNever(event);
  }
}

/** 汇总运行血缘、开始时间和持久终态。 */
function projectRuns(events: readonly SessionEvent[]): readonly TraceRunSummary[] {
  const runs = new Map<string, TraceRunSummary>();
  for (const event of events) {
    const current = runs.get(event.runId);
    const run: TraceRunSummary = current ?? {
      runId: event.runId,
      status: 'unknown',
      originRunId: null,
      turnId: event.turnId,
      startedAt: event.createdAt,
      endedAt: null,
    };
    let updated = { ...run, turnId: event.turnId };
    if (event.type === 'turn_started') {
      updated = {
        ...updated,
        status: current?.status ?? 'running',
        startedAt: current?.startedAt ?? event.createdAt,
        originRunId: event.originRunId ?? current?.originRunId ?? null,
      };
    } else if (event.type === 'run_terminal') {
      updated = { ...updated, status: event.outcome, endedAt: event.createdAt };
    } else if (event.type === 'turn_interrupted') {
      updated = { ...updated, status: 'interrupted', endedAt: event.createdAt };
    }
    runs.set(event.runId, updated);
  }
  return [...runs.values()].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

/** 返回事件关联的调用 ID 或旧运行 ID，供客户端建立跳转关系。 */
function relatedIds(event: SessionEvent): string[] {
  if ('callId' in event) return [event.callId];
  if (event.type === 'turn_started' && event.originRunId) return [event.originRunId];
  return [];
}

/** 将审批事件状态映射为轨迹状态。 */
function approvalStatus(
  status: Extract<SessionEvent, { type: 'approval' }>['status'],
): TraceStatus {
  if (status === 'approved') return 'success';
  if (status === 'denied' || status === 'expired') return 'failed';
  return 'running';
}

/**
 * 创建不复制正文载荷的安全预览行。
 * @param event 原始事件。
 * @param lane 轨迹泳道。
 * @param kind 轨迹节点类型。
 * @param label 安全展示标签。
 * @param options 可选身份和状态字段。
 * @returns 不含参数和结果正文的轨迹行。
 */
function createEntry(
  event: SessionEvent,
  lane: TraceEntry['lane'],
  kind: TraceEntry['kind'],
  label: string,
  options: Partial<
    Pick<TraceEntry, 'round' | 'callId' | 'status' | 'durationMs' | 'detailEventIds' | 'synthetic'>
  > = {},
): TraceEntry {
  return {
    id: event.eventId,
    eventIds: [event.eventId],
    seq: event.seq,
    runId: event.runId,
    turnId: event.turnId,
    lane,
    kind,
    label,
    createdAt: event.createdAt,
    detailEventIds: [],
    synthetic: false,
    ...options,
  };
}

/**
 * 用真实或恢复结果更新原工具行，并保留事件来源身份。
 * @param entries 正在构建的轨迹行。
 * @param indexes 工具调用到轨迹行的索引。
 * @param facts 工具调用状态。
 * @param runId 运行标识。
 * @param callId 工具调用标识。
 * @param resultEventId 结果事件标识。
 * @param status 结果状态。
 * @param durationMs 实际持续时间。
 * @param synthetic 是否为冷恢复事件。
 */
function updateToolEntry(
  entries: TraceEntry[],
  indexes: Map<string, number>,
  facts: Map<string, TraceToolStatus>,
  event: Extract<SessionEvent, { type: 'tool_result' | 'recovery_result' }>,
): void {
  const key = invocationKey(event.runId, event.callId);
  const index = indexes.get(key);
  const fact = facts.get(key);
  if (index === undefined || !fact) {
    const entry = createEntry(event, 'tool', 'tool', event.toolName, {
      round: event.round,
      callId: event.callId,
      status: event.status,
      detailEventIds: [event.eventId],
      synthetic: event.type === 'recovery_result',
      ...('durationMs' in event && event.durationMs !== undefined
        ? { durationMs: event.durationMs }
        : {}),
    });
    entries.push(entry);
    indexes.set(key, entries.length - 1);
    facts.set(key, {
      runId: event.runId,
      callId: event.callId,
      toolName: event.toolName,
      status: event.status,
      resultEventId: event.eventId,
    });
    return;
  }
  const entry = entries[index];
  if (!entry) return;
  entries[index] = {
    ...entry,
    eventIds: [...entry.eventIds, event.eventId],
    detailEventIds: [...entry.detailEventIds, event.eventId],
    status: event.status,
    ...('durationMs' in event && event.durationMs !== undefined
      ? { durationMs: event.durationMs }
      : {}),
    synthetic: event.type === 'recovery_result',
  };
  facts.set(key, {
    ...fact,
    status: event.status,
    resultEventId: event.eventId,
  });
}

/**
 * 生成运行内唯一的工具调用映射键。
 * @param runId 运行标识。
 * @param callId 调用标识。
 * @returns 组合身份键。
 */
function invocationKey(runId: string, callId: string): string {
  return `${runId}:${callId}`;
}

/**
 * 获取安全的运行终态中文标签。
 * @param outcome 运行终态。
 * @returns 本地化终态文本。
 */
function terminalLabel(outcome: 'completed' | 'failed' | 'cancelled'): string {
  switch (outcome) {
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return assertNever(outcome);
  }
}

/**
 * 处理穷尽事件投影检查。
 * @param event 不应到达的事件类型。
 */
function assertNever(event: never): never {
  throw new Error(`Unsupported event in trace projection: ${String(event)}`);
}
