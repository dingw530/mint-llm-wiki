/** 当前持久会话事件的格式版本。 */
export const SESSION_EVENT_SCHEMA_VERSION = 1;

/** 可安全序列化的 JSON 值。 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** 可由模型适配器直接接收的结构化消息。 */
export interface SessionStoredModelMessage {
  readonly role: string;
  readonly [key: string]: JsonValue | undefined;
}

/** 每条持久会话事件都携带的稳定身份和顺序信息。 */
export interface SessionEventBase {
  readonly schemaVersion: typeof SESSION_EVENT_SCHEMA_VERSION;
  readonly conversationId: string;
  readonly eventId: string;
  readonly seq: number;
  readonly runId: string;
  readonly turnId: string;
  readonly createdAt: string;
}

/** 标记一轮新会话输入开始。 */
export interface SessionTurnStartedEvent extends SessionEventBase {
  readonly type: 'turn_started';
  readonly originRunId?: string;
  readonly recoveryActionId?: string;
  readonly recoveryAction?: 'continue' | 'retry';
}

/** 持久化用户提供的输入。 */
export interface SessionUserMessageEvent extends SessionEventBase {
  readonly type: 'user_message';
  readonly messageId: string;
  readonly content: JsonValue;
}

/** 持久化一组模型消息，保留同一 assistant 消息内完整的工具调用分组。 */
export interface SessionModelMessageEvent extends SessionEventBase {
  readonly type: 'model_message';
  readonly round: number;
  /** 最终 assistant 聊天投影使用的稳定消息身份。 */
  readonly messageId?: string;
  readonly messages: readonly SessionStoredModelMessage[];
}

/** 持久化本轮新增或替换的模型可见上下文。 */
export interface SessionContextSnapshotEvent extends SessionEventBase {
  readonly type: 'context_snapshot';
  readonly round: number;
  readonly scope: 'system' | 'anchor' | 'runtime' | 'history';
  readonly operation: 'append' | 'replace' | 'clear';
  readonly source: string;
  readonly anchorMessageId?: string;
  readonly messages: readonly SessionStoredModelMessage[];
}

/** 模型本轮实际可调用的工具名称和结构化参数 schema 快照。 */
export interface SessionToolCatalogEvent extends SessionEventBase {
  readonly type: 'tool_catalog';
  readonly round: number;
  readonly tools: readonly JsonValue[];
}

/** 工具执行正文开始前已提交的调用意图。 */
export interface SessionToolDispatchEvent extends SessionEventBase {
  readonly type: 'tool_dispatch_committed';
  readonly round: number;
  readonly callId: string;
  readonly toolName: string;
  readonly argumentsJson: string;
  readonly retrySafety: 'safe' | 'idempotency_key' | 'never';
}

/** 工具执行后模型实际收到的结果。 */
export interface SessionToolResultEvent extends SessionEventBase {
  readonly type: 'tool_result';
  readonly round: number;
  readonly callId: string;
  readonly toolName: string;
  /** False for validation, authorization, or policy failures before execution. */
  readonly dispatchCommitted: boolean;
  readonly status: 'success' | 'failed' | 'cancelled' | 'outcome_unknown';
  readonly durationMs?: number;
  readonly message: SessionStoredModelMessage;
}

/** 会话恢复时为悬空调用追加的合成工具结果。 */
export interface SessionRecoveryResultEvent extends SessionEventBase {
  readonly type: 'recovery_result';
  readonly round: number;
  readonly callId: string;
  readonly toolName: string;
  readonly status: 'not_started' | 'outcome_unknown';
  readonly ledgerStatus: 'executing' | 'succeeded' | 'failed' | 'outcome_unknown' | 'missing';
  readonly synthetic: true;
  readonly message: SessionStoredModelMessage;
}

/** 保留人工审批决策的会话轨迹。 */
export interface SessionApprovalEvent extends SessionEventBase {
  readonly type: 'approval';
  readonly callId: string;
  readonly toolName: string;
  readonly status: 'requested' | 'approved' | 'denied' | 'expired';
  readonly reason?: string;
}

/** 记录一轮运行的持久终态。 */
export interface SessionRunTerminalEvent extends SessionEventBase {
  readonly type: 'run_terminal';
  readonly outcome: 'completed' | 'failed' | 'cancelled';
}

/** 关闭因进程退出而未完成的轮次。 */
export interface SessionTurnInterruptedEvent extends SessionEventBase {
  readonly type: 'turn_interrupted';
  readonly reason: 'process_exit' | 'approval_expired' | 'lease_expired' | 'unknown';
}

/** 完整、版本化、按会话序号排列的持久事件联合类型。 */
export type SessionEvent =
  | SessionTurnStartedEvent
  | SessionUserMessageEvent
  | SessionModelMessageEvent
  | SessionContextSnapshotEvent
  | SessionToolCatalogEvent
  | SessionToolDispatchEvent
  | SessionToolResultEvent
  | SessionRecoveryResultEvent
  | SessionApprovalEvent
  | SessionRunTerminalEvent
  | SessionTurnInterruptedEvent;

/** 尚未分配持久序号、由 SQLite 会话仓库提交的事件。 */
export type SessionEventDraft = {
  [Event in SessionEvent as Event['type']]: Omit<Event, 'seq'>;
}[SessionEvent['type']];

/** 工具结果或恢复计划的轻量执行事实，不包含敏感载荷。 */
export type SessionToolStatus =
  'success' | 'failed' | 'cancelled' | 'not_started' | 'outcome_unknown';
