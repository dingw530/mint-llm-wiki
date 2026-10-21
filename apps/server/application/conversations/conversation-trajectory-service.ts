import {
  projectTrace,
  type TraceEntry,
  type TraceEventDetail,
  type TraceEventMetadata,
  type TraceRunSummary,
} from '@mint/session/trace';
import type { Request, Response } from 'express';
import { findById } from '../../domains/conversations/index.js';
import { ConversationSessionRepository } from '../../infrastructure/persistence/conversation-session-repository.js';
import type { HttpError } from '../../types.js';
import { repairInterruptedConversation } from './conversation-session-recovery-service.js';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

export interface ConversationTrajectoryPage {
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

interface TrajectoryStreamState {
  cursor: number;
  closed: boolean;
  heartbeatAt: number;
  timer?: ReturnType<typeof setInterval>;
}

/**
 * 冷修复失活会话后，读取安全轨迹预览并固定本次读取水位。
 * @param conversationId 会话标识。
 * @param afterSeq 独占起始事件序号。
 * @param pageSize 请求的轨迹行数。
 * @param throughSeq 可选的固定读取水位。
 * @returns 可分页的安全轨迹快照。
 */
export function getConversationTrajectory(
  conversationId: string,
  afterSeq = 0,
  pageSize = DEFAULT_PAGE_SIZE,
  throughSeq?: number,
): ConversationTrajectoryPage {
  requireConversation(conversationId);
  validateCursor(afterSeq, pageSize, throughSeq);
  const repository = new ConversationSessionRepository();
  repairInterruptedConversation(conversationId, { repository });
  const page = repository.readPage(conversationId, afterSeq, pageSize, throughSeq);
  const allEvents = repository
    .readAll(conversationId)
    .filter((event) => event.seq <= page.highWatermark);
  const projection = projectTrace(allEvents);
  const eventIds = new Set(page.events.map((event) => event.eventId));
  return {
    generation: page.state.generation,
    highWatermark: page.highWatermark,
    nextAfterSeq: page.nextAfterSequence,
    hasMore: page.hasMore,
    historyCompleteness: page.state.historyCompleteness,
    tailIncomplete: page.state.tailIncomplete,
    events: projection.events.filter(
      (event) => event.seq > afterSeq && event.seq <= page.highWatermark,
    ),
    entries: projection.entries.filter((entry) => entry.eventIds.some((id) => eventIds.has(id))),
    runs: projection.runs,
  };
}

/**
 * 按事件标识读取经过会话归属校验的详情。
 * @param conversationId 会话标识。
 * @param eventId 轨迹详情事件标识。
 * @returns 事件载荷；不存在时返回 null。
 */
export function getConversationTrajectoryEvent(
  conversationId: string,
  eventId: string,
): TraceEventDetail {
  requireConversation(conversationId);
  if (!eventId.trim()) throw new Error('eventId is required');
  const repository = new ConversationSessionRepository();
  const state = repository.ensureConversation(conversationId);
  try {
    const event = repository.readEvent(conversationId, eventId);
    return event
      ? {
          eventId,
          availability: 'available',
          historyCompleteness: state.historyCompleteness,
          payload: event,
        }
      : {
          eventId,
          availability: 'missing',
          historyCompleteness: state.historyCompleteness,
          errorCode: 'EVENT_NOT_FOUND',
          message: '轨迹事件不存在或不属于此会话。',
        };
  } catch {
    return {
      eventId,
      availability: 'unavailable',
      historyCompleteness: state.historyCompleteness,
      errorCode: 'PAYLOAD_UNAVAILABLE',
      message: '轨迹详情无法解密或读取。',
    };
  }
}

/**
 * 通过 SSE 推送指定游标之后的新轨迹行和状态更新。
 * @param conversationId 会话标识。
 * @param query 流起始游标。
 * @param request 当前 SSE 请求。
 * @param response 当前 SSE 响应。
 */
export function streamConversationTrajectory(
  conversationId: string,
  query: Record<string, unknown> | undefined,
  request: Request,
  response: Response,
): void {
  requireConversation(conversationId);
  const afterSeq = Math.max(
    parseStreamCursor(query?.afterSeq),
    parseStreamCursor(request.header('Last-Event-ID')),
  );
  const repository = new ConversationSessionRepository();
  const sessionState = repository.ensureConversation(conversationId);
  if (afterSeq > sessionState.lastSequence) throw invalidStreamCursorError();
  const state = createTrajectoryStreamState(afterSeq);
  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();
  response.write(`: ready ${afterSeq}\n\n`);
  state.timer = setInterval(
    () => publishTrajectoryChanges(repository, conversationId, response, state),
    750,
  );
  response.on('close', () => closeTrajectoryStream(state));
}

/** 初始化 SSE 游标和连接生命周期状态。 */
function createTrajectoryStreamState(cursor: number): TrajectoryStreamState {
  return { cursor, closed: false, heartbeatAt: Date.now() };
}

/** 读取最新事件，推送游标后新增或状态变化的轨迹行。 */
function publishTrajectoryChanges(
  repository: ConversationSessionRepository,
  conversationId: string,
  response: Response,
  state: TrajectoryStreamState,
): void {
  if (state.closed) return;
  try {
    const session = repository.ensureConversation(conversationId);
    const now = Date.now();
    if (session.lastSequence <= state.cursor) {
      if (now - state.heartbeatAt >= 15_000) {
        response.write(': heartbeat\n\n');
        state.heartbeatAt = now;
      }
      return;
    }

    const events = repository.readAll(conversationId);
    const eventSequences = new Map(events.map((event) => [event.eventId, event.seq]));
    const projection = projectTrace(events);
    const changedEvents = projection.events.filter((event) => event.seq > state.cursor);
    const changedEntries = projection.entries.filter((entry) =>
      entry.eventIds.some((eventId) => (eventSequences.get(eventId) ?? 0) > state.cursor),
    );
    const highWatermark = events.at(-1)?.seq ?? session.lastSequence;
    response.write(
      `id: ${highWatermark}\ndata: ${JSON.stringify({ cursor: highWatermark, events: changedEvents, entries: changedEntries, runs: projection.runs })}\n\n`,
    );
    state.heartbeatAt = now;
    state.cursor = highWatermark;
  } catch {
    response.write(
      `event: error\ndata: ${JSON.stringify({ error: 'TRAJECTORY_STREAM_FAILED' })}\n\n`,
    );
    response.end();
    closeTrajectoryStream(state);
  }
}

/** 停止轮询并清理 SSE 响应资源。 */
function closeTrajectoryStream(state: TrajectoryStreamState): void {
  if (state.closed) return;
  state.closed = true;
  if (state.timer) clearInterval(state.timer);
}

/** 将 SSE 游标解析为非负安全整数。 */
function parseStreamCursor(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const cursor = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid afterSeq');
  return cursor;
}

/** 为超出当前会话水位的 SSE 游标返回明确的客户端错误。 */
function invalidStreamCursorError(): HttpError {
  const error: HttpError = new Error('afterSeq exceeds the current trajectory watermark');
  error.status = 400;
  return error;
}

/** 确认会话存在，避免通过事件标识探测其他会话的数据。 */
function requireConversation(conversationId: string): void {
  if (!findById(conversationId)) {
    const error: HttpError = new Error('Conversation not found');
    error.status = 404;
    throw error;
  }
}

/** 校验并限制轨迹页的游标参数。 */
function validateCursor(afterSeq: number, pageSize: number, throughSeq?: number): void {
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new Error('Invalid afterSeq');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error(`pageSize must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  if (throughSeq !== undefined && (!Number.isSafeInteger(throughSeq) || throughSeq < afterSeq)) {
    throw new Error('Invalid throughSeq');
  }
}
