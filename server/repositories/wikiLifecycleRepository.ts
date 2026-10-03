import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';

export type WikiSourceStatus = 'ingested' | 'compiled' | 'superseded' | 'quarantined';
export type WikiPageStatus = 'draft' | 'active' | 'stale' | 'archived' | 'superseded' | 'deleted';
export type WikiClaimStatus =
  'proposed' | 'verified' | 'contested' | 'superseded' | 'expired' | 'deleted';
export type WikiLifecycleObjectType = 'source' | 'page' | 'claim';

export interface WikiSource {
  id: string;
  path: string;
  contentHash: string;
  sourceType: string;
  status: WikiSourceStatus;
  authority: number;
  publishedAt: string | null;
  ingestedAt: string;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WikiPage {
  id: string;
  path: string;
  title: string;
  contentHash: string;
  version: number;
  status: WikiPageStatus;
  sourceId: string | null;
  supersedesId: string | null;
  qualityScore: number;
  confidence: number;
  importance: number;
  lastConfirmedAt: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WikiClaim {
  id: string;
  pageId: string;
  claimText: string;
  normalizedKey: string;
  status: WikiClaimStatus;
  confidence: number;
  importance: number;
  supportCount: number;
  validFrom: string | null;
  validTo: string | null;
  lastConfirmedAt: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WikiKnowledgeEvent {
  id: string;
  objectType: WikiLifecycleObjectType;
  objectId: string;
  eventType: string;
  delta: number | null;
  sourceId: string | null;
  sourcePage: string | null;
  reason: string | null;
  createdAt: string;
}

interface WikiSourceRow {
  id: string;
  path: string;
  content_hash: string;
  source_type: string;
  status: WikiSourceStatus;
  authority: number;
  published_at: string | null;
  ingested_at: string;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}
interface WikiPageRow {
  id: string;
  path: string;
  title: string;
  content_hash: string;
  version: number;
  status: WikiPageStatus;
  source_id: string | null;
  supersedes_id: string | null;
  quality_score: number;
  confidence: number;
  importance: number;
  last_confirmed_at: string | null;
  last_accessed_at: string | null;
  access_count: number;
  created_at: string;
  updated_at: string;
}
interface WikiClaimRow {
  id: string;
  page_id: string;
  claim_text: string;
  normalized_key: string;
  status: WikiClaimStatus;
  confidence: number;
  importance: number;
  support_count: number;
  valid_from: string | null;
  valid_to: string | null;
  last_confirmed_at: string | null;
  last_accessed_at: string | null;
  access_count: number;
  supersedes_id: string | null;
  created_at: string;
  updated_at: string;
}

const now = (): string => new Date().toISOString();
const mapSource = (row: WikiSourceRow): WikiSource => ({
  id: row.id,
  path: row.path,
  contentHash: row.content_hash,
  sourceType: row.source_type,
  status: row.status,
  authority: row.authority,
  publishedAt: row.published_at,
  ingestedAt: row.ingested_at,
  supersededBy: row.superseded_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const mapPage = (row: WikiPageRow): WikiPage => ({
  id: row.id,
  path: row.path,
  title: row.title,
  contentHash: row.content_hash,
  version: row.version,
  status: row.status,
  sourceId: row.source_id,
  supersedesId: row.supersedes_id,
  qualityScore: row.quality_score,
  confidence: row.confidence,
  importance: row.importance,
  lastConfirmedAt: row.last_confirmed_at,
  lastAccessedAt: row.last_accessed_at,
  accessCount: row.access_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const mapClaim = (row: WikiClaimRow): WikiClaim => ({
  id: row.id,
  pageId: row.page_id,
  claimText: row.claim_text,
  normalizedKey: row.normalized_key,
  status: row.status,
  confidence: row.confidence,
  importance: row.importance,
  supportCount: row.support_count,
  validFrom: row.valid_from,
  validTo: row.valid_to,
  lastConfirmedAt: row.last_confirmed_at,
  lastAccessedAt: row.last_accessed_at,
  accessCount: row.access_count,
  supersedesId: row.supersedes_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** 查找相同路径和内容 hash 的 Source，保证重复摄入幂等。 */
export function findSourceByHash(path: string, contentHash: string): WikiSource | null {
  const row = getDb()
    .prepare<unknown[], WikiSourceRow>(
      'SELECT * FROM wiki_sources WHERE path = ? AND content_hash = ?',
    )
    .get(path, contentHash);
  return row ? mapSource(row) : null;
}

/** 查询同一路径下最新的 Source 版本。 */
export function findLatestSource(path: string): WikiSource | null {
  const row = getDb()
    .prepare<unknown[], WikiSourceRow>(
      'SELECT * FROM wiki_sources WHERE path = ? ORDER BY ingested_at DESC LIMIT 1',
    )
    .get(path);
  return row ? mapSource(row) : null;
}

/** 创建一条不可变 Source 版本记录。 */
export function createSource(
  input: Pick<WikiSource, 'path' | 'contentHash' | 'sourceType'> &
    Partial<Pick<WikiSource, 'authority' | 'publishedAt'>>,
): WikiSource {
  const timestamp = now();
  const id = uuidv4();
  getDb()
    .prepare(
      `INSERT INTO wiki_sources
    (id,path,content_hash,source_type,status,authority,published_at,ingested_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.path,
      input.contentHash,
      input.sourceType,
      'ingested',
      input.authority ?? 0.5,
      input.publishedAt ?? null,
      timestamp,
      timestamp,
      timestamp,
    );
  return mapSource(
    getDb().prepare<unknown[], WikiSourceRow>('SELECT * FROM wiki_sources WHERE id = ?').get(id)!,
  );
}

/** 将 Source 标记为已完成编译。 */
export function markSourceCompiled(id: string): WikiSource {
  getDb()
    .prepare("UPDATE wiki_sources SET status='compiled', updated_at=? WHERE id=?")
    .run(now(), id);
  return mapSource(
    getDb().prepare<unknown[], WikiSourceRow>('SELECT * FROM wiki_sources WHERE id = ?').get(id)!,
  );
}

/** 标记旧 Source 已被新版本替代。 */
export function supersedeSource(id: string, replacementId: string): WikiSource {
  getDb()
    .prepare(
      "UPDATE wiki_sources SET status='superseded', superseded_by=?, updated_at=? WHERE id=?",
    )
    .run(replacementId, now(), id);
  return mapSource(
    getDb().prepare<unknown[], WikiSourceRow>('SELECT * FROM wiki_sources WHERE id = ?').get(id)!,
  );
}

/** 查找页面的最新版本。 */
export function findLatestPage(path: string): WikiPage | null {
  const row = getDb()
    .prepare<unknown[], WikiPageRow>(
      'SELECT * FROM wiki_pages WHERE path = ? ORDER BY version DESC LIMIT 1',
    )
    .get(path);
  return row ? mapPage(row) : null;
}

/** 根据 Wiki 相对路径读取页面生命周期记录。 */
export function findPageByPath(path: string): WikiPage | null {
  const row = getDb()
    .prepare<unknown[], WikiPageRow>(
      'SELECT * FROM wiki_pages WHERE path = ? ORDER BY version DESC LIMIT 1',
    )
    .get(path);
  return row ? mapPage(row) : null;
}

/** 根据页面 ID 查询最新生命周期记录。 */
export function findPageById(id: string): WikiPage | null {
  const row = getDb()
    .prepare<unknown[], WikiPageRow>('SELECT * FROM wiki_pages WHERE id = ?')
    .get(id);
  return row ? mapPage(row) : null;
}

/** 查询页面下仍可用于检索的 Claim。 */
export function findActiveClaimsForPage(pageId: string): WikiClaim[] {
  const rows = getDb()
    .prepare<unknown[], WikiClaimRow>(
      "SELECT * FROM wiki_claims WHERE page_id = ? AND status IN ('proposed','verified','contested') ORDER BY confidence DESC, updated_at DESC",
    )
    .all(pageId);
  return rows.map(mapClaim);
}

/** 将生命周期信息转换为检索的轻量加权，避免热度压过文本相关性。 */
export function getSearchRelevanceBoost(page: WikiPage): number {
  const statusBoost = page.status === 'active' ? 1.2 : page.status === 'stale' ? -0.8 : 0;
  const confidenceBoost = Math.max(-0.5, Math.min(0.8, page.confidence - 0.5));
  const usageBoost = Math.min(0.5, Math.log1p(page.accessCount) * 0.08);
  return statusBoost + confidenceBoost + usageBoost;
}

/** 创建页面版本；相同 path/hash 已存在时返回既有版本。 */
export function createPage(
  input: Pick<WikiPage, 'path' | 'title' | 'contentHash'> &
    Partial<Pick<WikiPage, 'sourceId' | 'status' | 'confidence' | 'importance' | 'qualityScore'>>,
): WikiPage {
  const existing = getDb()
    .prepare<unknown[], WikiPageRow>('SELECT * FROM wiki_pages WHERE path = ? AND content_hash = ?')
    .get(input.path, input.contentHash);
  if (existing) return mapPage(existing);
  const previous = findLatestPage(input.path);
  const timestamp = now();
  const id = uuidv4();
  getDb()
    .prepare(
      `INSERT INTO wiki_pages
    (id,path,title,content_hash,version,status,source_id,supersedes_id,quality_score,confidence,importance,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.path,
      input.title,
      input.contentHash,
      (previous?.version ?? 0) + 1,
      input.status ?? 'draft',
      input.sourceId ?? null,
      previous?.id ?? null,
      input.qualityScore ?? 0.5,
      input.confidence ?? 0.5,
      input.importance ?? 0.5,
      timestamp,
      timestamp,
    );
  if (previous && previous.status !== 'superseded') {
    getDb()
      .prepare("UPDATE wiki_pages SET status='superseded', updated_at=? WHERE id=?")
      .run(timestamp, previous.id);
    recordEvent(
      'page',
      previous.id,
      'superseded',
      null,
      input.sourceId ?? null,
      input.path,
      'new page version created',
    );
  }
  return mapPage(
    getDb().prepare<unknown[], WikiPageRow>('SELECT * FROM wiki_pages WHERE id = ?').get(id)!,
  );
}

/** 创建 Claim；调用方负责在同一事务中执行去重和强化策略。 */
export function createClaim(
  input: Pick<WikiClaim, 'pageId' | 'claimText' | 'normalizedKey'> &
    Partial<Pick<WikiClaim, 'status' | 'confidence' | 'importance'>>,
): WikiClaim {
  const timestamp = now();
  const id = uuidv4();
  getDb()
    .prepare(
      `INSERT INTO wiki_claims
    (id,page_id,claim_text,normalized_key,status,confidence,importance,support_count,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.pageId,
      input.claimText,
      input.normalizedKey,
      input.status ?? 'proposed',
      input.confidence ?? 0.5,
      input.importance ?? 0.5,
      1,
      timestamp,
      timestamp,
    );
  return mapClaim(
    getDb().prepare<unknown[], WikiClaimRow>('SELECT * FROM wiki_claims WHERE id = ?').get(id)!,
  );
}

/** 强化既有 Claim，并更新时间和支持次数。 */
export function reinforceClaim(id: string, confidence: number): WikiClaim {
  const timestamp = now();
  getDb()
    .prepare(
      `UPDATE wiki_claims
    SET confidence=?, support_count=support_count+1, last_confirmed_at=?, updated_at=? WHERE id=?`,
    )
    .run(confidence, timestamp, timestamp, id);
  return mapClaim(
    getDb().prepare<unknown[], WikiClaimRow>('SELECT * FROM wiki_claims WHERE id = ?').get(id)!,
  );
}

/** 记录页面被检索命中的访问反馈。 */
export function touchPage(id: string): WikiPage {
  const timestamp = now();
  getDb()
    .prepare(
      'UPDATE wiki_pages SET last_accessed_at=?, access_count=access_count+1, updated_at=? WHERE id=?',
    )
    .run(timestamp, timestamp, id);
  return mapPage(
    getDb().prepare<unknown[], WikiPageRow>('SELECT * FROM wiki_pages WHERE id = ?').get(id)!,
  );
}

/** 查询需要生命周期评估的页面，限制单批数量避免阻塞正常 Wiki 操作。 */
export function listPagesForLifecycle(limit = 100): WikiPage[] {
  const rows = getDb()
    .prepare<unknown[], WikiPageRow>(
      "SELECT * FROM wiki_pages WHERE status IN ('active','stale') ORDER BY updated_at ASC LIMIT ?",
    )
    .all(Math.max(1, Math.min(limit, 500)));
  return rows.map(mapPage);
}

/** 查询用于热度看板的页面；保留全部生命周期状态供汇总展示。 */
export function listPagesForHeat(limit = 500): WikiPage[] {
  const rows = getDb()
    .prepare<unknown[], WikiPageRow>(
      'SELECT * FROM wiki_pages ORDER BY access_count DESC, updated_at DESC LIMIT ?',
    )
    .all(Math.max(1, Math.min(limit, 2000)));
  return rows.map(mapPage);
}

/** 更新页面生命周期状态。 */
export function updatePageStatus(id: string, status: WikiPageStatus): WikiPage {
  getDb().prepare('UPDATE wiki_pages SET status=?, updated_at=? WHERE id=?').run(status, now(), id);
  return mapPage(
    getDb().prepare<unknown[], WikiPageRow>('SELECT * FROM wiki_pages WHERE id = ?').get(id)!,
  );
}

/** 查询需要过期评估的 Claim。 */
export function listClaimsForLifecycle(limit = 200): WikiClaim[] {
  const rows = getDb()
    .prepare<unknown[], WikiClaimRow>(
      "SELECT * FROM wiki_claims WHERE status IN ('proposed','verified','contested') ORDER BY updated_at ASC LIMIT ?",
    )
    .all(Math.max(1, Math.min(limit, 1000)));
  return rows.map(mapClaim);
}

/** 将长期未确认 Claim 标记为 expired，保留原始证据。 */
export function expireClaim(id: string, validTo: string): WikiClaim {
  getDb()
    .prepare("UPDATE wiki_claims SET status='expired', valid_to=?, updated_at=? WHERE id=?")
    .run(validTo, validTo, id);
  return mapClaim(
    getDb().prepare<unknown[], WikiClaimRow>('SELECT * FROM wiki_claims WHERE id = ?').get(id)!,
  );
}

/** 查询当前有效的同键 Claim。 */
export function findActiveClaims(normalizedKey: string): WikiClaim[] {
  return getDb()
    .prepare<unknown[], WikiClaimRow>(
      "SELECT * FROM wiki_claims WHERE normalized_key=? AND status IN ('proposed','verified','contested') ORDER BY updated_at DESC",
    )
    .all(normalizedKey)
    .map(mapClaim);
}

/** 记录生命周期事件，事件写入与对象更新应由上层事务包裹。 */
export function recordEvent(
  objectType: WikiLifecycleObjectType,
  objectId: string,
  eventType: string,
  delta: number | null = null,
  sourceId: string | null = null,
  sourcePage: string | null = null,
  reason: string | null = null,
): WikiKnowledgeEvent {
  const event = {
    id: uuidv4(),
    objectType,
    objectId,
    eventType,
    delta,
    sourceId,
    sourcePage,
    reason,
    createdAt: now(),
  };
  getDb()
    .prepare(
      `INSERT INTO wiki_knowledge_events
    (id,object_type,object_id,event_type,delta,source_id,source_page,reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      event.id,
      objectType,
      objectId,
      eventType,
      delta,
      sourceId,
      sourcePage,
      reason,
      event.createdAt,
    );
  return event;
}

/** 在单一 SQLite 事务中提交生命周期状态变更。 */
export function transaction<T>(fn: () => T): T {
  // 注册流程会先查询旧版本再写入新版本；立即取得写锁可避免 WAL 下的
  // deferred transaction 在读快照后升级写锁时触发 SQLITE_BUSY_SNAPSHOT。
  return getDb().transaction(fn).immediate();
}
