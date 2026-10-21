import { BASE_URL, callEndpoint, getElectronAPI, isElectron } from './_base';
import type {
  TraceEntry,
  TraceEventDetail,
  TraceEventMetadata,
  TraceRunSummary,
} from '@mint/session/trace';

export interface ConversationTrajectoryPage {
  generation: string;
  highWatermark: number;
  nextAfterSeq: number;
  hasMore: boolean;
  historyCompleteness: 'complete' | 'legacy_partial';
  tailIncomplete: boolean;
  events: TraceEventMetadata[];
  entries: TraceEntry[];
  runs: TraceRunSummary[];
}

export interface ConversationTrajectoryUpdate {
  readonly cursor: number;
  readonly events: readonly TraceEventMetadata[];
  readonly entries: readonly TraceEntry[];
  readonly runs: readonly TraceRunSummary[];
}

/** 读取固定水位内的一页安全轨迹。 */
export function getConversationTrajectory(
  conversationId: string,
  query: { afterSeq?: number; pageSize?: number; throughSeq?: number } = {},
): Promise<ConversationTrajectoryPage> {
  return callEndpoint('conversations:getTrajectory', conversationId, query);
}

/** 用户显式展开事件时，读取带 availability 的详情包。 */
export function getConversationTrajectoryEvent(
  conversationId: string,
  eventId: string,
): Promise<TraceEventDetail> {
  return callEndpoint('conversations:getTrajectoryEvent', conversationId, eventId);
}

/** 在 Web 中订阅轨迹增量，浏览器重连时由 SSE 游标补发。 */
export function subscribeConversationTrajectory(
  conversationId: string,
  afterSeq: number,
  onUpdate: (update: ConversationTrajectoryUpdate) => void,
  onError: (error: Error) => void,
): () => void {
  if (isElectron()) {
    return subscribeElectronTrajectory(conversationId, afterSeq, onUpdate, onError);
  }
  const query = new URLSearchParams({ afterSeq: String(afterSeq) });
  const source = new EventSource(
    `${BASE_URL}/conversations/${encodeURIComponent(conversationId)}/trajectory/events?${query}`,
  );
  source.onmessage = (event) => {
    const update = parseTrajectoryUpdate(event.data);
    if (update) onUpdate(update);
  };
  source.addEventListener('error', (event) => {
    if (event instanceof MessageEvent && event.data) onError(new Error(event.data));
  });
  return () => source.close();
}

/** 通过 IPC 启动订阅并在组件卸载时取消订阅和移除 listener。 */
function subscribeElectronTrajectory(
  conversationId: string,
  afterSeq: number,
  onUpdate: (update: ConversationTrajectoryUpdate) => void,
  onError: (error: Error) => void,
): () => void {
  const api = getElectronAPI();
  if (!api) {
    onError(new Error('Electron API unavailable'));
    return () => undefined;
  }
  const state: {
    closed: boolean;
    subscriptionId?: string;
    removeUpdate: () => void;
    removeError: () => void;
  } = { closed: false, removeUpdate: () => undefined, removeError: () => undefined };
  void api
    .subscribeConversationTrajectory(conversationId, afterSeq)
    .then(({ subscriptionId }) => {
      if (state.closed) {
        void api.unsubscribeConversationTrajectory(subscriptionId);
        return;
      }
      state.subscriptionId = subscriptionId;
      state.removeUpdate = api.onConversationTrajectoryUpdate(subscriptionId, onUpdate);
      state.removeError = api.onConversationTrajectoryError(subscriptionId, (message) =>
        onError(new Error(message)),
      );
    })
    .catch((error: unknown) =>
      onError(error instanceof Error ? error : new Error('轨迹 IPC 订阅失败')),
    );
  return () => {
    state.closed = true;
    state.removeUpdate();
    state.removeError();
    if (state.subscriptionId) void api.unsubscribeConversationTrajectory(state.subscriptionId);
  };
}

/** 解析并验证 SSE 轨迹增量，拒绝不完整载荷。 */
function parseTrajectoryUpdate(value: string): ConversationTrajectoryUpdate | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      typeof parsed.cursor !== 'number' ||
      !Number.isSafeInteger(parsed.cursor) ||
      !Array.isArray(parsed.events) ||
      !Array.isArray(parsed.entries) ||
      !Array.isArray(parsed.runs)
    ) {
      return undefined;
    }
    if (
      !parsed.events.every(isTraceEventMetadata) ||
      !parsed.entries.every(isTraceEntry) ||
      !parsed.runs.every(isTraceRunSummary)
    )
      return undefined;
    return {
      cursor: parsed.cursor,
      events: parsed.events,
      entries: parsed.entries,
      runs: parsed.runs,
    };
  } catch {
    return undefined;
  }
}

/** 判断值是否为非空对象记录。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 判断 SSE 增量是否包含可安全渲染的轨迹行。 */
function isTraceEntry(value: unknown): value is TraceEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.seq === 'number' &&
    typeof value.runId === 'string' &&
    typeof value.turnId === 'string' &&
    typeof value.label === 'string' &&
    Array.isArray(value.eventIds) &&
    value.eventIds.every((eventId) => typeof eventId === 'string')
  );
}

/** 判断 SSE 元数据是否只含可安全展示的事件字段。 */
function isTraceEventMetadata(value: unknown): value is TraceEventMetadata {
  return (
    isRecord(value) &&
    typeof value.eventId === 'string' &&
    typeof value.seq === 'number' &&
    typeof value.runId === 'string' &&
    typeof value.turnId === 'string' &&
    typeof value.type === 'string' &&
    typeof value.label === 'string' &&
    Array.isArray(value.relatedIds) &&
    value.relatedIds.every((id) => typeof id === 'string')
  );
}

/** 判断 SSE 运行摘要是否完整。 */
function isTraceRunSummary(value: unknown): value is TraceRunSummary {
  return (
    isRecord(value) &&
    typeof value.runId === 'string' &&
    typeof value.status === 'string' &&
    typeof value.turnId === 'string' &&
    typeof value.startedAt === 'string' &&
    (value.endedAt === null || typeof value.endedAt === 'string') &&
    (value.originRunId === null || typeof value.originRunId === 'string')
  );
}
