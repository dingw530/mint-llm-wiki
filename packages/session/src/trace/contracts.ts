import type { SessionEvent } from '../contracts.js';

/** 轨迹事件所属的可视泳道。 */
export type TraceLane = 'input' | 'model' | 'tool' | 'lifecycle';

/** 轨迹事件可安全展示的执行状态。 */
export type TraceStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'not_started'
  | 'outcome_unknown'
  | 'interrupted'
  | 'completed';

/** 轨迹中一条不含敏感正文的展示行。 */
export interface TraceEntry {
  readonly id: string;
  readonly eventIds: readonly string[];
  readonly seq: number;
  readonly runId: string;
  readonly turnId: string;
  readonly round?: number;
  readonly callId?: string;
  readonly lane: TraceLane;
  readonly kind: 'turn' | 'message' | 'context' | 'tool' | 'approval' | 'lifecycle';
  readonly label: string;
  readonly status?: TraceStatus;
  readonly createdAt: string;
  readonly durationMs?: number;
  readonly detailEventIds: readonly string[];
  readonly synthetic: boolean;
}

/** 单个持久事件的安全传输元数据，不含用户正文、参数或模型结果。 */
export interface TraceEventMetadata {
  readonly eventId: string;
  readonly seq: number;
  readonly runId: string;
  readonly turnId: string;
  readonly originRunId?: string;
  readonly round?: number;
  readonly callId?: string;
  readonly type: SessionEvent['type'];
  readonly lane: TraceLane;
  readonly kind: TraceEntry['kind'];
  readonly label: string;
  readonly createdAt: string;
  readonly durationMs?: number;
  readonly status?: TraceStatus;
  readonly detailAvailable: boolean;
  readonly synthetic: boolean;
  readonly relatedIds: readonly string[];
}

/** 一次会话内运行的可追溯摘要。 */
export interface TraceRunSummary {
  readonly runId: string;
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';
  readonly originRunId: string | null;
  readonly turnId: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

/** 按用户显式展开读取的事件详情包。 */
export interface TraceEventDetail {
  readonly eventId: string;
  readonly availability: 'available' | 'missing' | 'unavailable';
  readonly historyCompleteness: 'complete' | 'legacy_partial';
  readonly payload?: SessionEvent;
  readonly errorCode?: 'EVENT_NOT_FOUND' | 'PAYLOAD_UNAVAILABLE';
  readonly message?: string;
}

/** 与事件内容分离、可安全分页传输的轨迹快照。 */
export interface TraceSnapshot {
  readonly generation: string;
  readonly highWatermark: number;
  readonly nextAfterSeq: number;
  readonly hasMore: boolean;
  readonly historyCompleteness: 'complete' | 'legacy_partial';
  readonly tailIncomplete: boolean;
  readonly events: readonly TraceEventMetadata[];
  readonly entries: readonly TraceEntry[];
  readonly runs: readonly TraceRunSummary[];
}

/** 按调用身份查询的已提交结果事实。 */
export interface TraceToolStatus {
  readonly runId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly status:
    'running' | 'success' | 'failed' | 'cancelled' | 'outcome_unknown' | 'not_started';
  readonly dispatchEventId?: string;
  readonly resultEventId?: string;
}
