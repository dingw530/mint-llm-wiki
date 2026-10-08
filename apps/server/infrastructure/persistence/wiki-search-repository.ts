import { createHash } from 'node:crypto';
import { getDb } from '../../db.js';

export interface WikiSearchDocumentInput {
  id: string;
  pageId: string | null;
  sourcePath: string;
  title: string;
  heading: string;
  body: string;
  documentType: 'chunk' | 'claim';
  contentHash: string;
}

export interface WikiSearchDocument {
  id: string;
  pageId: string | null;
  sourcePath: string;
  title: string;
  heading: string;
  body: string;
  documentType: 'chunk' | 'claim';
  contentHash: string;
  rank: number;
}

export interface WikiSearchIndexChange {
  changedDocuments: WikiSearchDocumentInput[];
  removedDocumentIds: string[];
}

interface WikiSearchDocumentRow {
  id: string;
  page_id: string | null;
  source_path: string;
  title: string;
  heading: string;
  body: string;
  document_type: WikiSearchDocument['documentType'];
  content_hash: string;
  rank: number | null;
}

interface ExistingSearchDocument {
  id: string;
  content_hash: string;
}

const now = (): string => new Date().toISOString();

function mapDocument(row: WikiSearchDocumentRow): WikiSearchDocument {
  return {
    id: row.id,
    pageId: row.page_id ?? null,
    sourcePath: row.source_path,
    title: row.title,
    heading: row.heading,
    body: row.body,
    documentType: row.document_type,
    contentHash: row.content_hash,
    rank: Number(row.rank ?? 0),
  };
}

/** 将文本规范化为稳定 hash，供索引幂等更新使用。 */
export function hashSearchContent(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 替换一个页面的搜索文档，并返回需要重新生成向量的文档。 */
export function replacePageDocuments(
  path: string,
  documents: WikiSearchDocumentInput[],
): WikiSearchIndexChange {
  const db = getDb();
  const replace = db.transaction(() => {
    const oldRows = db
      .prepare<unknown[], ExistingSearchDocument>(
        'SELECT id, content_hash FROM wiki_search_documents WHERE source_path = ?',
      )
      .all(path);
    const oldById = new Map(oldRows.map((row) => [row.id, row]));
    const incomingIds = new Set(documents.map((document) => document.id));
    const removedDocumentIds = oldRows
      .filter((row) => !incomingIds.has(row.id))
      .map((row) => row.id);
    for (const documentId of removedDocumentIds) {
      db.prepare('DELETE FROM wiki_search_documents_fts WHERE document_id = ?').run(documentId);
      db.prepare('DELETE FROM wiki_search_documents WHERE id = ?').run(documentId);
    }

    const writeDocument = createDocumentWriter(db);
    const changedDocuments: WikiSearchDocumentInput[] = [];
    for (const document of documents) {
      if (oldById.get(document.id)?.content_hash !== document.contentHash)
        changedDocuments.push(document);
      writeDocument(document);
    }
    return { changedDocuments, removedDocumentIds };
  });
  return replace();
}

/** Bind one document writer inside the caller-owned replacement transaction. */
function createDocumentWriter(
  db: ReturnType<typeof getDb>,
): (document: WikiSearchDocumentInput) => void {
  const update = db.prepare(`UPDATE wiki_search_documents SET
    page_id = ?, source_path = ?, title = ?, heading = ?, body = ?, document_type = ?, content_hash = ?, updated_at = ?
    WHERE id = ?`);
  const insert = db.prepare(`INSERT INTO wiki_search_documents
    (id, page_id, source_path, title, heading, body, document_type, content_hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const deleteFts = db.prepare('DELETE FROM wiki_search_documents_fts WHERE document_id = ?');
  const insertFts = db.prepare(`INSERT INTO wiki_search_documents_fts
    (title, heading, body, source_path, document_id)
    VALUES (?, ?, ?, ?, ?)`);
  return function writeDocument(document: WikiSearchDocumentInput): void {
    deleteFts.run(document.id);
    const updated = update.run(
      document.pageId,
      document.sourcePath,
      document.title,
      document.heading,
      document.body,
      document.documentType,
      document.contentHash,
      now(),
      document.id,
    );
    if (updated.changes === 0) {
      insert.run(
        document.id,
        document.pageId,
        document.sourcePath,
        document.title,
        document.heading,
        document.body,
        document.documentType,
        document.contentHash,
        now(),
      );
    }
    insertFts.run(
      document.title,
      document.heading,
      document.body,
      document.sourcePath,
      document.id,
    );
  };
}

/** 清理全量重建后已不存在于当前 Wiki 文件集的搜索文档和向量。 */
export function removeStaleSearchDocuments(activeSourcePaths: string[]): number {
  const active = new Set(activeSourcePaths);
  const db = getDb();
  const stale = db
    .prepare<unknown[], { id: string; sourcePath: string }>(
      'SELECT id, source_path AS sourcePath FROM wiki_search_documents',
    )
    .all();
  const staleIds = stale.filter((row) => !active.has(row.sourcePath)).map((row) => row.id);
  if (staleIds.length === 0) return 0;
  const remove = db.transaction(() => {
    for (const documentId of staleIds) {
      db.prepare('DELETE FROM wiki_search_documents_fts WHERE document_id = ?').run(documentId);
      db.prepare('DELETE FROM wiki_search_documents WHERE id = ?').run(documentId);
    }
  });
  remove();
  return staleIds.length;
}

/** 返回索引是否为空。 */
export function hasSearchDocuments(): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM wiki_search_documents LIMIT 1').get());
}

/** 判断指定 Wiki 页面路径是否已经建立索引。 */
export function hasSearchDocumentsForPath(path: string): boolean {
  return Boolean(
    getDb().prepare('SELECT 1 FROM wiki_search_documents WHERE source_path = ? LIMIT 1').get(path),
  );
}

/** 返回可供向量回填使用的搜索文档，保持文档内容与 FTS 索引一致。 */
export function listSearchDocuments(sourcePaths?: string[]): WikiSearchDocument[] {
  const db = getDb();
  const rows =
    sourcePaths && sourcePaths.length > 0
      ? db
          .prepare<unknown[], WikiSearchDocumentRow>(
            `SELECT d.*, 0 AS rank FROM wiki_search_documents d WHERE d.source_path IN (${sourcePaths.map(() => '?').join(',')}) ORDER BY d.source_path, d.id`,
          )
          .all(...sourcePaths)
      : db
          .prepare<unknown[], WikiSearchDocumentRow>(
            'SELECT d.*, 0 AS rank FROM wiki_search_documents d ORDER BY d.source_path, d.id',
          )
          .all();
  return rows.map(mapDocument);
}

/** 对 FTS 查询执行安全的 OR 召回。 */
export function searchDocuments(query: string, limit: number): WikiSearchDocument[] {
  const terms = query.match(/[A-Za-z0-9_]+|[\u4e00-\u9fff]{2,}/g) ?? [];
  const uniqueTerms = [...new Set(terms.map((term) => term.trim()).filter(Boolean))].slice(0, 24);
  if (uniqueTerms.length === 0) return [];
  const match = uniqueTerms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
  const rows = getDb()
    .prepare<unknown[], WikiSearchDocumentRow>(
      `
    SELECT d.*, bm25(wiki_search_documents_fts, 8.0, 6.0, 2.0, 1.0, 0.0) AS rank
    FROM wiki_search_documents_fts f
    JOIN wiki_search_documents d ON d.id = f.document_id
    WHERE wiki_search_documents_fts MATCH ?
    ORDER BY rank ASC
    LIMIT ?
  `,
    )
    .all(match, Math.max(1, Math.min(limit, 100)));
  return rows.map(mapDocument);
}
