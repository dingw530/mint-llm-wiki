import type {
  SessionContextSnapshotEvent,
  SessionEvent,
  SessionStoredModelMessage,
} from './contracts.js';
import { validateSessionEvents } from './validation.js';

/** 派生模型历史时可指定要恢复的执行轮次。 */
export interface ModelHistoryOptions {
  readonly turnId?: string;
}

interface ContextOverlay {
  readonly seq: number;
  readonly event: SessionContextSnapshotEvent;
}

/** 构建一个执行轮次的历史消息和动态上下文覆盖。 */
interface ModelHistoryState {
  readonly messages: SessionStoredModelMessage[];
  readonly pendingCalls: Set<string>;
}

/**
 * 从会话日志派生可发送给模型的消息；只有指定轮次的临时上下文会加入。
 * @param events 已持久化的有序会话事件。
 * @param options 可选目标轮次。
 * @returns 按会话顺序重建的模型消息。
 */
export function deriveModelHistory(
  events: readonly SessionEvent[],
  options: ModelHistoryOptions = {},
): SessionStoredModelMessage[] {
  const validated = validateSessionEvents(events);
  const activeTurnId = options.turnId ?? findLatestTurnId(validated);
  const overlays = validated
    .filter((event): event is SessionContextSnapshotEvent => event.type === 'context_snapshot')
    .filter((event) => event.turnId === activeTurnId)
    .map((event) => ({ seq: event.seq, event }));
  const latestHistory = overlays
    .filter(
      ({ event }) => event.scope === 'history' && ['replace', 'clear'].includes(event.operation),
    )
    .at(-1);
  const lowerBound = latestHistory?.seq ?? 0;
  const state = latestHistory
    ? historyFromReplacement(latestHistory.event)
    : historyFromConversation(validated, activeTurnId, lowerBound);
  applyHistoryAppends(state, overlays, lowerBound);
  const prefix = collectContextMessages(overlays, 'system', lowerBound);
  const anchored = collectAnchoredMessages(overlays, lowerBound);
  const runtime = collectContextMessages(overlays, 'runtime', lowerBound);
  const history = injectAnchoredMessages(state.messages, validated, anchored);
  const result = [...prefix, ...history, ...runtime];
  ensureNoPendingCalls(state.pendingCalls);
  return result.map((message) => ({ ...message }));
}

/**
 * 选择历史中最近一轮的身份。
 * @param events 已验证事件。
 * @returns 最近一轮标识；没有轮次时返回空值。
 */
function findLatestTurnId(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'turn_started') return event.turnId;
  }
  return events.at(-1)?.turnId;
}

/**
 * 从最近一次历史压缩快照恢复当前轮的完整有效上下文。
 * @param event 替换或清空历史的快照。
 * @returns 快照消息与未完成调用。
 */
function historyFromReplacement(event: SessionContextSnapshotEvent): ModelHistoryState {
  const messages = event.operation === 'clear' ? [] : [...event.messages];
  return { messages, pendingCalls: readPendingCalls(messages) };
}

/**
 * 按会话事件顺序重建持久聊天消息。
 * @param events 已验证事件。
 * @param activeTurnId 要加入临时上下文的当前轮。
 * @param lowerBound 最近有效历史快照的序号。
 * @returns 消息及工具配对状态。
 */
function historyFromConversation(
  events: readonly SessionEvent[],
  activeTurnId: string | undefined,
  lowerBound: number,
): ModelHistoryState {
  const state: ModelHistoryState = { messages: [], pendingCalls: new Set<string>() };
  for (const event of events) {
    if (event.seq <= lowerBound) continue;
    switch (event.type) {
      case 'user_message':
        ensureNoPendingCalls(state.pendingCalls);
        state.messages.push({ role: 'user', content: event.content });
        break;
      case 'model_message':
        if (event.messages.length === 0) break;
        ensureNoPendingCalls(state.pendingCalls);
        state.messages.push(...event.messages);
        addPendingCalls(event.messages, state.pendingCalls);
        break;
      case 'tool_result':
      case 'recovery_result':
        state.messages.push(event.message);
        state.pendingCalls.delete(event.callId);
        break;
      case 'context_snapshot':
        break;
      case 'tool_catalog':
        break;
      case 'turn_started':
      case 'tool_dispatch_committed':
      case 'approval':
      case 'run_terminal':
      case 'turn_interrupted':
        break;
      default:
        assertNever(event);
    }
  }
  return state;
}

/**
 * 在完整聊天历史之后追加当前轮历史覆盖事件。
 * @param state 当前历史投影。
 * @param overlays 当前轮上下文快照。
 * @param lowerBound 已应用的压缩快照序号。
 */
function applyHistoryAppends(
  state: ModelHistoryState,
  overlays: readonly ContextOverlay[],
  lowerBound: number,
): void {
  for (const { seq, event } of overlays) {
    if (seq > lowerBound && event.scope === 'history' && event.operation === 'append') {
      state.messages.push(...event.messages);
      updatePendingCalls(event.messages, state.pendingCalls);
    }
  }
}

/**
 * 收集系统前缀或本轮运行状态中每个来源的最新消息。
 * @param overlays 当前轮上下文快照。
 * @param scope 目标上下文作用域。
 * @param lowerBound 有效历史快照的序号。
 * @returns 按来源最近更新时间排列的消息。
 */
function collectContextMessages(
  overlays: readonly ContextOverlay[],
  scope: 'system' | 'runtime',
  lowerBound: number,
): SessionStoredModelMessage[] {
  const sources = new Map<string, readonly SessionStoredModelMessage[]>();
  for (const { seq, event } of overlays) {
    if (seq <= lowerBound || event.scope !== scope) continue;
    if (event.operation === 'clear') {
      sources.delete(event.source);
    } else if (event.operation === 'replace') {
      sources.delete(event.source);
      sources.set(event.source, event.messages);
    } else {
      sources.set(event.source, [...(sources.get(event.source) ?? []), ...event.messages]);
    }
  }
  return [...sources.values()].flatMap((messages) => [...messages]);
}

/**
 * 收集按旧用户消息锚定的本轮动态注入。
 * @param overlays 当前轮上下文快照。
 * @param lowerBound 有效历史快照的序号。
 * @returns 锚点到上下文消息的映射。
 */
function collectAnchoredMessages(
  overlays: readonly ContextOverlay[],
  lowerBound: number,
): ReadonlyMap<string, readonly SessionStoredModelMessage[]> {
  const anchors = new Map<string, Map<string, readonly SessionStoredModelMessage[]>>();
  for (const { seq, event } of overlays) {
    if (seq <= lowerBound || event.scope !== 'anchor' || !event.anchorMessageId) continue;
    let sources = anchors.get(event.anchorMessageId);
    if (!sources) {
      sources = new Map();
      anchors.set(event.anchorMessageId, sources);
    }
    if (event.operation === 'clear') {
      sources.delete(event.source);
    } else if (event.operation === 'replace') {
      sources.delete(event.source);
      sources.set(event.source, event.messages);
    } else {
      sources.set(event.source, [...(sources.get(event.source) ?? []), ...event.messages]);
    }
  }
  return new Map(
    [...anchors.entries()].map(([anchorId, sources]) => [
      anchorId,
      [...sources.values()].flatMap((messages) => [...messages]),
    ]),
  );
}

/**
 * 将动态上下文插入对应的用户消息前。
 * @param messages 持久对话消息。
 * @param events 有序事件，用于定位用户消息 ID。
 * @param anchors 锚点上下文。
 * @returns 带本轮 user-scoped 上下文的新消息数组。
 */
function injectAnchoredMessages(
  messages: readonly SessionStoredModelMessage[],
  events: readonly SessionEvent[],
  anchors: ReadonlyMap<string, readonly SessionStoredModelMessage[]>,
): SessionStoredModelMessage[] {
  if (anchors.size === 0) return [...messages];
  const userIds = events
    .filter((event) => event.type === 'user_message')
    .map((event) => event.messageId);
  const result: SessionStoredModelMessage[] = [];
  let userIndex = 0;
  for (const message of messages) {
    if (message.role === 'user') {
      const messageId = userIds[userIndex++];
      if (messageId) result.push(...(anchors.get(messageId) ?? []));
    }
    result.push(message);
  }
  return result;
}

/**
 * 从 assistant 消息读取悬空工具调用并验证已提交结果前不能开始新模型轮次。
 * @param messages 当前模型消息。
 * @returns 未配对调用集合。
 */
function readPendingCalls(messages: readonly SessionStoredModelMessage[]): Set<string> {
  const pending = new Set<string>();
  updatePendingCalls(messages, pending);
  return pending;
}

/** 按消息顺序开启 assistant 工具调用并关闭已有 tool 结果。 */
function updatePendingCalls(
  messages: readonly SessionStoredModelMessage[],
  pending: Set<string>,
): void {
  for (const message of messages) {
    if (message.role === 'assistant') addPendingCalls([message], pending);
    if (message.role === 'tool' && typeof message.tool_call_id === 'string') {
      pending.delete(message.tool_call_id);
    }
  }
}

/**
 * 将 assistant Tool Calls 加入未完成集合。
 * @param messages 模型消息。
 * @param pendingCalls 待配对工具调用集合。
 */
function addPendingCalls(
  messages: readonly SessionStoredModelMessage[],
  pendingCalls: Set<string>,
): void {
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      if (call === null || typeof call !== 'object' || Array.isArray(call)) continue;
      if (typeof call.id === 'string') pendingCalls.add(call.id);
    }
  }
}

/**
 * 拒绝把未配对的 assistant 工具调用交给模型适配器。
 * @param pendingCalls 尚未收到结果的调用标识集合。
 */
function ensureNoPendingCalls(pendingCalls: ReadonlySet<string>): void {
  if (pendingCalls.size > 0) {
    throw new Error(
      'Cannot derive model history with dangling tool calls: ' + [...pendingCalls].join(', '),
    );
  }
}

/**
 * 处理穷尽事件投影检查。
 * @param event 不应到达的事件类型。
 */
function assertNever(event: never): never {
  throw new Error('Unsupported event in model history: ' + String(event));
}
