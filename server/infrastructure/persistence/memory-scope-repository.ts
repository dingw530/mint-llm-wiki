import { randomUUID } from 'node:crypto';
import { getDb } from '../../db.js';
import type {
  MemoryExtractionMessage,
  MemoryMessageScope,
  MemoryScopeSnapshot,
  MemorySpace,
} from '../../domains/memory/types.js';

interface MemorySpaceRow {
  id: string;
  name: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MemoryMessageScopeRow {
  message_id: string;
  conversation_id: string;
  scope_kind: MemoryScopeSnapshot['scopeKind'];
  space_id: string | null;
  binding_revision: number;
  captured_at: string;
}

export class MemoryScopeConflictError extends Error {
  constructor(readonly conflictingMemoryKeys: string[]) {
    super('Memory scope assignment has conflicting single-value facts');
    this.name = 'MemoryScopeConflictError';
  }
}

function toSpace(row: MemorySpaceRow): MemorySpace {
  return {
    id: row.id,
    name: row.name,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessageScope(row: MemoryMessageScopeRow): MemoryMessageScope {
  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    scopeKind: row.scope_kind,
    spaceId: row.space_id,
    bindingRevision: row.binding_revision,
    capturedAt: row.captured_at,
  };
}

/** List knowledge spaces, optionally including archived spaces. */
export function listSpaces(includeArchived = false): MemorySpace[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM memory_spaces ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY name COLLATE NOCASE, id`,
    )
    .all() as MemorySpaceRow[];
  return rows.map(toSpace);
}

/** Create a knowledge space with a normalized, validated name. */
export function createSpace(name: string): MemorySpace {
  const normalized = name.trim();
  if (normalized.length < 1 || normalized.length > 80) {
    throw new Error('Memory space name must contain between 1 and 80 characters');
  }
  const now = new Date().toISOString();
  const id = randomUUID();
  getDb()
    .prepare('INSERT INTO memory_spaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, normalized, now, now);
  return { id, name: normalized, archivedAt: null, createdAt: now, updatedAt: now };
}

/** Rename an active knowledge space. */
export function renameSpace(id: string, name: string): MemorySpace | null {
  const normalized = name.trim();
  if (normalized.length < 1 || normalized.length > 80) {
    throw new Error('Memory space name must contain between 1 and 80 characters');
  }
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      'UPDATE memory_spaces SET name = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL',
    )
    .run(normalized, now, id);
  return result.changes === 0 ? null : findSpaceById(id);
}

/** Archive a space and atomically unbind its conversations. */
export function archiveSpace(id: string): MemorySpace | null {
  const db = getDb();
  const now = new Date().toISOString();
  return db.transaction(() => {
    const space = findSpaceById(id);
    if (!space || space.archivedAt) return null;
    db.prepare(
      `UPDATE conversations SET memory_space_id = NULL,
        memory_binding_revision = memory_binding_revision + 1, updated_at = ?
       WHERE memory_space_id = ?`,
    ).run(now, id);
    db.prepare('UPDATE memory_spaces SET archived_at = ?, updated_at = ? WHERE id = ?').run(
      now,
      now,
      id,
    );
    return findSpaceById(id);
  })();
}

/** Read the current conversation scope without loading its messages or unrelated fields. */
export function findConversationScope(conversationId: string): MemoryScopeSnapshot | null {
  const row = getDb()
    .prepare('SELECT memory_space_id, memory_binding_revision FROM conversations WHERE id = ?')
    .get(conversationId) as
    { memory_space_id: string | null; memory_binding_revision: number } | undefined;
  if (!row) return null;
  return {
    scopeKind: row.memory_space_id ? 'space' : 'global',
    spaceId: row.memory_space_id,
    bindingRevision: row.memory_binding_revision,
  };
}

/** Bind a conversation to an active space or user-global memory scope. */
export function bindConversation(
  conversationId: string,
  spaceId: string | null,
): { scope: MemoryScopeSnapshot; changed: boolean } | null {
  const db = getDb();
  return db.transaction(() => {
    if (spaceId) {
      const space = findSpaceById(spaceId);
      if (!space || space.archivedAt) throw new Error('Memory space is unavailable');
    }
    const current = findConversationScope(conversationId);
    if (!current) return null;
    if (current.spaceId === spaceId) return { scope: current, changed: false };
    db.prepare(
      `UPDATE conversations SET memory_space_id = ?,
        memory_binding_revision = memory_binding_revision + 1, updated_at = ? WHERE id = ?`,
    ).run(spaceId, new Date().toISOString(), conversationId);
    return { scope: findConversationScope(conversationId)!, changed: true };
  })();
}

/** List conversations that will be unbound when a space is archived. */
export function listBoundConversationIds(spaceId: string): string[] {
  const rows = getDb()
    .prepare('SELECT id FROM conversations WHERE memory_space_id = ? ORDER BY id')
    .all(spaceId) as Array<{ id: string }>;
  return rows.map(({ id }) => id);
}

/** Save the immutable scope snapshot associated with a persisted message. */
export function captureMessageScope(
  messageId: string,
  conversationId: string,
  scope: MemoryScopeSnapshot,
): void {
  validateScope(scope);
  getDb()
    .prepare(
      `INSERT INTO memory_message_scopes (
        message_id, conversation_id, scope_kind, space_id, binding_revision, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO NOTHING`,
    )
    .run(
      messageId,
      conversationId,
      scope.scopeKind,
      scope.spaceId,
      scope.bindingRevision,
      new Date().toISOString(),
    );
}

/** Read a persisted message's immutable memory scope snapshot. */
export function findMessageScope(messageId: string): MemoryMessageScope | null {
  const row = getDb()
    .prepare('SELECT * FROM memory_message_scopes WHERE message_id = ?')
    .get(messageId) as MemoryMessageScopeRow | undefined;
  return row ? toMessageScope(row) : null;
}

/** Read only transcript messages captured in the claimed scope and through-message snapshot. */
export function findTranscriptForJob(
  conversationId: string,
  scope: MemoryScopeSnapshot,
  throughMessageId: string | null,
): MemoryExtractionMessage[] {
  if (!throughMessageId) return [];
  if (
    scope.scopeKind === 'space' &&
    !getDb()
      .prepare('SELECT id FROM memory_spaces WHERE id = ? AND archived_at IS NULL')
      .get(scope.spaceId)
  ) {
    return [];
  }
  const rows = getDb()
    .prepare(
      `SELECT message.id, message.role, message.content, message.created_at
       FROM messages AS message
       JOIN memory_message_scopes AS scope ON scope.message_id = message.id
       JOIN messages AS through_message ON through_message.id = ?
       WHERE scope.conversation_id = ? AND scope.binding_revision = ?
         AND scope.scope_kind = ? AND scope.space_id IS ?
         AND message.rowid <= through_message.rowid
         AND message.role IN ('user', 'assistant')
       ORDER BY message.rowid`,
    )
    .all(
      throughMessageId,
      conversationId,
      scope.bindingRevision,
      scope.scopeKind,
      scope.spaceId,
    ) as Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }));
}

/** Assign a complete memory batch to one scope or roll back if a key conflict exists. */
export function assignMemoryScope(
  memoryIds: string[],
  scopeKind: 'global' | 'space',
  spaceId: string | null,
): { updated: number } {
  const ids = [...new Set(memoryIds)];
  if (ids.length === 0 || (scopeKind === 'space') !== (spaceId !== null)) {
    throw new Error('Memory scope assignment is invalid');
  }
  const db = getDb();
  return db.transaction(() => {
    if (spaceId) {
      const target = findSpaceById(spaceId);
      if (!target || target.archivedAt) throw new Error('Memory space is unavailable');
    }
    const placeholders = ids.map(() => '?').join(', ');
    const selected = db
      .prepare(
        `SELECT id, memory_key, subject, content, status FROM memories WHERE id IN (${placeholders})`,
      )
      .all(...ids) as Array<{
      id: string;
      memory_key: string;
      subject: string;
      content: string;
      status: string;
    }>;
    if (selected.length !== ids.length) throw new Error('One or more memories were not found');
    const conflicts = findScopeConflicts(selected, ids, scopeKind, spaceId);
    if (conflicts.length) throw new MemoryScopeConflictError(conflicts);
    const result = db
      .prepare(
        `UPDATE memories SET scope_kind = ?, space_id = ?, updated_at = ? WHERE id IN (${placeholders})`,
      )
      .run(scopeKind, spaceId, new Date().toISOString(), ...ids);
    return { updated: result.changes };
  })();
}

function findScopeConflicts(
  selected: Array<{
    id: string;
    memory_key: string;
    subject: string;
    content: string;
    status: string;
  }>,
  selectedIds: string[],
  scopeKind: 'global' | 'space',
  spaceId: string | null,
): string[] {
  const active = selected.filter((item) => item.status === 'active');
  if (!active.length) return [];
  const db = getDb();
  const placeholders = selectedIds.map(() => '?').join(', ');
  const existing = db
    .prepare(
      `SELECT id, memory_key, subject, content FROM memories
       WHERE status = 'active' AND scope_kind = ? AND space_id IS ?
         AND id NOT IN (${placeholders})`,
    )
    .all(scopeKind, spaceId, ...selectedIds) as Array<{
    id: string;
    memory_key: string;
    subject: string;
    content: string;
  }>;
  const keys = new Set<string>();
  for (const memory of active) {
    const key = `${memory.memory_key}\u0000${memory.subject}`;
    if (
      existing.some(
        (item) =>
          item.memory_key === memory.memory_key &&
          item.subject === memory.subject &&
          item.content !== memory.content,
      )
    ) {
      keys.add(key);
    }
    if (
      active.some(
        (item) =>
          item.id !== memory.id &&
          item.memory_key === memory.memory_key &&
          item.subject === memory.subject &&
          item.content !== memory.content,
      )
    ) {
      keys.add(key);
    }
  }
  return [...keys].map((key) => key.split('\u0000')[0]);
}

function findSpaceById(id: string): MemorySpace | null {
  const row = getDb().prepare('SELECT * FROM memory_spaces WHERE id = ?').get(id) as
    MemorySpaceRow | undefined;
  return row ? toSpace(row) : null;
}

function validateScope(scope: MemoryScopeSnapshot): void {
  if (!Number.isSafeInteger(scope.bindingRevision) || scope.bindingRevision < 0) {
    throw new Error('Memory binding revision must be a non-negative integer');
  }
  if ((scope.scopeKind === 'space') !== (scope.spaceId !== null)) {
    throw new Error('Memory space scope requires an id, and non-space scopes must not have one');
  }
}
