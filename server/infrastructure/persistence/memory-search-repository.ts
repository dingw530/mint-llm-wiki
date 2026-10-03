import { getDb } from '../../db.js';
import type {
  Memory,
  MemoryScopeSnapshot,
  MemorySearchCandidate,
  MemorySearchDocument,
} from '../../domains/memory/index.js';

interface MemorySearchRow {
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
  source_created_at: string | null;
  last_accessed_at: string | null;
  access_count: number;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
  context_policy: Memory['contextPolicy'];
  policy_source: Memory['policySource'];
  scope_kind: MemoryScopeSnapshot['scopeKind'];
  space_id: string | null;
  search_rank: number;
}

export class MemorySearchIndexUnavailableError extends Error {
  constructor(message = 'Memory search index is unavailable') {
    super(message);
    this.name = 'MemorySearchIndexUnavailableError';
  }
}

/** Read the active tokenizer version recorded by the index bootstrap. */
export function getTokenizerVersion(): number | null {
  const row = getDb()
    .prepare('SELECT tokenizer_version FROM memory_search_meta WHERE id = 1')
    .get() as { tokenizer_version: number } | undefined;
  return row?.tokenizer_version ?? null;
}

/** Verify that the FTS table is readable before declaring this index version available. */
export function verifyIndex(): void {
  getDb().prepare('SELECT memory_id FROM memory_search_documents_fts LIMIT 0').all();
}

/** Atomically replace all FTS projections and publish their tokenizer version. */
export function replaceAll(documents: MemorySearchDocument[], tokenizerVersion: number): void {
  const db = getDb();
  db.transaction(() => {
    db.exec('DELETE FROM memory_search_documents_fts');
    insertDocuments(documents);
    db.prepare(
      'UPDATE memory_search_meta SET tokenizer_version = ?, updated_at = ? WHERE id = 1',
    ).run(tokenizerVersion, new Date().toISOString());
  })();
}

/** Replace one memory's token projection inside the caller's transaction. */
export function upsertDocument(document: MemorySearchDocument): void {
  const db = getDb();
  db.prepare('DELETE FROM memory_search_documents_fts WHERE memory_id = ?').run(document.id);
  db.prepare(
    `INSERT INTO memory_search_documents_fts
      (memory_id, content_tokens, key_tokens, subject_tokens) VALUES (?, ?, ?, ?)`,
  ).run(document.id, document.contentTokens, document.keyTokens, document.subjectTokens);
}

/** Remove one FTS projection when its fact is physically deleted. */
export function deleteDocument(memoryId: string): void {
  getDb().prepare('DELETE FROM memory_search_documents_fts WHERE memory_id = ?').run(memoryId);
}

/** Search only active, valid global/current-space facts using a parameterized FTS expression. */
export function searchCandidates(
  expression: string,
  scope: MemoryScopeSnapshot,
  now: string,
  limit: number,
): MemorySearchCandidate[] {
  if (!expression || scope.scopeKind === 'unassigned') return [];
  const db = getDb();
  if (
    scope.scopeKind === 'space' &&
    !db
      .prepare('SELECT id FROM memory_spaces WHERE id = ? AND archived_at IS NULL')
      .get(scope.spaceId)
  ) {
    return [];
  }
  const scopeClause =
    scope.scopeKind === 'space'
      ? "(memory.scope_kind = 'global' OR (memory.scope_kind = 'space' AND memory.space_id = ?))"
      : "(memory.scope_kind = 'global' AND memory.space_id IS NULL)";
  const parameters: Array<string | number> = [expression, now, now];
  if (scope.scopeKind === 'space') parameters.push(scope.spaceId!);
  parameters.push(Math.max(1, Math.floor(limit)));
  try {
    const rows = db
      .prepare(
        `SELECT memory.*, source.created_at AS source_created_at,
                bm25(memory_search_documents_fts, 0.0, 5.0, 2.0, 1.0) AS search_rank
         FROM memory_search_documents_fts
         JOIN memories AS memory ON memory.id = memory_search_documents_fts.memory_id
         LEFT JOIN messages AS source ON source.id = memory.source_message_id
         WHERE memory_search_documents_fts MATCH ?
           AND memory.status = 'active'
           AND memory.context_policy = 'retrievable'
           AND (memory.valid_from IS NULL OR memory.valid_from <= ?)
           AND (memory.valid_to IS NULL OR memory.valid_to > ?)
           AND ${scopeClause}
         ORDER BY search_rank ASC, memory.importance DESC, memory.updated_at DESC, memory.id ASC
         LIMIT ?`,
      )
      .all(...parameters) as MemorySearchRow[];
    return rows.map(toCandidate);
  } catch (error) {
    throw new MemorySearchIndexUnavailableError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function insertDocuments(documents: MemorySearchDocument[]): void {
  const insert = getDb().prepare(
    `INSERT INTO memory_search_documents_fts
      (memory_id, content_tokens, key_tokens, subject_tokens) VALUES (?, ?, ?, ?)`,
  );
  for (const document of documents) {
    insert.run(document.id, document.contentTokens, document.keyTokens, document.subjectTokens);
  }
}

function toCandidate(row: MemorySearchRow): MemorySearchCandidate {
  let value: unknown = null;
  if (row.value_json) {
    try {
      value = JSON.parse(row.value_json);
    } catch {
      value = row.value_json;
    }
  }
  const memory: Memory = {
    id: row.id,
    content: row.content,
    category: row.category,
    memoryKey: row.memory_key,
    value,
    memoryType: row.memory_type,
    subject: row.subject,
    relationship: row.relationship,
    confidence: row.confidence,
    importance: row.importance,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    status: row.status,
    supersedesId: row.supersedes_id,
    sourceMessageId: row.source_message_id,
    sourceCreatedAt: row.source_created_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
    sourceConversationId: row.source_conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contextPolicy: row.context_policy,
    policySource: row.policy_source,
    scopeKind: row.scope_kind,
    spaceId: row.space_id,
  };
  return { ...memory, searchRank: row.search_rank };
}
