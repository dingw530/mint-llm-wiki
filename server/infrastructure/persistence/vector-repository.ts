import { getDb } from '../../db.js';
import type { WikiSearchDocument, WikiSearchDocumentInput } from './wiki-search-repository.js';
import type { VectorStore } from '../search/vector/ports.js';
import type {
  VectorEmbeddingState,
  VectorHealth,
  VectorIndexConfig,
  VectorSearchHit,
} from '../search/vector/types.js';

interface VectorDocumentRow {
  id: string;
  page_id: string | null;
  source_path: string;
  title: string;
  heading: string;
  body: string;
  document_type: WikiSearchDocument['documentType'];
  content_hash: string;
  distance: number;
}

const now = (): string => new Date().toISOString();

function hasVectorStorage(): boolean {
  const row = getDb()
    .prepare<[], { available: number }>(
      `
    SELECT 1 AS available
    FROM sqlite_master
    WHERE type = 'table' AND name IN ('wiki_embeddings', 'wiki_search_vectors')
    GROUP BY type
    HAVING COUNT(*) = 2
  `,
    )
    .get();
  return Boolean(row?.available);
}

function vectorBuffer(vector: number[]): Buffer {
  const values = new Float32Array(vector);
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

function mapVectorDocument(row: VectorDocumentRow): WikiSearchDocumentInput {
  return {
    id: row.id,
    pageId: row.page_id ?? null,
    sourcePath: row.source_path,
    title: row.title,
    heading: row.heading,
    body: row.body,
    documentType: row.document_type,
    contentHash: row.content_hash,
  };
}

/** Returns the current vector metadata for a document, if vector storage is available. */
export async function getState(documentId: string): Promise<VectorEmbeddingState | null> {
  if (!hasVectorStorage()) return null;
  const row = getDb()
    .prepare<[string], VectorEmbeddingState>(
      `
    SELECT id, model, dimensions, content_hash AS contentHash
    FROM wiki_embeddings WHERE document_id = ?
  `,
    )
    .get(documentId);
  return row ?? null;
}

/** Writes or replaces a document vector and its model metadata transactionally. */
export async function upsert(
  document: WikiSearchDocumentInput,
  vector: number[],
  config: VectorIndexConfig,
): Promise<void> {
  if (!hasVectorStorage()) throw new Error('sqlite-vec vector storage is unavailable');
  if (vector.length !== config.dimensions)
    throw new Error(`Embedding dimension mismatch: expected ${config.dimensions}`);
  const db = getDb();
  const save = db.transaction(() => {
    const existing = db
      .prepare<[string], { id: number }>('SELECT id FROM wiki_embeddings WHERE document_id = ?')
      .get(document.id);
    const id =
      existing?.id ??
      Number(
        db
          .prepare(
            `
      INSERT INTO wiki_embeddings (document_id, model, dimensions, content_hash, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `,
          )
          .run(document.id, config.model, config.dimensions, document.contentHash, now())
          .lastInsertRowid,
      );
    if (existing) {
      db.prepare(
        `UPDATE wiki_embeddings
        SET model = ?, dimensions = ?, content_hash = ?, updated_at = ?
        WHERE id = CAST(? AS INTEGER)`,
      ).run(config.model, config.dimensions, document.contentHash, now(), id);
      db.prepare('DELETE FROM wiki_search_vectors WHERE rowid = CAST(? AS INTEGER)').run(id);
    }
    db.prepare(
      'INSERT INTO wiki_search_vectors (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)',
    ).run(id, vectorBuffer(vector));
  });
  save();
  clearFailure(document.id);
}

/** Records a document-level indexing failure for health reporting and retry. */
export async function recordFailure(
  document: Pick<WikiSearchDocumentInput, 'id' | 'sourcePath'>,
  error: string,
): Promise<void> {
  getDb()
    .prepare(
      `
    INSERT INTO wiki_vector_index_failures (document_id, source_path, error, attempts, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(document_id) DO UPDATE SET
      source_path = excluded.source_path,
      error = excluded.error,
      attempts = wiki_vector_index_failures.attempts + 1,
      updated_at = excluded.updated_at
  `,
    )
    .run(document.id, document.sourcePath, error, now());
}

function clearFailure(documentId: string): void {
  getDb().prepare('DELETE FROM wiki_vector_index_failures WHERE document_id = ?').run(documentId);
}

/** Removes a document vector and its associated metadata. */
export async function remove(documentId: string): Promise<void> {
  if (!hasVectorStorage()) return;
  const db = getDb();
  const row = db
    .prepare<[string], { id: number }>('SELECT id FROM wiki_embeddings WHERE document_id = ?')
    .get(documentId);
  if (!row) return;
  db.prepare('DELETE FROM wiki_search_vectors WHERE rowid = CAST(? AS INTEGER)').run(row.id);
  db.prepare('DELETE FROM wiki_embeddings WHERE id = CAST(? AS INTEGER)').run(row.id);
  clearFailure(documentId);
}

/** Searches the current model/dimension vectors and excludes stale document hashes. */
export async function search(
  queryVector: number[],
  config: VectorIndexConfig,
  limit: number,
): Promise<VectorSearchHit<WikiSearchDocumentInput>[]> {
  if (!hasVectorStorage()) return [];
  const rows = getDb()
    .prepare<[Buffer, number, string, number], VectorDocumentRow>(
      `
    SELECT d.*, v.distance
    FROM wiki_search_vectors v
    JOIN wiki_embeddings e ON e.id = v.rowid
    JOIN wiki_search_documents d ON d.id = e.document_id
    WHERE v.embedding MATCH ?
      AND v.k = ?
      AND e.model = ?
      AND e.dimensions = ?
      AND e.content_hash = d.content_hash
    ORDER BY v.distance ASC
  `,
    )
    .all(
      vectorBuffer(queryVector),
      Math.max(1, Math.min(limit, 100)),
      config.model,
      config.dimensions,
    );
  return rows.map((row) => ({ document: mapVectorDocument(row), distance: Number(row.distance) }));
}

/** Returns health metrics for the configured vector index. */
export async function getHealth(config: VectorIndexConfig): Promise<VectorHealth> {
  const db = getDb();
  const documentCount = countSearchDocuments();
  if (!hasVectorStorage()) {
    const failed = db
      .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM wiki_vector_index_failures')
      .get();
    if (!failed) throw new Error('Failed to count vector indexing errors');
    return {
      documentCount,
      vectorizedCount: 0,
      pendingCount: documentCount,
      failedCount: Number(failed.count),
      orphanCount: 0,
      coverage: 0,
      model: config.model,
      dimensions: config.dimensions,
      lastIndexedAt: null,
    };
  }
  const vectorized = db
    .prepare<[string, number], { count: number }>(
      `
    SELECT COUNT(*) AS count
    FROM wiki_embeddings e
    JOIN wiki_search_documents d ON d.id = e.document_id
    JOIN wiki_search_vectors v ON v.rowid = e.id
    WHERE e.model = ? AND e.dimensions = ? AND e.content_hash = d.content_hash
  `,
    )
    .get(config.model, config.dimensions);
  const failed = db
    .prepare<[], { count: number }>(
      'SELECT COUNT(*) AS count FROM wiki_vector_index_failures f JOIN wiki_search_documents d ON d.id = f.document_id',
    )
    .get();
  const orphan = db
    .prepare<[], { count: number }>(
      `
    SELECT COUNT(*) AS count
    FROM wiki_search_vectors v
    LEFT JOIN wiki_embeddings e ON e.id = v.rowid
    LEFT JOIN wiki_search_documents d ON d.id = e.document_id
    WHERE e.id IS NULL OR d.id IS NULL
  `,
    )
    .get();
  const last = db
    .prepare<[string, number], { updatedAt: string | null }>(
      `
    SELECT MAX(e.updated_at) AS updatedAt
    FROM wiki_embeddings e
    JOIN wiki_search_documents d ON d.id = e.document_id
    JOIN wiki_search_vectors v ON v.rowid = e.id
    WHERE e.model = ? AND e.dimensions = ? AND e.content_hash = d.content_hash
  `,
    )
    .get(config.model, config.dimensions);
  if (!vectorized || !failed || !orphan || !last)
    throw new Error('Failed to read vector indexing health');
  const vectorizedCount = Number(vectorized.count);
  return {
    documentCount,
    vectorizedCount,
    pendingCount: Math.max(0, documentCount - vectorizedCount),
    failedCount: Number(failed.count),
    orphanCount: Number(orphan.count),
    coverage: documentCount === 0 ? 1 : vectorizedCount / documentCount,
    model: config.model,
    dimensions: config.dimensions,
    lastIndexedAt: last.updatedAt ?? null,
  };
}

function countSearchDocuments(): number {
  const row = getDb()
    .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM wiki_search_documents')
    .get();
  if (!row) throw new Error('Failed to count Wiki search documents');
  return row.count;
}

/** Deletes vector rows that no longer have a corresponding search document. */
export async function pruneOrphans(): Promise<number> {
  if (!hasVectorStorage()) return 0;
  const db = getDb();
  const rows = db
    .prepare<[], { rowid: number }>(
      `
    SELECT v.rowid AS rowid
    FROM wiki_search_vectors v
    LEFT JOIN wiki_embeddings e ON e.id = v.rowid
    LEFT JOIN wiki_search_documents d ON d.id = e.document_id
    WHERE e.id IS NULL OR d.id IS NULL
  `,
    )
    .all();
  const remove = db.transaction(() => {
    for (const row of rows) {
      db.prepare('DELETE FROM wiki_search_vectors WHERE rowid = CAST(? AS INTEGER)').run(row.rowid);
      db.prepare('DELETE FROM wiki_embeddings WHERE id = CAST(? AS INTEGER)').run(row.rowid);
    }
  });
  remove();
  return rows.length;
}

/** The default local VectorStore implementation backed by SQLite and sqlite-vec. */
export const sqliteVectorStore: VectorStore<WikiSearchDocumentInput> = {
  getState,
  upsert,
  remove,
  search,
  recordFailure,
  getHealth,
  pruneOrphans,
};
