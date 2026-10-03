import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db.js';
import type { MemoryJob, MemoryJobRow, MemoryScopeSnapshot } from '../../domains/memory/types.js';

function toMemoryJob(row: MemoryJobRow): MemoryJob {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    scopeKind: row.scope_kind,
    spaceId: row.space_id,
    bindingRevision: row.binding_revision,
    status: row.status,
    attempts: row.attempts,
    availableAt: row.available_at,
    lockedAt: row.locked_at,
    requestedThroughMessageId: row.requested_through_message_id,
    processedThroughMessageId: row.processed_through_message_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 创建或复用一个会话记忆处理任务，保证同一会话幂等。 */
export function enqueue(
  conversationId: string,
  throughMessageId: string | null = null,
  snapshot?: MemoryScopeSnapshot,
): MemoryJob {
  const db = getDb();
  const now = new Date().toISOString();
  const scope = snapshot ?? findCurrentScope(conversationId);
  if ((scope.scopeKind === 'space') !== (scope.spaceId !== null)) {
    throw new Error('Invalid memory job scope');
  }
  if (
    scope.scopeKind === 'space' &&
    !db
      .prepare('SELECT id FROM memory_spaces WHERE id = ? AND archived_at IS NULL')
      .get(scope.spaceId)
  ) {
    throw new Error('Memory space is unavailable');
  }
  if (throughMessageId) {
    const captured = db
      .prepare(
        `SELECT conversation_id, scope_kind, space_id, binding_revision
         FROM memory_message_scopes WHERE message_id = ?`,
      )
      .get(throughMessageId) as
      | {
          conversation_id: string;
          scope_kind: MemoryScopeSnapshot['scopeKind'];
          space_id: string | null;
          binding_revision: number;
        }
      | undefined;
    if (
      !captured ||
      captured.conversation_id !== conversationId ||
      captured.scope_kind !== scope.scopeKind ||
      captured.space_id !== scope.spaceId ||
      captured.binding_revision !== scope.bindingRevision
    ) {
      throw new Error('Memory job requires a matching persisted message scope snapshot');
    }
  }
  db.prepare(
    `
    INSERT INTO memory_processing_jobs
      (id, conversation_id, status, attempts, available_at, requested_through_message_id,
       scope_kind, space_id, binding_revision, created_at, updated_at)
    VALUES (?, ?, 'pending', 0, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id, binding_revision) DO UPDATE SET
      status = CASE
        WHEN excluded.requested_through_message_id IS NULL
          OR memory_processing_jobs.requested_through_message_id IS NULL
          OR memory_processing_jobs.requested_through_message_id <> excluded.requested_through_message_id
        THEN CASE WHEN memory_processing_jobs.status = 'processing' THEN 'processing' ELSE 'pending' END
        ELSE memory_processing_jobs.status
      END,
      available_at = excluded.available_at,
      requested_through_message_id = COALESCE(excluded.requested_through_message_id, memory_processing_jobs.requested_through_message_id),
      updated_at = excluded.updated_at,
      error_message = NULL
  `,
  ).run(
    uuidv4(),
    conversationId,
    now,
    throughMessageId,
    scope.scopeKind,
    scope.spaceId,
    scope.bindingRevision,
    now,
    now,
  );
  return getByConversationRevision(conversationId, scope.bindingRevision)!;
}

/** 原子领取一个可执行任务。 */
export function claimNext(): MemoryJob | undefined {
  const db = getDb();
  const now = new Date().toISOString();
  return db.transaction(() => {
    const row = db
      .prepare(
        `
      SELECT * FROM memory_processing_jobs
      WHERE status = 'pending' AND available_at <= ?
      ORDER BY created_at ASC LIMIT 1
    `,
      )
      .get(now) as MemoryJobRow | undefined;
    if (!row) return undefined;
    db.prepare(
      `
      UPDATE memory_processing_jobs
      SET status = 'processing', attempts = attempts + 1, locked_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `,
    ).run(now, now, row.id);
    return get(row.id);
  })();
}

/** 标记任务完成；若入队期间出现新消息，则自动回到 pending。 */
export function complete(id: string, processedThroughMessageId: string | null = null): void {
  getDb()
    .prepare(
      `UPDATE memory_processing_jobs
     SET status = CASE
       WHEN requested_through_message_id IS NOT NULL
         AND requested_through_message_id <> ? THEN 'pending'
       ELSE 'completed'
     END,
     processed_through_message_id = ?, locked_at = NULL, updated_at = ? WHERE id = ?`,
    )
    .run(processedThroughMessageId, processedThroughMessageId, new Date().toISOString(), id);
}

/** 失败任务按有限次数退避重试，超过次数后进入终态 failed。 */
export function fail(id: string, errorMessage: string, maxAttempts = 3): void {
  const db = getDb();
  const row = db.prepare('SELECT attempts FROM memory_processing_jobs WHERE id = ?').get(id) as
    { attempts: number } | undefined;
  if (!row) return;
  const now = new Date();
  const terminal = row.attempts >= maxAttempts;
  if (!terminal) now.setSeconds(now.getSeconds() + 2 ** row.attempts * 5);
  db.prepare(
    `
    UPDATE memory_processing_jobs
    SET status = ?, available_at = ?, locked_at = NULL, error_message = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(
    terminal ? 'failed' : 'pending',
    now.toISOString(),
    errorMessage.slice(0, 1000),
    new Date().toISOString(),
    id,
  );
}

/** 服务启动时恢复遗留 processing 任务。 */
export function recoverProcessing(): number {
  const now = new Date().toISOString();
  return getDb()
    .prepare(
      "UPDATE memory_processing_jobs SET status = 'pending', locked_at = NULL, available_at = ?, updated_at = ? WHERE status = 'processing'",
    )
    .run(now, now).changes;
}

function get(id: string): MemoryJob | undefined {
  const row = getDb().prepare('SELECT * FROM memory_processing_jobs WHERE id = ?').get(id) as
    MemoryJobRow | undefined;
  return row ? toMemoryJob(row) : undefined;
}

function getByConversationRevision(
  conversationId: string,
  bindingRevision: number,
): MemoryJob | undefined {
  const row = getDb()
    .prepare(
      'SELECT * FROM memory_processing_jobs WHERE conversation_id = ? AND binding_revision = ?',
    )
    .get(conversationId, bindingRevision) as MemoryJobRow | undefined;
  return row ? toMemoryJob(row) : undefined;
}

function findCurrentScope(conversationId: string): MemoryScopeSnapshot {
  const row = getDb()
    .prepare('SELECT memory_space_id, memory_binding_revision FROM conversations WHERE id = ?')
    .get(conversationId) as
    { memory_space_id: string | null; memory_binding_revision: number } | undefined;
  if (!row) throw new Error('Conversation scope is unavailable');
  return {
    scopeKind: row.memory_space_id ? 'space' : 'global',
    spaceId: row.memory_space_id,
    bindingRevision: row.memory_binding_revision,
  };
}
