import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';

export type WikiIngestionCommitPhase =
  | 'compiling'
  | 'prepared'
  | 'source_finalized'
  | 'pages_written'
  | 'lifecycle_registered'
  | 'search_indexed'
  | 'manifest_written'
  | 'committed';

export interface WikiIngestionCommit {
  commitId: string;
  jobId: string;
  itemKey: string;
  wikiPath: string;
  stagedSourcePath: string;
  sourcePath: string;
  snapshot: unknown | null;
  result: unknown | null;
  phase: WikiIngestionCommitPhase;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WikiIngestionCommitRow {
  commit_id: string;
  job_id: string;
  item_key: string;
  wiki_path: string;
  staged_source_path: string;
  source_path: string;
  snapshot_json: string | null;
  result_json: string | null;
  phase: WikiIngestionCommitPhase;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const PHASE_ORDER: WikiIngestionCommitPhase[] = [
  'compiling',
  'prepared',
  'source_finalized',
  'pages_written',
  'lifecycle_registered',
  'search_indexed',
  'manifest_written',
  'committed',
];

function parseJson(value: string | null): unknown | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error('摄入提交记录包含无效 JSON', { cause: error });
  }
}

function toCommit(row: WikiIngestionCommitRow): WikiIngestionCommit {
  return {
    commitId: row.commit_id,
    jobId: row.job_id,
    itemKey: row.item_key,
    wikiPath: row.wiki_path,
    stagedSourcePath: row.staged_source_path,
    sourcePath: row.source_path,
    snapshot: parseJson(row.snapshot_json),
    result: parseJson(row.result_json),
    phase: row.phase,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Create or return the stable commit identity for one durable ingestion job item. */
export function createOrGetWikiIngestionCommit(input: {
  jobId: string;
  itemKey: string;
  wikiPath: string;
  stagedSourcePath: string;
  sourcePath: string;
}): WikiIngestionCommit {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT OR IGNORE INTO wiki_ingestion_commits (
      commit_id, job_id, item_key, wiki_path, staged_source_path,
      source_path, phase, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'compiling', ?, ?)
  `,
  ).run(
    randomUUID(),
    input.jobId,
    input.itemKey,
    input.wikiPath,
    input.stagedSourcePath,
    input.sourcePath,
    now,
    now,
  );

  const row = db
    .prepare(
      `
    SELECT * FROM wiki_ingestion_commits WHERE job_id = ? AND item_key = ?
  `,
    )
    .get(input.jobId, input.itemKey) as WikiIngestionCommitRow | undefined;
  if (!row) throw new Error('无法创建 Wiki 摄入提交记录');
  if (
    row.wiki_path !== input.wikiPath ||
    row.staged_source_path !== input.stagedSourcePath ||
    row.source_path !== input.sourcePath
  ) {
    throw new Error('Wiki 摄入提交记录与当前作业输入不匹配');
  }
  return toCommit(row);
}

/** Find the durable commit record for one job item. */
export function getWikiIngestionCommit(
  jobId: string,
  itemKey: string,
): WikiIngestionCommit | undefined {
  const row = getDb()
    .prepare(
      `
    SELECT * FROM wiki_ingestion_commits WHERE job_id = ? AND item_key = ?
  `,
    )
    .get(jobId, itemKey) as WikiIngestionCommitRow | undefined;
  return row ? toCommit(row) : undefined;
}

/** List durable commit records for one job, including their staged input snapshots. */
export function listWikiIngestionCommits(jobId: string): WikiIngestionCommit[] {
  const rows = getDb()
    .prepare('SELECT * FROM wiki_ingestion_commits WHERE job_id = ? ORDER BY item_key ASC')
    .all(jobId) as WikiIngestionCommitRow[];
  return rows.map(toCommit);
}

/** Find a durable commit by its stable commit identity. */
export function getWikiIngestionCommitById(commitId: string): WikiIngestionCommit | undefined {
  const row = getDb()
    .prepare('SELECT * FROM wiki_ingestion_commits WHERE commit_id = ?')
    .get(commitId) as WikiIngestionCommitRow | undefined;
  return row ? toCommit(row) : undefined;
}

/** Persist the compiler output once so commit recovery never needs to call the LLM again. */
export function saveWikiIngestionSnapshot(
  commitId: string,
  snapshot: unknown,
): WikiIngestionCommit {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE wiki_ingestion_commits
    SET snapshot_json = COALESCE(snapshot_json, ?), phase = 'prepared', updated_at = ?, last_error = NULL
    WHERE commit_id = ? AND phase IN ('compiling', 'prepared')
  `,
  ).run(JSON.stringify(snapshot), now, commitId);
  const row = db
    .prepare('SELECT * FROM wiki_ingestion_commits WHERE commit_id = ?')
    .get(commitId) as WikiIngestionCommitRow | undefined;
  if (!row) throw new Error('Wiki 摄入提交记录不存在');
  if (!row.snapshot_json) throw new Error('Wiki 摄入编译快照保存失败');
  return toCommit(row);
}

/** Advance a commit checkpoint without allowing a stale worker to move it backwards. */
export function advanceWikiIngestionCommit(
  commitId: string,
  phase: WikiIngestionCommitPhase,
  updates: { result?: unknown; lastError?: string | null } = {},
): WikiIngestionCommit {
  const db = getDb();
  const transaction = db.transaction(() => {
    const row = db
      .prepare('SELECT * FROM wiki_ingestion_commits WHERE commit_id = ?')
      .get(commitId) as WikiIngestionCommitRow | undefined;
    if (!row) throw new Error('Wiki 摄入提交记录不存在');
    if (phaseIndex(phase) < phaseIndex(row.phase)) return toCommit(row);

    db.prepare(
      `
      UPDATE wiki_ingestion_commits
      SET phase = ?, result_json = COALESCE(?, result_json), last_error = ?, updated_at = ?
      WHERE commit_id = ?
    `,
    ).run(
      phase,
      updates.result === undefined ? null : JSON.stringify(updates.result),
      updates.lastError === undefined ? null : updates.lastError,
      new Date().toISOString(),
      commitId,
    );
    const updated = db
      .prepare('SELECT * FROM wiki_ingestion_commits WHERE commit_id = ?')
      .get(commitId) as WikiIngestionCommitRow;
    return toCommit(updated);
  });
  return transaction.immediate();
}

/** Record a recoverable processing error without discarding the durable snapshot. */
export function setWikiIngestionCommitError(commitId: string, message: string): void {
  getDb()
    .prepare(
      `
    UPDATE wiki_ingestion_commits SET last_error = ?, updated_at = ? WHERE commit_id = ?
  `,
    )
    .run(message, new Date().toISOString(), commitId);
}

function phaseIndex(phase: WikiIngestionCommitPhase): number {
  return PHASE_ORDER.indexOf(phase);
}
