import { getDb } from '../../db.js';
import type {
  CreateMemoryParams,
  Memory,
  MemoryCoreCandidate,
  MemoryEventInput,
  MemoryEventRecord,
  MemoryListFilters,
  MemoryScopeSnapshot,
  UpdateMemoryParams,
} from '../../domains/memory/index.js';

interface MemoryRow {
  id: string;
  content: string;
  category: string;
  memory_key: string;
  value_json: string | null;
  memory_type: string;
  subject: string;
  relationship: string | null;
  confidence: number;
  importance: number;
  valid_from: string | null;
  valid_to: string | null;
  status: string;
  supersedes_id: string | null;
  source_message_id: string | null;
  source_created_at?: string | null;
  last_accessed_at: string | null;
  access_count: number;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
  context_policy?: string;
  policy_source?: string;
  scope_kind?: string;
  space_id?: string | null;
}

function toCamelCase(row: MemoryRow): Memory {
  let value: unknown = null;
  if (row.value_json) {
    try {
      value = JSON.parse(row.value_json);
    } catch {
      value = row.value_json;
    }
  }
  return {
    id: row.id,
    content: row.content,
    category: row.category,
    memoryKey: row.memory_key || 'general',
    value,
    memoryType: row.memory_type || 'semantic',
    subject: row.subject || 'user',
    relationship: row.relationship,
    confidence: row.confidence ?? 0.5,
    importance: row.importance ?? 0.5,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    status: row.status || 'active',
    supersedesId: row.supersedes_id,
    sourceMessageId: row.source_message_id,
    sourceCreatedAt: row.source_created_at ?? null,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count ?? 0,
    sourceConversationId: row.source_conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contextPolicy: row.context_policy as Memory['contextPolicy'],
    policySource: row.policy_source as Memory['policySource'],
    scopeKind: row.scope_kind as Memory['scopeKind'],
    spaceId: row.space_id ?? null,
  };
}

export function findAll(): Memory[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM memories ORDER BY updated_at DESC').all() as MemoryRow[];
  return rows.map(toCamelCase);
}

/** List memory facts for user management with explicit scope and policy filters. */
export function findManaged(filters: MemoryListFilters = {}): Memory[] {
  const clauses: string[] = [];
  const parameters: string[] = [];
  if (!filters.includeInactive) clauses.push("status = 'active'");
  if (filters.category) {
    clauses.push('category = ?');
    parameters.push(filters.category);
  }
  if (filters.scopeKind) {
    clauses.push('scope_kind = ?');
    parameters.push(filters.scopeKind);
  }
  if (filters.spaceId) {
    clauses.push('space_id = ?');
    parameters.push(filters.spaceId);
  }
  if (filters.contextPolicy) {
    clauses.push('context_policy = ?');
    parameters.push(filters.contextPolicy);
  }
  if (!filters.includeUnassigned && filters.scopeKind !== 'unassigned') {
    clauses.push("scope_kind != 'unassigned'");
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM memories ${where} ORDER BY updated_at DESC, id ASC`)
    .all(...parameters) as MemoryRow[];
  return rows.map(toCamelCase);
}

export function findById(id: string): Memory | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
  return row ? toCamelCase(row) : null;
}

/** Return existing memory rows for a validated batch of stable IDs. */
export function findByIds(ids: string[]): Memory[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`SELECT * FROM memories WHERE id IN (${placeholders})`)
    .all(...ids) as MemoryRow[];
  return rows.map(toCamelCase);
}

/** Verify a memory can be written or recalled into an active knowledge space. */
export function isMemorySpaceActive(spaceId: string): boolean {
  return Boolean(
    getDb()
      .prepare('SELECT id FROM memory_spaces WHERE id = ? AND archived_at IS NULL')
      .get(spaceId),
  );
}

/** Find eligible core facts from global and current-space scopes with source evidence. */
export function findCoreCandidates(
  scope: MemoryScopeSnapshot,
  now: string,
  limit = 100,
): MemoryCoreCandidate[] {
  if (scope.scopeKind === 'unassigned') return [];
  const db = getDb();
  const includeSpace =
    scope.scopeKind === 'space' &&
    Boolean(
      db
        .prepare('SELECT id FROM memory_spaces WHERE id = ? AND archived_at IS NULL')
        .get(scope.spaceId),
    );
  const scopeClause = includeSpace
    ? "(memory.scope_kind = 'global' OR (memory.scope_kind = 'space' AND memory.space_id = ?))"
    : "(memory.scope_kind = 'global' AND memory.space_id IS NULL)";
  const params: Array<string | number> = [now, now];
  if (includeSpace) params.push(scope.spaceId!);
  params.push(Math.max(1, Math.floor(limit)));
  const rows = db
    .prepare(
      `SELECT memory.*, source.role AS source_role, source.content AS source_content,
              source.created_at AS source_created_at
       FROM memories AS memory
       LEFT JOIN messages AS source ON source.id = memory.source_message_id
       WHERE memory.status = 'active' AND memory.context_policy = 'core'
         AND (memory.valid_from IS NULL OR memory.valid_from <= ?)
         AND (memory.valid_to IS NULL OR memory.valid_to > ?)
         AND ${scopeClause}
       ORDER BY memory.importance DESC, memory.updated_at DESC, memory.id ASC
       LIMIT ?`,
    )
    .all(...params) as Array<
    MemoryRow & {
      source_role: string | null;
      source_content: string | null;
      source_created_at: string | null;
    }
  >;
  return rows.map((row) => ({
    memory: toCamelCase(row),
    sourceRole: row.source_role,
    sourceContent: row.source_content,
  }));
}

/** Increment usage statistics only for facts actually included in context. */
export function recordAccess(memoryIds: string[], accessedAt: string): void {
  if (memoryIds.length === 0) return;
  const placeholders = memoryIds.map(() => '?').join(', ');
  getDb()
    .prepare(
      `UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1
       WHERE status = 'active' AND id IN (${placeholders})`,
    )
    .run(accessedAt, ...memoryIds);
}

/** Return source text only for a persisted user message. */
export function findUserSourceText(messageId: string | null | undefined): string | null {
  if (!messageId) return null;
  const row = getDb()
    .prepare("SELECT content FROM messages WHERE id = ? AND role = 'user'")
    .get(messageId) as { content: string } | undefined;
  return row?.content ?? null;
}

export function findByCategory(category: string): Memory[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM memories WHERE category = ? AND status <> 'deleted' ORDER BY updated_at DESC",
    )
    .all(category) as MemoryRow[];
  return rows.map(toCamelCase);
}

export function findByContent(content: string): Memory | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM memories WHERE content = ? AND status <> 'deleted' LIMIT 1")
    .get(content) as MemoryRow | undefined;
  return row ? toCamelCase(row) : null;
}

export function create(params: CreateMemoryParams): Memory {
  const db = getDb();
  const now = new Date().toISOString();
  const category = params.category || 'general';
  db.prepare(
    `
    INSERT INTO memories (
      id, content, category, memory_key, value_json, memory_type, subject,
      relationship, confidence, importance, valid_from, valid_to, status,
      supersedes_id, source_message_id, source_conversation_id, created_at, updated_at,
      context_policy, policy_source, scope_kind, space_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    params.id,
    params.content,
    category,
    params.memoryKey || 'general',
    params.value === undefined ? null : JSON.stringify(params.value),
    params.memoryType || 'semantic',
    params.subject || 'user',
    params.relationship || null,
    params.confidence ?? 0.5,
    params.importance ?? 0.5,
    params.validFrom || null,
    params.validTo || null,
    params.status || 'active',
    params.supersedesId || null,
    params.sourceMessageId || null,
    params.sourceConversationId || null,
    now,
    now,
    params.contextPolicy || 'retrievable',
    params.policySource || 'user',
    params.scopeKind || 'global',
    params.spaceId || null,
  );
  return {
    id: params.id,
    content: params.content,
    category,
    memoryKey: params.memoryKey || 'general',
    value: params.value ?? null,
    memoryType: params.memoryType || 'semantic',
    subject: params.subject || 'user',
    relationship: params.relationship || null,
    confidence: params.confidence ?? 0.5,
    importance: params.importance ?? 0.5,
    validFrom: params.validFrom || null,
    validTo: params.validTo || null,
    status: params.status || 'active',
    supersedesId: params.supersedesId || null,
    sourceMessageId: params.sourceMessageId || null,
    lastAccessedAt: null,
    accessCount: 0,
    sourceConversationId: params.sourceConversationId || null,
    createdAt: now,
    updatedAt: now,
    contextPolicy: params.contextPolicy || 'retrievable',
    policySource: params.policySource || 'user',
    scopeKind: params.scopeKind || 'global',
    spaceId: params.spaceId || null,
  };
}

export function update(id: string, params: UpdateMemoryParams): Memory | null {
  const db = getDb();
  const now = new Date().toISOString();
  const setClauses: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (params.content !== undefined) {
    setClauses.push('content = ?');
    values.push(params.content);
  }
  if (params.category !== undefined) {
    setClauses.push('category = ?');
    values.push(params.category);
  }
  const fields: Array<[string, unknown]> = [
    ['memory_key', params.memoryKey],
    ['value_json', params.value === undefined ? undefined : JSON.stringify(params.value)],
    ['memory_type', params.memoryType],
    ['subject', params.subject],
    ['relationship', params.relationship],
    ['confidence', params.confidence],
    ['importance', params.importance],
    ['valid_from', params.validFrom],
    ['valid_to', params.validTo],
    ['status', params.status],
    ['supersedes_id', params.supersedesId],
    ['source_message_id', params.sourceMessageId],
    ['context_policy', params.contextPolicy],
    ['policy_source', params.policySource],
    ['scope_kind', params.scopeKind],
    ['space_id', params.spaceId],
  ];
  for (const [field, value] of fields) {
    if (value !== undefined) {
      setClauses.push(`${field} = ?`);
      values.push(value);
    }
  }

  values.push(id);
  const result = db
    .prepare(`UPDATE memories SET ${setClauses.join(', ')} WHERE id = ?`)
    .run(...values);
  if (result.changes === 0) return null;
  return findById(id);
}

export function deleteById(id: string): { changes: number } {
  const db = getDb();
  return db.prepare('DELETE FROM memories WHERE id = ?').run(id);
}

/** 在单个 SQLite 事务中执行记忆状态和审计事件更新。 */
export function withTransaction<T>(work: () => T): T {
  const transaction = getDb().transaction(work);
  return transaction();
}

/** 写入不包含记忆正文的操作摘要。 */
export function createEvent(input: MemoryEventInput): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `
    INSERT INTO memory_events (
      id, job_id, conversation_id, source_message_id, action, memory_key, subject,
      candidate_ids_json, result_memory_id, superseded_ids_json, status, error_code, created_at,
      scope_kind, space_id, binding_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      input.id,
      input.jobId || null,
      input.conversationId || null,
      input.sourceMessageId || null,
      input.action,
      input.memoryKey,
      input.subject,
      JSON.stringify(input.candidateIds || []),
      input.resultMemoryId || null,
      JSON.stringify(input.supersededIds || []),
      input.status,
      input.errorCode || null,
      now,
      input.scopeKind || 'unassigned',
      input.spaceId || null,
      input.bindingRevision ?? 0,
    );
}

/** 读取会话的记忆操作摘要，供审计和测试使用。 */
export function findEventsByConversationId(conversationId: string): MemoryEventRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM memory_events WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId) as Array<{
    id: string;
    job_id: string | null;
    conversation_id: string | null;
    source_message_id: string | null;
    scope_kind: MemoryEventRecord['scopeKind'];
    space_id: string | null;
    binding_revision: number;
    action: string;
    memory_key: string;
    subject: string;
    candidate_ids_json: string;
    result_memory_id: string | null;
    superseded_ids_json: string;
    status: MemoryEventInput['status'];
    error_code: string | null;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    conversationId: row.conversation_id,
    scopeKind: row.scope_kind,
    spaceId: row.space_id,
    bindingRevision: row.binding_revision,
    sourceMessageId: row.source_message_id,
    action: row.action,
    memoryKey: row.memory_key,
    subject: row.subject,
    candidateIds: JSON.parse(row.candidate_ids_json) as string[],
    resultMemoryId: row.result_memory_id,
    supersededIds: JSON.parse(row.superseded_ids_json) as string[],
    status: row.status,
    errorCode: row.error_code,
    createdAt: row.created_at,
  }));
}

/** 查找同一记忆键和主体下的当前有效事实。 */
export function findActiveByKey(
  memoryKey: string,
  subject = 'user',
  scopeKind: 'global' | 'space' = 'global',
  spaceId: string | null = null,
): Memory[] {
  if ((scopeKind === 'space') !== (spaceId !== null)) {
    throw new Error('Memory key lookup scope is invalid');
  }
  const rows = getDb()
    .prepare(
      "SELECT * FROM memories WHERE memory_key = ? AND subject = ? AND status = 'active' AND scope_kind = ? AND space_id IS ? ORDER BY updated_at DESC",
    )
    .all(memoryKey, subject, scopeKind, spaceId) as MemoryRow[];
  return rows.map(toCamelCase);
}

/** 按关键词检索当前有效记忆，并限制返回数量。 */
export function search(query: string, limit = 8): Memory[] {
  const normalized = query.trim();
  if (!normalized) return [];
  const terms = normalized.split(/\s+/).filter(Boolean).slice(0, 8);
  const conditions = terms
    .map(() => '(content LIKE ? OR memory_key LIKE ? OR subject LIKE ?)')
    .join(' AND ');
  const args = terms.flatMap((term) => [`%${term}%`, `%${term}%`, `%${term}%`]);
  const rows = getDb()
    .prepare(
      `SELECT * FROM memories WHERE status = 'active' AND (${conditions}) ORDER BY importance DESC, updated_at DESC LIMIT ?`,
    )
    .all(...args, Math.max(1, Math.min(limit, 50))) as MemoryRow[];
  return rows.map(toCamelCase);
}

/** 读取高重要性的 active 画像记忆。 */
export function findActiveProfile(limit = 24): Memory[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM memories WHERE status = 'active' AND memory_type = 'semantic' ORDER BY importance DESC, updated_at DESC LIMIT ?",
    )
    .all(Math.max(1, Math.min(limit, 100))) as MemoryRow[];
  return rows.map(toCamelCase);
}

/** 将旧事实标记为已被新事实替代。 */
export function supersede(id: string, _supersededBy: string): void {
  getDb()
    .prepare(
      "UPDATE memories SET status = 'superseded', valid_to = ?, updated_at = ? WHERE id = ? AND status = 'active'",
    )
    .run(new Date().toISOString(), new Date().toISOString(), id);
}
