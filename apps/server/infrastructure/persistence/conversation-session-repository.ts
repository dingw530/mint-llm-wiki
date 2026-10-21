import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  SESSION_EVENT_SCHEMA_VERSION,
  validateSessionEventBatch,
  validateSessionEvents,
  type SessionEvent,
  type SessionEventBase,
} from '@mint/session';
import { getDb } from '../../db.js';

const MAX_PAGE_SIZE = 500;
const MIN_LEASE_TTL_MS = 1_000;
const MAX_LEASE_TTL_MS = 300_000;

/** 持久会话历史完整性状态。 */
export type SessionHistoryCompleteness = 'complete' | 'legacy_partial';

/** 数据库存储层返回的会话状态。 */
export interface ConversationSessionState {
  readonly conversationId: string;
  readonly schemaVersion: number;
  readonly generation: string;
  readonly lastSequence: number;
  readonly historyCompleteness: SessionHistoryCompleteness;
  readonly tailIncomplete: boolean;
  readonly ownerId?: string;
  readonly ownerFence: number;
  readonly leaseExpiresAt?: string;
}

/** 一次有序轨迹页及读取时确定的水位。 */
export interface ConversationSessionPage {
  readonly state: ConversationSessionState;
  readonly highWatermark: number;
  readonly nextAfterSequence: number;
  readonly hasMore: boolean;
  readonly events: readonly SessionEvent[];
}

/** 一次会话写入租约及其 fencing token。 */
export interface ConversationSessionLease {
  readonly conversationId: string;
  readonly ownerId: string;
  readonly ownerFence: number;
  readonly expiresAt: string;
}

/** 轨迹仓库可以返回的安全、可判定错误码。 */
export type ConversationSessionErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_OWNER_ACTIVE'
  | 'SESSION_OWNER_REQUIRED'
  | 'SESSION_OWNER_STALE'
  | 'SESSION_SEQUENCE_CONFLICT'
  | 'SESSION_INVALID_PAGE';

/** 带稳定错误码的会话存储异常。 */
export class ConversationSessionRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: ConversationSessionErrorCode,
  ) {
    super(message);
    this.name = 'ConversationSessionRepositoryError';
  }
}

interface StateRow {
  conversation_id: string;
  schema_version: number;
  generation: string;
  last_seq: number;
  history_completeness: SessionHistoryCompleteness;
  tail_incomplete: number;
  owner_id: string | null;
  owner_fence: number;
  lease_expires_at: string | null;
}

interface EventRow {
  conversation_id: string;
  event_id: string;
  seq: number;
  schema_version: number;
  run_id: string;
  turn_id: string;
  event_type: string;
  round: number | null;
  call_id: string | null;
  created_at: string;
  payload_json: string;
}

interface LegacyMessageRow {
  id: string;
  role: string;
  content: string;
  reasoning: string | null;
  created_at: string;
}

/** 将会话状态、事件追加和冷恢复游标写入同一 SQLite 数据库。 */
export class ConversationSessionRepository {
  constructor(private readonly database?: Database.Database) {}

  /**
   * 在会话仓库使用的 SQLite 连接上运行组合写入，允许消息与会话事件原子提交。
   * @param operation 同步的事务操作。
   * @returns 事务操作的返回值。
   */
  withTransaction<T>(operation: () => T): T {
    return this.getDatabase().transaction(operation).immediate();
  }

  /**
   * 确保会话状态存在；首次读取时按稳定顺序导入旧消息并标记历史不完整。
   * @param conversationId 会话标识。
   * @param now 当前 ISO 时间。
   * @returns 初始化后的会话状态。
   */
  ensureConversation(
    conversationId: string,
    now = new Date().toISOString(),
  ): ConversationSessionState {
    requireText(conversationId, 'conversationId');
    const db = this.getDatabase();
    const state = db.transaction(() => {
      const current = this.readStateRow(db, conversationId);
      if (current) return current;
      const conversation = db
        .prepare('SELECT id FROM conversations WHERE id = ?')
        .get(conversationId);
      if (!conversation) {
        throw new ConversationSessionRepositoryError(
          'Conversation does not exist',
          'SESSION_NOT_FOUND',
        );
      }
      db.prepare(
        [
          'INSERT INTO conversation_session_state',
          '(conversation_id, schema_version, generation, last_seq, history_completeness,',
          'tail_incomplete, owner_fence, created_at, updated_at)',
          "VALUES (?, ?, ?, 0, 'complete', 0, 0, ?, ?)",
        ].join(' '),
      ).run(conversationId, SESSION_EVENT_SCHEMA_VERSION, randomUUID(), now, now);
      const legacy = this.readLegacyMessages(db, conversationId);
      if (legacy.length > 0) this.importLegacyMessages(db, conversationId, legacy, now);
      const initialized = this.readStateRow(db, conversationId);
      if (!initialized) throw new Error('Session state insert was not visible');
      return initialized;
    })();
    return toState(state);
  }

  /**
   * 读取某一持久水位内的事件页，并验证连续序号。
   * @param conversationId 会话标识。
   * @param afterSequence 独占起始游标。
   * @param pageSize 单页上限。
   * @param throughSequence 可选固定读取水位。
   * @returns 已验证事件和分页水位。
   */
  readPage(
    conversationId: string,
    afterSequence = 0,
    pageSize = 100,
    throughSequence?: number,
  ): ConversationSessionPage {
    validatePage(afterSequence, pageSize, throughSequence);
    const state = this.ensureConversation(conversationId);
    if (afterSequence > state.lastSequence)
      throw invalidPageError('Cursor exceeds session watermark');
    const highWatermark = Math.min(throughSequence ?? state.lastSequence, state.lastSequence);
    const rawRows = this.getDatabase()
      .prepare(
        [
          'SELECT * FROM conversation_session_events',
          'WHERE conversation_id = ? AND seq > ? AND seq <= ?',
          'ORDER BY seq ASC LIMIT ?',
        ].join(' '),
      )
      .all(conversationId, afterSequence, highWatermark, pageSize + 1);
    const rows = requireArray(rawRows, readEventRow);
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const priorRows =
      afterSequence === 0
        ? []
        : requireArray(
            this.getDatabase()
              .prepare(
                [
                  'SELECT * FROM conversation_session_events',
                  "WHERE conversation_id = ? AND seq <= ? AND event_type = 'model_message'",
                  'ORDER BY seq ASC',
                ].join(' '),
              )
              .all(conversationId, afterSequence),
            readEventRow,
          );
    const priorEvents = priorRows.map((row) => this.decodeEvent(row));
    const pageEvents = pageRows.map((row) => this.decodeEvent(row));
    const events = validateSessionEventBatch(
      normalizeRepeatedModelToolCallResponses(pageEvents, priorEvents),
      afterSequence + 1,
    );
    const nextAfterSequence = events.at(-1)?.seq ?? afterSequence;
    return {
      state,
      highWatermark,
      nextAfterSequence,
      hasMore,
      events,
    };
  }

  /**
   * 读取并验证某会话完整事件前缀。
   * @param conversationId 会话标识。
   * @returns 按会话序号排列的解密事件。
   */
  readAll(conversationId: string): readonly SessionEvent[] {
    const state = this.ensureConversation(conversationId);
    const rawRows = this.getDatabase()
      .prepare(
        [
          'SELECT * FROM conversation_session_events',
          'WHERE conversation_id = ? ORDER BY seq ASC',
        ].join(' '),
      )
      .all(conversationId);
    const rows = requireArray(rawRows, readEventRow);
    const events = validateSessionEvents(
      normalizeRepeatedModelToolCallResponses(rows.map((row) => this.decodeEvent(row))),
    );
    if ((events.at(-1)?.seq ?? 0) !== state.lastSequence) {
      throw new Error('Session state watermark does not match stored events');
    }
    return events;
  }

  /**
   * 读取会话内指定事件详情；调用方仍需先验证当前会话归属。
   * @param conversationId 会话标识。
   * @param eventId 事件标识。
   * @returns 找到时返回解密事件。
   */
  readEvent(conversationId: string, eventId: string): SessionEvent | undefined {
    this.ensureConversation(conversationId);
    const raw = this.getDatabase()
      .prepare(
        [
          'SELECT * FROM conversation_session_events',
          'WHERE conversation_id = ? AND event_id = ?',
        ].join(' '),
      )
      .get(conversationId, eventId);
    if (raw === undefined) return undefined;
    const row = readEventRow(raw);
    const priorRows =
      row.event_type === 'model_message'
        ? requireArray(
            this.getDatabase()
              .prepare(
                [
                  'SELECT * FROM conversation_session_events',
                  "WHERE conversation_id = ? AND seq < ? AND event_type = 'model_message'",
                  'ORDER BY seq ASC',
                ].join(' '),
              )
              .all(conversationId, row.seq),
            readEventRow,
          )
        : [];
    const event = this.decodeEvent(row);
    const normalized = normalizeRepeatedModelToolCallResponses(
      [event],
      priorRows.map((priorRow) => this.decodeEvent(priorRow)),
    );
    return validateSessionEventBatch(normalized, event.seq)[0];
  }

  /**
   * 在同一 SQLite 事务内追加一个与当前所有权 fencing 匹配的连续事件批次。
   * @param conversationId 会话标识。
   * @param expectedLastSequence 写入方读到的最后序号。
   * @param ownerFence 当前写入租约的 fencing token。
   * @param events 要追加的连续事件。
   * @param now 当前 ISO 时间。
   * @returns 提交后的会话状态。
   */
  appendBatch(
    conversationId: string,
    expectedLastSequence: number,
    ownerFence: number,
    events: readonly SessionEvent[],
    now = new Date().toISOString(),
  ): ConversationSessionState {
    requireNonNegativeInteger(expectedLastSequence, 'expectedLastSequence');
    requireNonNegativeInteger(ownerFence, 'ownerFence');
    if (events.length === 0) return this.ensureConversation(conversationId, now);
    const batch = validateSessionEventBatch(events, expectedLastSequence + 1);
    if (batch.some((event) => event.conversationId !== conversationId)) {
      throw new Error('Session event belongs to a different conversation');
    }
    const db = this.getDatabase();
    const committed = db.transaction(() => {
      const state = this.readStateRow(db, conversationId);
      if (!state) throw sessionNotFound();
      if (state.last_seq !== expectedLastSequence) {
        throw new ConversationSessionRepositoryError(
          'Session event sequence changed before append',
          'SESSION_SEQUENCE_CONFLICT',
        );
      }
      assertCurrentOwner(state, ownerFence, now);
      const insert = db.prepare(
        [
          'INSERT INTO conversation_session_events',
          '(conversation_id, event_id, seq, schema_version, run_id, turn_id,',
          'event_type, round, call_id, created_at, payload_json)',
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ].join(' '),
      );
      for (const event of batch) {
        insert.run(
          event.conversationId,
          event.eventId,
          event.seq,
          event.schemaVersion,
          event.runId,
          event.turnId,
          event.type,
          'round' in event ? event.round : null,
          'callId' in event ? event.callId : null,
          event.createdAt,
          JSON.stringify(event),
        );
      }
      const nextSequence = batch.at(-1)?.seq ?? expectedLastSequence;
      const tailIncomplete =
        state.tail_incomplete === 1 || batch.some((event) => event.type === 'turn_interrupted');
      const update = db
        .prepare(
          [
            'UPDATE conversation_session_state SET last_seq = ?, tail_incomplete = ?, updated_at = ?',
            'WHERE conversation_id = ? AND last_seq = ? AND owner_fence = ?',
          ].join(' '),
        )
        .run(
          nextSequence,
          tailIncomplete ? 1 : 0,
          now,
          conversationId,
          expectedLastSequence,
          ownerFence,
        );
      if (update.changes !== 1) {
        throw new ConversationSessionRepositoryError(
          'Session state changed before append completed',
          'SESSION_SEQUENCE_CONFLICT',
        );
      }
      const updated = this.readStateRow(db, conversationId);
      if (!updated) throw new Error('Session state disappeared during append');
      return updated;
    })();
    return toState(committed);
  }

  /**
   * 认领会话写入权；未过期的其他持有者会收到冲突。
   * @param conversationId 会话标识。
   * @param ownerId 当前进程标识。
   * @param ttlMs 租约期限。
   * @param now 当前 ISO 时间。
   * @returns 已认领租约。
   */
  claimOwner(
    conversationId: string,
    ownerId: string,
    ttlMs: number,
    now = new Date().toISOString(),
  ): ConversationSessionLease {
    requireText(ownerId, 'ownerId');
    validateLease(ttlMs, now);
    this.ensureConversation(conversationId, now);
    const db = this.getDatabase();
    const row = db.transaction(() => {
      const state = this.readStateRow(db, conversationId);
      if (!state) throw sessionNotFound();
      const expiresAt = toExpiry(now, ttlMs);
      if (state.owner_id && state.lease_expires_at && state.lease_expires_at > now) {
        if (state.owner_id !== ownerId) throw activeOwnerConflict();
        db.prepare(
          [
            'UPDATE conversation_session_state SET lease_expires_at = ?, updated_at = ?',
            'WHERE conversation_id = ? AND owner_id = ? AND owner_fence = ?',
          ].join(' '),
        ).run(expiresAt, now, conversationId, ownerId, state.owner_fence);
        return { ...state, lease_expires_at: expiresAt };
      }
      const ownerFence = state.owner_fence + 1;
      db.prepare(
        [
          'UPDATE conversation_session_state',
          'SET owner_id = ?, owner_fence = ?, lease_expires_at = ?, updated_at = ?',
          'WHERE conversation_id = ?',
        ].join(' '),
      ).run(ownerId, ownerFence, expiresAt, now, conversationId);
      const claimed = this.readStateRow(db, conversationId);
      if (!claimed) throw new Error('Session state disappeared during ownership claim');
      return claimed;
    })();
    return toLease(row);
  }

  /**
   * 刷新仍有效的租约；过期或 fencing 已改变时拒绝续租。
   * @param lease 当前写入租约。
   * @param ttlMs 新租约期限。
   * @param now 当前 ISO 时间。
   * @returns 刷新后的租约。
   */
  renewOwner(
    lease: ConversationSessionLease,
    ttlMs: number,
    now = new Date().toISOString(),
  ): ConversationSessionLease {
    validateLease(ttlMs, now);
    const expiresAt = toExpiry(now, ttlMs);
    const result = this.getDatabase()
      .prepare(
        [
          'UPDATE conversation_session_state SET lease_expires_at = ?, updated_at = ?',
          'WHERE conversation_id = ? AND owner_id = ? AND owner_fence = ?',
          'AND lease_expires_at > ?',
        ].join(' '),
      )
      .run(expiresAt, now, lease.conversationId, lease.ownerId, lease.ownerFence, now);
    if (result.changes !== 1) throw staleOwnerError();
    return { ...lease, expiresAt };
  }

  /**
   * 释放当前租约但保留递增的 fencing token。
   * @param lease 当前写入租约。
   * @param now 当前 ISO 时间。
   * @returns 是否成功释放。
   */
  releaseOwner(lease: ConversationSessionLease, now = new Date().toISOString()): boolean {
    const result = this.getDatabase()
      .prepare(
        [
          'UPDATE conversation_session_state',
          'SET owner_id = NULL, lease_expires_at = NULL, updated_at = ?',
          'WHERE conversation_id = ? AND owner_id = ? AND owner_fence = ?',
        ].join(' '),
      )
      .run(now, lease.conversationId, lease.ownerId, lease.ownerFence);
    return result.changes === 1;
  }

  /**
   * 返回注入的或服务端单例数据库。
   * @returns 已初始化的 SQLite 数据库。
   */
  private getDatabase(): Database.Database {
    return this.database ?? getDb();
  }

  /**
   * 读取并解析会话状态行。
   * @param db SQLite 数据库。
   * @param conversationId 会话标识。
   * @returns 找到时返回解析状态行。
   */
  private readStateRow(db: Database.Database, conversationId: string): StateRow | undefined {
    const row = db
      .prepare(['SELECT * FROM conversation_session_state WHERE conversation_id = ?'].join(' '))
      .get(conversationId);
    return row === undefined ? undefined : parseStateRow(row);
  }

  /**
   * 按消息表原始历史顺序读取旧消息。
   * @param db SQLite 数据库。
   * @param conversationId 会话标识。
   * @returns 真实持久化的旧消息。
   */
  private readLegacyMessages(db: Database.Database, conversationId: string): LegacyMessageRow[] {
    const rows = db
      .prepare(
        [
          'SELECT id, role, content, reasoning, created_at',
          'FROM messages WHERE conversation_id = ?',
          'ORDER BY created_at ASC, rowid ASC',
        ].join(' '),
      )
      .all(conversationId);
    return requireArray(rows, parseLegacyMessageRow);
  }

  /**
   * 一次性导入旧消息；不恢复不存在于消息表中的旧工具历史。
   * @param db SQLite 数据库。
   * @param conversationId 会话标识。
   * @param rows 按旧消息显示顺序排列的行。
   * @param now 初始化时间。
   */
  private importLegacyMessages(
    db: Database.Database,
    conversationId: string,
    rows: readonly LegacyMessageRow[],
    now: string,
  ): void {
    const insert = db.prepare(
      [
        'INSERT INTO conversation_session_events',
        '(conversation_id, event_id, seq, schema_version, run_id, turn_id,',
        'event_type, round, call_id, created_at, payload_json)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    );
    const runId = 'legacy:' + conversationId;
    rows.forEach((row, index) => {
      const event = legacyMessageEvent(conversationId, runId, row, index + 1);
      insert.run(
        conversationId,
        event.eventId,
        event.seq,
        event.schemaVersion,
        event.runId,
        event.turnId,
        event.type,
        'round' in event ? event.round : null,
        'callId' in event ? event.callId : null,
        event.createdAt,
        JSON.stringify(event),
      );
    });
    db.prepare(
      [
        "UPDATE conversation_session_state SET last_seq = ?, history_completeness = 'legacy_partial', updated_at = ?",
        'WHERE conversation_id = ?',
      ].join(' '),
    ).run(rows.length, now, conversationId);
  }

  /**
   * 解析 JSON 并验证事件载荷与索引列一致。
   * @param row 数据库事件行。
   * @returns 可重建的语义会话事件。
   */
  private decodeEvent(row: EventRow): SessionEvent {
    const decoded: unknown = JSON.parse(row.payload_json);
    if (!isSessionEvent(decoded)) throw new Error('Stored session event has invalid shape');
    const mismatches = getIndexMismatches(decoded, row);
    if (mismatches.length > 0) {
      throw new Error(
        'Stored session event index does not match its JSON payload: ' + mismatches.join(', '),
      );
    }
    return decoded;
  }
}

/**
 * 对比明文索引列与 JSON 载荷中的稳定事件身份。
 * @param event 已解析的会话事件。
 * @param row 数据库索引行。
 * @returns 不匹配的字段名，不含事件正文。
 */
function getIndexMismatches(event: SessionEvent, row: EventRow): string[] {
  const mismatches: string[] = [];
  if (event.conversationId !== row.conversation_id) mismatches.push('conversation_id');
  if (event.eventId !== row.event_id) mismatches.push('event_id');
  if (event.seq !== row.seq) mismatches.push('seq');
  if (event.schemaVersion !== row.schema_version) mismatches.push('schema_version');
  if (event.runId !== row.run_id) mismatches.push('run_id');
  if (event.turnId !== row.turn_id) mismatches.push('turn_id');
  if (event.type !== row.event_type) mismatches.push('event_type');
  if (event.createdAt !== row.created_at) mismatches.push('created_at');
  if (('round' in event ? event.round : null) !== row.round) mismatches.push('round');
  if (('callId' in event ? event.callId : null) !== row.call_id) mismatches.push('call_id');
  return mismatches;
}

/** Shared production repository; importing it does not open the database. */
export const conversationSessionRepository = new ConversationSessionRepository();

/**
 * 将解析后的状态行映射为对外类型。
 * @param row 数据库状态行。
 * @returns 防御性状态副本。
 */
function toState(row: StateRow): ConversationSessionState {
  return {
    conversationId: row.conversation_id,
    schemaVersion: row.schema_version,
    generation: row.generation,
    lastSequence: row.last_seq,
    historyCompleteness: row.history_completeness,
    tailIncomplete: row.tail_incomplete === 1,
    ...(row.owner_id ? { ownerId: row.owner_id } : {}),
    ownerFence: row.owner_fence,
    ...(row.lease_expires_at ? { leaseExpiresAt: row.lease_expires_at } : {}),
  };
}

/**
 * 将已解析的数据库行映射为租约。
 * @param row 会话状态行。
 * @returns 活动租约。
 */
function toLease(row: StateRow): ConversationSessionLease {
  if (!row.owner_id || !row.lease_expires_at) throw new Error('Session ownership is not active');
  return {
    conversationId: row.conversation_id,
    ownerId: row.owner_id,
    ownerFence: row.owner_fence,
    expiresAt: row.lease_expires_at,
  };
}

/**
 * 构造一次性导入的稳定旧消息事件。
 * @param conversationId 会话标识。
 * @param runId 旧消息运行分组标识。
 * @param row 旧消息行。
 * @param sequence 稳定导入序号。
 * @returns 不推造旧工具历史的消息事件。
 */
function legacyMessageEvent(
  conversationId: string,
  runId: string,
  row: LegacyMessageRow,
  sequence: number,
): SessionEvent {
  const base: SessionEventBase = {
    schemaVersion: SESSION_EVENT_SCHEMA_VERSION,
    conversationId,
    eventId: 'legacy-message:' + row.id,
    seq: sequence,
    runId,
    turnId: 'legacy-turn:' + row.id,
    createdAt: row.created_at,
  };
  if (row.role === 'user') {
    return {
      ...base,
      type: 'user_message',
      messageId: row.id,
      content: row.content,
    };
  }
  if (row.role === 'assistant' || row.role === 'system') {
    return {
      ...base,
      type: 'model_message',
      round: 1,
      messages: [
        {
          role: row.role,
          content: row.content,
          ...(row.reasoning === null ? {} : { reasoning: row.reasoning }),
        },
      ],
    };
  }
  throw new Error('Unsupported legacy message role: ' + row.role);
}

/**
 * 解析 SQLite 状态行，拒绝列缺失或类型损坏。
 * @param value SQLite 返回值。
 * @returns 经过运行时类型检查的状态行。
 */
function parseStateRow(value: unknown): StateRow {
  const row = requireRecord(value, 'session state');
  const completeness = readString(row, 'history_completeness');
  if (completeness !== 'complete' && completeness !== 'legacy_partial') {
    throw new Error('Invalid session history completeness');
  }
  return {
    conversation_id: readString(row, 'conversation_id'),
    schema_version: readNumber(row, 'schema_version'),
    generation: readString(row, 'generation'),
    last_seq: readNumber(row, 'last_seq'),
    history_completeness: completeness,
    tail_incomplete: readNumber(row, 'tail_incomplete'),
    owner_id: readNullableString(row, 'owner_id'),
    owner_fence: readNumber(row, 'owner_fence'),
    lease_expires_at: readNullableString(row, 'lease_expires_at'),
  };
}

/**
 * 解析 SQLite 事件索引行，拒绝非法字段类型。
 * @param value SQLite 返回值。
 * @returns 经过类型检查的事件行。
 */
function readEventRow(value: unknown): EventRow {
  const row = requireRecord(value, 'session event');
  return {
    conversation_id: readString(row, 'conversation_id'),
    event_id: readString(row, 'event_id'),
    seq: readNumber(row, 'seq'),
    schema_version: readNumber(row, 'schema_version'),
    run_id: readString(row, 'run_id'),
    turn_id: readString(row, 'turn_id'),
    event_type: readString(row, 'event_type'),
    round: readNullableNumber(row, 'round'),
    call_id: readNullableString(row, 'call_id'),
    created_at: readString(row, 'created_at'),
    payload_json: readString(row, 'payload_json'),
  };
}

/**
 * 解析旧消息行。
 * @param value SQLite 返回值。
 * @returns 旧消息内容。
 */
function parseLegacyMessageRow(value: unknown): LegacyMessageRow {
  const row = requireRecord(value, 'legacy message');
  return {
    id: readString(row, 'id'),
    role: readString(row, 'role'),
    content: readString(row, 'content'),
    reasoning: readNullableString(row, 'reasoning'),
    created_at: readString(row, 'created_at'),
  };
}

/**
 * 验证解析后的 JSON 具备当前会话事件的基础字段。
 * @param value 解密 JSON 值。
 * @returns 是否为结构可进一步验证的会话事件。
 */
function isSessionEvent(value: unknown): value is SessionEvent {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.schemaVersion === 'number' &&
    typeof value.conversationId === 'string' &&
    typeof value.eventId === 'string' &&
    typeof value.seq === 'number' &&
    typeof value.runId === 'string' &&
    typeof value.turnId === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.type === 'string'
  );
}

/**
 * 要求 SQLite 字段容器是普通对象。
 * @param value 查询结果。
 * @param name 字段组名称。
 * @returns 已检查记录。
 */
function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error('Invalid SQLite row: ' + name);
  return value;
}

/**
 * 验证并读取非空字符串字段。
 * @param row SQLite 行记录。
 * @param key 列名。
 * @returns 字符串值。
 */
function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error('Invalid SQLite text column: ' + key);
  return value;
}

/**
 * 验证并读取可空字符串字段。
 * @param row SQLite 行记录。
 * @param key 列名。
 * @returns 字符串或 null。
 */
function readNullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== 'string') {
    throw new Error('Invalid SQLite nullable text column: ' + key);
  }
  return value;
}

/**
 * 验证并读取数字字段。
 * @param row SQLite 行记录。
 * @param key 列名。
 * @returns 数字值。
 */
function readNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number') throw new Error('Invalid SQLite number column: ' + key);
  return value;
}

/**
 * 验证并读取可空数字字段。
 * @param row SQLite 行记录。
 * @param key 列名。
 * @returns 数字或 null。
 */
function readNullableNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value !== null && typeof value !== 'number') {
    throw new Error('Invalid SQLite nullable number column: ' + key);
  }
  return value;
}

/**
 * 验证普通对象原型。
 * @param value 待检查值。
 * @returns 是否为普通对象记录。
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * 将查询结果验证为类型化数组。
 * @param value SQLite 查询结果。
 * @param parse 单行解析器。
 * @returns 已逐行解析的数组。
 */
function requireArray<T>(value: unknown, parse: (row: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('Invalid SQLite row list');
  return value.map((row: unknown) => parse(row));
}

/**
 * 验证轨迹分页参数和快照水位。
 * @param afterSequence 独占起始序号。
 * @param pageSize 单页上限。
 * @param throughSequence 固定读取水位。
 */
function validatePage(afterSequence: number, pageSize: number, throughSequence?: number): void {
  requireNonNegativeInteger(afterSequence, 'afterSequence');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw invalidPageError('Invalid session page size');
  }
  if (
    throughSequence !== undefined &&
    (!Number.isSafeInteger(throughSequence) || throughSequence < afterSequence)
  ) {
    throw invalidPageError('Invalid session high watermark');
  }
}

/**
 * 验证 fencing token 仍对应未过期的会话所有者。
 * @param state 当前数据库状态。
 * @param ownerFence 写入方持有的 token。
 * @param now 当前 ISO 时间。
 */
function assertCurrentOwner(state: StateRow, ownerFence: number, now: string): void {
  if (!state.owner_id) {
    throw new ConversationSessionRepositoryError(
      'Session append requires an active owner',
      'SESSION_OWNER_REQUIRED',
    );
  }
  if (
    state.owner_fence !== ownerFence ||
    !state.lease_expires_at ||
    state.lease_expires_at <= now
  ) {
    throw staleOwnerError();
  }
}

/**
 * 创建轨迹分页参数异常。
 * @param message 安全、可显示的诊断。
 * @returns 带稳定错误码的分页异常。
 */
function invalidPageError(message: string): ConversationSessionRepositoryError {
  return new ConversationSessionRepositoryError(message, 'SESSION_INVALID_PAGE');
}

/**
 * 创建活跃会话持有者冲突错误。
 * @returns 可判定的 owner 冲突异常。
 */
function activeOwnerConflict(): ConversationSessionRepositoryError {
  return new ConversationSessionRepositoryError(
    'Conversation already has an active writer',
    'SESSION_OWNER_ACTIVE',
  );
}

/**
 * 创建过期或失效 fencing 错误。
 * @returns 可判定的 stale owner 异常。
 */
function staleOwnerError(): ConversationSessionRepositoryError {
  return new ConversationSessionRepositoryError(
    'Conversation writer lease expired or was fenced',
    'SESSION_OWNER_STALE',
  );
}

/**
 * 创建会话缺失错误。
 * @returns 可判定的 missing session 异常。
 */
function sessionNotFound(): ConversationSessionRepositoryError {
  return new ConversationSessionRepositoryError('Session state was not found', 'SESSION_NOT_FOUND');
}

/**
 * 验证租约期限和当前 ISO 时间。
 * @param ttlMs 租约毫秒数。
 * @param now ISO 时间。
 */
function validateLease(ttlMs: number, now: string): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < MIN_LEASE_TTL_MS || ttlMs > MAX_LEASE_TTL_MS) {
    throw new Error('Session lease TTL is outside the supported range');
  }
  validateIsoTime(now);
}

/**
 * 验证时间戳为可进行字典序比较的标准 UTC ISO 表示。
 * @param value 时间字符串。
 */
function validateIsoTime(value: string): void {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error('Session timestamp must use canonical UTC ISO format');
  }
}

/**
 * 计算租约过期时间。
 * @param now 当前 ISO 时间。
 * @param ttlMs 租约毫秒数。
 * @returns 过期 ISO 时间。
 */
function toExpiry(now: string, ttlMs: number): string {
  return new Date(Date.parse(now) + ttlMs).toISOString();
}

/** 将旧版 ReAct 双层写入产生的完全重复模型响应折叠为空事件。 */
function normalizeRepeatedModelToolCallResponses(
  events: readonly SessionEvent[],
  precedingEvents: readonly SessionEvent[] = [],
): readonly SessionEvent[] {
  const seenCalls = new Map<string, { signature: string; eventId: string }>();

  for (const event of precedingEvents) normalizeModelToolCallEvent(event, seenCalls);

  return events.map((event) => normalizeModelToolCallEvent(event, seenCalls));
}

/** 忽略同一轮次轨迹中内容完全相同的重复工具调用响应。 */
function normalizeModelToolCallEvent(
  event: SessionEvent,
  seenCalls: Map<string, { signature: string; eventId: string }>,
): SessionEvent {
  if (event.type !== 'model_message') return event;
  const callIds = readModelToolCallIds(event);
  if (!callIds || callIds.length === 0) return event;

  // 外层运行时与底层引擎的轮次计数可能不同；模型响应本身才是重复判断依据。
  const signature = JSON.stringify([event.turnId, event.messages]);
  const idsInEvent = new Set<string>();
  let repeatedCalls = 0;
  for (const callId of callIds) {
    const key = `${event.runId}:${callId}`;
    if (idsInEvent.has(key)) throw new Error('Duplicate model tool call in batch: ' + key);
    idsInEvent.add(key);
    const previous = seenCalls.get(key);
    if (!previous) continue;
    if (previous.signature !== signature || previous.eventId === event.eventId) {
      throw new Error('Duplicate model tool call in batch: ' + key);
    }
    repeatedCalls += 1;
  }

  if (repeatedCalls > 0) {
    if (repeatedCalls !== callIds.length) {
      throw new Error('Repeated model tool call batch does not match its original response');
    }
    return { ...event, messages: [] };
  }

  for (const callId of callIds) {
    seenCalls.set(`${event.runId}:${callId}`, { signature, eventId: event.eventId });
  }
  return event;
}

/** 安全读取模型响应中的工具调用标识；结构错误交由统一事件校验报告。 */
function readModelToolCallIds(
  event: Extract<SessionEvent, { type: 'model_message' }>,
): string[] | undefined {
  const callIds: string[] = [];
  for (const message of event.messages) {
    if (message.role !== 'assistant' || message.tool_calls === undefined) continue;
    if (!Array.isArray(message.tool_calls)) return undefined;
    for (const call of message.tool_calls) {
      if (
        call === null ||
        typeof call !== 'object' ||
        Array.isArray(call) ||
        !('id' in call) ||
        typeof call.id !== 'string'
      ) {
        return undefined;
      }
      callIds.push(call.id);
    }
  }
  return callIds;
}

/**
 * 要求文本字段非空。
 * @param value 字段值。
 * @param name 字段名。
 */
function requireText(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Session ' + name + ' is required');
}

/**
 * 验证非负安全整数。
 * @param value 数值。
 * @param name 字段名。
 */
function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid ' + name);
}
