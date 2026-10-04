import { randomUUID } from 'node:crypto';
import { getDb } from '../../db.js';

export type WikiVectorBackfillScope = 'all' | 'prefix' | 'selected';
export type WikiVectorBackfillStatus =
  'queued' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'cancelled';

export interface WikiVectorBackfillJob {
  id: string;
  scope: WikiVectorBackfillScope;
  prefix: string | null;
  paths: string[];
  status: WikiVectorBackfillStatus;
  total: number;
  processed: number;
  indexed: number;
  skipped: number;
  failed: number;
  currentPath: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

interface WikiVectorBackfillRow {
  id: string;
  scope: WikiVectorBackfillScope;
  prefix: string | null;
  paths_json: string;
  status: WikiVectorBackfillStatus;
  total: number;
  processed: number;
  indexed: number;
  skipped: number;
  failed: number;
  current_path: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

const now = (): string => new Date().toISOString();

function parsePaths(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function toJob(row: WikiVectorBackfillRow): WikiVectorBackfillJob {
  return {
    id: row.id,
    scope: row.scope,
    prefix: row.prefix,
    paths: parsePaths(row.paths_json),
    status: row.status,
    total: row.total,
    processed: row.processed,
    indexed: row.indexed,
    skipped: row.skipped,
    failed: row.failed,
    currentPath: row.current_path,
    error: row.error,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 创建一个持久化向量回填任务。 */
export function createJob(
  scope: WikiVectorBackfillScope,
  prefix: string | null,
  paths: string[],
): WikiVectorBackfillJob {
  const id = randomUUID();
  const timestamp = now();
  getDb()
    .prepare(
      `
    INSERT INTO wiki_vector_backfill_jobs (id, scope, prefix, paths_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', ?, ?)
  `,
    )
    .run(id, scope, prefix, JSON.stringify(paths), timestamp, timestamp);
  return getRequiredJob(id);
}

/** 获取向量回填任务。 */
export function getJob(id: string): WikiVectorBackfillJob | undefined {
  const row = getDb()
    .prepare<[string], WikiVectorBackfillRow>(
      'SELECT * FROM wiki_vector_backfill_jobs WHERE id = ?',
    )
    .get(id);
  return row ? toJob(row) : undefined;
}

/** 获取不存在任务时抛出统一错误。 */
export function getRequiredJob(id: string): WikiVectorBackfillJob {
  const job = getJob(id);
  if (!job) throw new Error('向量回填任务不存在或已过期');
  return job;
}

/** 更新向量回填任务进度。 */
export function updateJob(
  id: string,
  updates: Partial<Omit<WikiVectorBackfillJob, 'id' | 'scope' | 'prefix' | 'paths' | 'createdAt'>>,
): WikiVectorBackfillJob {
  const current = getRequiredJob(id);
  const next = { ...current, ...updates };
  getDb()
    .prepare(
      `
    UPDATE wiki_vector_backfill_jobs SET
      status = ?, total = ?, processed = ?, indexed = ?, skipped = ?, failed = ?,
      current_path = ?, error = ?, attempts = ?, updated_at = ?
    WHERE id = ?
  `,
    )
    .run(
      next.status,
      next.total,
      next.processed,
      next.indexed,
      next.skipped,
      next.failed,
      next.currentPath,
      next.error,
      next.attempts,
      now(),
      id,
    );
  return getRequiredJob(id);
}

/** 返回最近的向量回填任务。 */
export function listJobs(limit = 20): WikiVectorBackfillJob[] {
  const rows = getDb()
    .prepare<[number], WikiVectorBackfillRow>(
      'SELECT * FROM wiki_vector_backfill_jobs ORDER BY updated_at DESC LIMIT ?',
    )
    .all(Math.max(1, Math.min(limit, 100)));
  return rows.map(toJob);
}
