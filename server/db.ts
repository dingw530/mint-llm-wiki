import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import type DatabaseConstructor from 'better-sqlite3';
import os from 'node:os';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrations/index.js';
import { getLoadablePath as getSqliteVecLoadablePath } from 'sqlite-vec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Electron and Node.js use different native-module ABIs, so IPC must load
// the Electron-local copy while server and Vitest keep using the Node copy.
const Database = require(
  process.versions.electron
    ? process.env.MINT_ELECTRON_BETTER_SQLITE3_PATH || 'better-sqlite3'
    : 'better-sqlite3',
) as typeof DatabaseConstructor;

// 数据库路径：可通过环境变量覆盖（测试隔离），默认项目根目录
const DB_PATH: string = process.env.AI_CHAT_DB_PATH || path.join(os.homedir(), '.mint', 'data.db');

let db: DatabaseConstructor.Database | undefined;
let vectorExtensionLoaded = false;

/**
 * Resolves the sqlite-vec dynamic library to a path SQLite can load.
 * @returns {string} A filesystem path to the sqlite-vec extension.
 */
function getSqliteVecExtensionPath(): string {
  const extensionPath = getSqliteVecLoadablePath();

  if (!process.versions.electron) return extensionPath;

  const asarSegment = `${path.sep}app.asar${path.sep}`;
  const unpackedSegment = `${path.sep}app.asar.unpacked${path.sep}`;
  return extensionPath.replace(asarSegment, unpackedSegment);
}

/** 返回 sqlite-vec 是否已成功加载，供关键词模式保持可用。 */
export function isVectorExtensionLoaded(): boolean {
  return vectorExtensionLoaded;
}

// 获取数据库单例：延迟初始化，首次调用时自动建表、迁移、种子数据
export function getDb(): DatabaseConstructor.Database {
  if (!db) {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const initializingDb = new Database(DB_PATH);
    db = initializingDb;
    try {
      initializingDb.pragma('journal_mode = WAL'); // WAL 模式提升并发读写性能
      initializingDb.pragma('foreign_keys = ON'); // 启用外键约束
      initializingDb.pragma('busy_timeout = 5000'); // 索引重建与生命周期写入并发时短暂等待写锁
      initializingDb.loadExtension(getSqliteVecExtensionPath());
      vectorExtensionLoaded = true;
    } catch (error) {
      vectorExtensionLoaded = false;
      console.warn(
        '[db] sqlite-vec unavailable; keyword search remains enabled:',
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      createSchema();
      runMigrations(initializingDb);
      seedData();
    } catch (error) {
      initializingDb.close();
      db = undefined;
      vectorExtensionLoaded = false;
      throw error;
    }
  }
  return db;
}

/** Close the process-owned database handle after all workers stop. */
export function closeDb(): void {
  if (!db) return;
  db.close();
  db = undefined;
  vectorExtensionLoaded = false;
}

// ── 阶段一：Schema 定义 ──
// 完整的当前表结构（含所有后续迁移加的列），新数据库通过此处一次性建齐
function createSchema(): void {
  db!.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      type TEXT NOT NULL DEFAULT 'text',
      locked_agent TEXT,
      routing_mode TEXT NOT NULL DEFAULT 'auto',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      reasoning TEXT,
      image_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_ui_blocks (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      block_index INTEGER NOT NULL,
      kind TEXT NOT NULL,
      version INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(message_id, block_index),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_message_ui_blocks_message
      ON message_ui_blocks(message_id, block_index);

    CREATE TABLE IF NOT EXISTS a2ui_component_registry (
      kind TEXT PRIMARY KEY,
      catalog_id TEXT NOT NULL,
      component_name TEXT NOT NULL,
      data_schema_version INTEGER NOT NULL,
      data_schema TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      command TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '[]',
      env TEXT NOT NULL DEFAULT '{}',
      url TEXT,
      headers TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'inactive',
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'custom',
      system_prompt TEXT,
      mcp_server_ids TEXT NOT NULL DEFAULT '[]',
      available INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      trigger_keywords TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      memory_key TEXT NOT NULL DEFAULT 'general',
      value_json TEXT,
      memory_type TEXT NOT NULL DEFAULT 'semantic',
      subject TEXT NOT NULL DEFAULT 'user',
      relationship TEXT,
      confidence REAL NOT NULL DEFAULT 0.5,
      importance REAL NOT NULL DEFAULT 0.5,
      valid_from TEXT,
      valid_to TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      supersedes_id TEXT,
      source_message_id TEXT,
      last_accessed_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      source_conversation_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_processing_jobs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL,
      locked_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_jobs_status_available
      ON memory_processing_jobs(status, available_at);

    CREATE TABLE IF NOT EXISTS routing_logs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      message_id TEXT,
      agent_id TEXT NOT NULL,
      confidence REAL NOT NULL,
      method TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      message_preview TEXT,
      locked_agent TEXT,
      routing_mode TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_endpoints (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      api_url TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL,
      api_type TEXT NOT NULL DEFAULT 'openai-chat',
      category TEXT NOT NULL DEFAULT 'text',
      verified_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      source_file TEXT,
      properties TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      target_id TEXT NOT NULL,
      properties TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'auto-extracted', 'ai-generated')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (source_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wiki_sources (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'unknown',
      status TEXT NOT NULL DEFAULT 'ingested',
      authority REAL NOT NULL DEFAULT 0.5,
      published_at TEXT,
      ingested_at TEXT NOT NULL,
      superseded_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(path, content_hash)
    );

    CREATE TABLE IF NOT EXISTS wiki_pages (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      source_id TEXT,
      supersedes_id TEXT,
      quality_score REAL NOT NULL DEFAULT 0.5,
      confidence REAL NOT NULL DEFAULT 0.5,
      importance REAL NOT NULL DEFAULT 0.5,
      last_confirmed_at TEXT,
      last_accessed_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(path, content_hash),
      FOREIGN KEY (source_id) REFERENCES wiki_sources(id) ON DELETE SET NULL,
      FOREIGN KEY (supersedes_id) REFERENCES wiki_pages(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS wiki_claims (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      claim_text TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      confidence REAL NOT NULL DEFAULT 0.5,
      importance REAL NOT NULL DEFAULT 0.5,
      support_count INTEGER NOT NULL DEFAULT 1,
      valid_from TEXT,
      valid_to TEXT,
      last_confirmed_at TEXT,
      last_accessed_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      supersedes_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (page_id) REFERENCES wiki_pages(id) ON DELETE CASCADE,
      FOREIGN KEY (supersedes_id) REFERENCES wiki_claims(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS wiki_knowledge_events (
      id TEXT PRIMARY KEY,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      delta REAL,
      source_id TEXT,
      source_page TEXT,
      reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES wiki_sources(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS wiki_lifecycle_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      available_at TEXT NOT NULL,
      locked_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_wiki_sources_path_status
      ON wiki_sources(path, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wiki_pages_status_updated
      ON wiki_pages(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wiki_claims_key_status
      ON wiki_claims(normalized_key, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wiki_events_object
      ON wiki_knowledge_events(object_type, object_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wiki_lifecycle_jobs_status_available
      ON wiki_lifecycle_jobs(status, available_at);

    CREATE TABLE IF NOT EXISTS wiki_search_documents (
      id TEXT PRIMARY KEY,
      page_id TEXT,
      source_path TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      heading TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      document_type TEXT NOT NULL CHECK(document_type IN ('chunk', 'claim')),
      content_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (page_id) REFERENCES wiki_pages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wiki_search_documents_page
      ON wiki_search_documents(source_path, updated_at DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_search_documents_fts USING fts5(
      title, heading, body, source_path,
      document_id UNINDEXED
    );
    CREATE TABLE IF NOT EXISTS wiki_vector_index_failures (
      document_id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      error TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES wiki_search_documents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS wiki_vector_backfill_jobs (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('all', 'prefix', 'selected')),
      prefix TEXT,
      paths_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'partial_failed', 'failed', 'cancelled')),
      total INTEGER NOT NULL DEFAULT 0,
      processed INTEGER NOT NULL DEFAULT 0,
      indexed INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      current_path TEXT,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wiki_vector_backfill_jobs_updated
      ON wiki_vector_backfill_jobs(updated_at DESC);
  `);
}

// ── 阶段三：种子数据 ──
// 内置 Agent 记录，用 INSERT OR IGNORE + UPDATE 保持幂等
function seedData(): void {
  const now = new Date().toISOString();

  const upsertAgent = db!.prepare(`
    INSERT OR IGNORE INTO agents (id, name, description, type, system_prompt, mcp_server_ids, available, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  upsertAgent.run('general', '通用助手', '通用 AI 对话助手', 'general', null, '[]', 1, now, now);

  db!
    .prepare(
      `
    INSERT OR IGNORE INTO a2ui_component_registry
      (kind, catalog_id, component_name, data_schema_version, data_schema, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run('wiki_source_reference', 'mint', 'SourceReferenceCard', 1, '{}', 1, now, now);

  // 确保内置 Agent 的名称始终最新（当旧 DB 已存在时，INSERT OR IGNORE 不会更新名称）
  db!
    .prepare('UPDATE agents SET name = ? WHERE id = ? AND name != ?')
    .run('通用助手', 'general', '通用助手');
  db!
    .prepare(
      'UPDATE agents SET trigger_keywords = ? WHERE id = ? AND (trigger_keywords IS NULL OR trigger_keywords = ?)',
    )
    .run('[]', 'general', '[]');
}
