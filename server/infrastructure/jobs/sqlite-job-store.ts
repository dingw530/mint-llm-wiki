import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db.js';
import type {
  WikiJob,
  WikiJobCreateOptions,
  WikiJobListFilter,
  WikiJobStatus,
  WikiJobUpdate,
} from '../../domains/wiki/index.js';

interface JobRow {
  id: string;
  source_type: 'upload' | 'chat';
  conversation_id: string | null;
  file_name: string;
  file_size: number;
  file_count: number;
  status: WikiJobStatus;
  progress: number;
  step: string;
  payload: string;
  result: string | null;
  error: string | null;
  attempts: number;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toJob(row: JobRow): WikiJob {
  return {
    id: row.id,
    status: row.status,
    fileName: row.file_name,
    fileSize: row.file_size,
    fileCount: row.file_count,
    progress: row.progress,
    step: row.step,
    result: parseJson(row.result, undefined),
    error: parseJson(row.error, undefined),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceType: row.source_type,
    conversationId: row.conversation_id,
    attempts: row.attempts,
    idempotencyKey: row.idempotency_key,
    ...getWikiJobStatusMeta(row.status),
  };
}

/** Project a persisted status into the legacy API fields stored with a job snapshot. */
function getWikiJobStatusMeta(
  status: WikiJobStatus,
): Pick<
  WikiJob,
  'statusLabel' | 'phase' | 'isTerminal' | 'isSuccessful' | 'canCancel' | 'canRetry'
> {
  if (status === 'completed' || status === 'done') {
    return {
      statusLabel: '已完成',
      phase: 'success',
      isTerminal: true,
      isSuccessful: true,
      canCancel: false,
      canRetry: false,
    };
  }
  if (status === 'failed' || status === 'error' || status === 'partial_failed') {
    return {
      statusLabel: status === 'partial_failed' ? '部分失败' : '处理失败',
      phase: 'error',
      isTerminal: true,
      isSuccessful: false,
      canCancel: false,
      canRetry: true,
    };
  }
  if (status === 'cancelled') {
    return {
      statusLabel: '已取消',
      phase: 'cancelled',
      isTerminal: true,
      isSuccessful: false,
      canCancel: false,
      canRetry: false,
    };
  }
  const labels: Partial<Record<WikiJobStatus, string>> = {
    pending: '等待处理',
    queued: '排队中',
    parsing: '解析资料中',
    compiling: 'AI 编译中',
    committing: '提交 Wiki 中',
  };
  return {
    statusLabel: labels[status] || '处理中',
    phase: 'active',
    isTerminal: false,
    isSuccessful: false,
    canCancel: true,
    canRetry: false,
  };
}

/** 创建 SQLite 持久化摄入任务。 */
export function createJob(
  fileName: string,
  fileSize: number,
  options: WikiJobCreateOptions = {},
): string {
  const db = getDb();
  const existing = options.idempotencyKey
    ? (db
        .prepare('SELECT id FROM ingestion_jobs WHERE idempotency_key = ?')
        .get(options.idempotencyKey) as { id: string } | undefined)
    : undefined;
  if (existing) return existing.id;

  const id = uuidv4();
  const now = new Date().toISOString();
  const initialStatus = options.sourceType || options.payload ? 'queued' : 'pending';
  db.prepare(
    `
    INSERT INTO ingestion_jobs (
      id, source_type, conversation_id, file_name, file_size, file_count,
      status, progress, step, payload, idempotency_key, available_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, '等待处理', ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    options.sourceType || 'upload',
    options.conversationId || null,
    fileName,
    fileSize,
    options.fileCount || 1,
    initialStatus,
    JSON.stringify(options.payload || {}),
    options.idempotencyKey || null,
    now,
    now,
    now,
  );
  return id;
}

/** 更新 SQLite 任务并同步更新时间。 */
export function updateJob(id: string, updates: WikiJobUpdate): WikiJob | undefined {
  const db = getDb();
  const current = getJob(id);
  if (!current) return undefined;
  const next = { ...current, ...updates };
  db.prepare(
    `
    UPDATE ingestion_jobs SET
      file_name = ?, status = ?, progress = ?, step = ?, result = ?, error = ?, updated_at = ?, locked_at = NULL
    WHERE id = ?
  `,
  ).run(
    next.fileName,
    next.status,
    next.progress,
    next.step,
    next.result === undefined ? null : JSON.stringify(next.result),
    next.error === undefined ? null : JSON.stringify(next.error),
    new Date().toISOString(),
    id,
  );
  return getJob(id);
}

/** 获取单个 SQLite 任务。 */
export function getJob(id: string): WikiJob | undefined {
  const row = getDb().prepare('SELECT * FROM ingestion_jobs WHERE id = ?').get(id) as
    JobRow | undefined;
  return row ? toJob(row) : undefined;
}

/** 按幂等键查询已存在的摄入任务。 */
export function getByIdempotencyKey(key: string): WikiJob | undefined {
  const row = getDb().prepare('SELECT * FROM ingestion_jobs WHERE idempotency_key = ?').get(key) as
    JobRow | undefined;
  return row ? toJob(row) : undefined;
}

/** 获取任务内部 payload。 */
export function getJobPayload(id: string): Record<string, unknown> {
  const row = getDb().prepare('SELECT payload FROM ingestion_jobs WHERE id = ?').get(id) as
    { payload: string } | undefined;
  return row ? parseJson(row.payload, {}) : {};
}

/** 按更新时间倒序查询 SQLite 任务。 */
export function listJobs(filter: WikiJobListFilter = {}): WikiJob[] {
  const limit = Math.max(1, Math.min(filter.limit || 100, 500));
  const rows = filter.status
    ? getDb()
        .prepare('SELECT * FROM ingestion_jobs WHERE status = ? ORDER BY updated_at DESC LIMIT ?')
        .all(filter.status, limit)
    : getDb().prepare('SELECT * FROM ingestion_jobs ORDER BY updated_at DESC LIMIT ?').all(limit);
  return (rows as JobRow[]).map(toJob);
}

/** 获取任务总数。 */
export function countJobs(status?: WikiJobStatus): number {
  const row = status
    ? getDb().prepare('SELECT COUNT(*) AS count FROM ingestion_jobs WHERE status = ?').get(status)
    : getDb().prepare('SELECT COUNT(*) AS count FROM ingestion_jobs').get();
  return Number((row as { count: number }).count);
}

/** 原子领取一个可执行任务。 */
export function claimNext(): WikiJob | undefined {
  const db = getDb();
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    const row = db
      .prepare(
        `
      SELECT * FROM ingestion_jobs
      WHERE status = 'queued' AND available_at <= ?
      ORDER BY created_at ASC LIMIT 1
    `,
      )
      .get(now) as JobRow | undefined;
    if (!row) return undefined;
    db.prepare(
      `
      UPDATE ingestion_jobs
      SET status = 'parsing', attempts = attempts + 1, locked_at = ?, updated_at = ?, step = '解析文件中'
      WHERE id = ? AND status = 'queued'
    `,
    ).run(now, now, row.id);
    return getJob(row.id);
  });
  return transaction();
}

/** 将进程重启时遗留的执行中任务恢复为排队状态。 */
export function recoverRunning(): number {
  const result = getDb()
    .prepare(
      `
    UPDATE ingestion_jobs
    SET status = 'queued', locked_at = NULL, step = '等待恢复', updated_at = ?
    WHERE status IN ('parsing', 'compiling', 'committing')
  `,
    )
    .run(new Date().toISOString());
  return result.changes;
}

/** 删除终态任务。 */
export function removeJob(id: string): boolean {
  const result = getDb()
    .prepare(
      `
    DELETE FROM ingestion_jobs
    WHERE id = ? AND status IN ('done', 'completed', 'partial_failed', 'error', 'failed', 'cancelled')
  `,
    )
    .run(id);
  return result.changes > 0;
}
