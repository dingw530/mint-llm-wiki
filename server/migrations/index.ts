import type Database from 'better-sqlite3';
import type { Migration } from './types.js';

// ── 迁移定义 ──
// 仅包含 ALTER TABLE 等结构性变更。CREATE TABLE IF NOT EXISTS 在 db.ts 的 createSchema() 中处理。
// 新数据库无需运行任何迁移（所有列已在 createSchema() 中完整定义），
// 迁移仅用于将旧数据库推进到当前 schema。

const migrations: Migration[] = [
  {
    id: 1,
    name: 'add-reasoning-to-messages',
    up: (db) => {
      db.exec('ALTER TABLE messages ADD COLUMN reasoning TEXT');
    },
  },
  {
    id: 2,
    name: 'add-locked-agent-to-conversations',
    up: (db) => {
      db.exec('ALTER TABLE conversations ADD COLUMN locked_agent TEXT');
    },
  },
  {
    id: 3,
    name: 'add-routing-mode-to-conversations',
    up: (db) => {
      db.exec("ALTER TABLE conversations ADD COLUMN routing_mode TEXT NOT NULL DEFAULT 'auto'");
    },
  },
  {
    id: 4,
    name: 'add-trigger-keywords-to-agents',
    up: (db) => {
      db.exec('ALTER TABLE agents ADD COLUMN trigger_keywords TEXT');
    },
  },
  {
    id: 5,
    name: 'add-api-type-to-model-endpoints',
    up: (db) => {
      db.exec(
        "ALTER TABLE model_endpoints ADD COLUMN api_type TEXT NOT NULL DEFAULT 'openai-chat'",
      );
    },
  },
  {
    id: 6,
    name: 'add-category-to-model-endpoints',
    up: (db) => {
      db.exec("ALTER TABLE model_endpoints ADD COLUMN category TEXT NOT NULL DEFAULT 'text'");
    },
  },
  {
    id: 7,
    name: 'add-type-to-conversations',
    up: (db) => {
      db.exec("ALTER TABLE conversations ADD COLUMN type TEXT NOT NULL DEFAULT 'text'");
    },
  },
  {
    id: 8,
    name: 'add-image-data-to-messages',
    up: (db) => {
      db.exec('ALTER TABLE messages ADD COLUMN image_data TEXT');
    },
  },
  {
    id: 9,
    name: 'add-graph-tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS graph_nodes (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('concept', 'practice', 'methodology')),
          source_file TEXT,
          properties TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`
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
        )
      `);
    },
  },
  {
    id: 10,
    name: 'allow-schema-category-graph-types',
    up: (db) => {
      db.pragma('foreign_keys = OFF');
      db.exec(`
        ALTER TABLE graph_edges RENAME TO graph_edges_legacy;
        ALTER TABLE graph_nodes RENAME TO graph_nodes_legacy;

        CREATE TABLE graph_nodes (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          type TEXT NOT NULL,
          source_file TEXT,
          properties TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO graph_nodes (id, label, type, source_file, properties, created_at, updated_at)
        SELECT id, label, type, source_file, properties, created_at, updated_at
        FROM graph_nodes_legacy;

        CREATE TABLE graph_edges (
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

        INSERT INTO graph_edges (id, source_id, relation, target_id, properties, source, created_at)
        SELECT id, source_id, relation, target_id, properties, source, created_at
        FROM graph_edges_legacy;

        DROP TABLE graph_edges_legacy;
        DROP TABLE graph_nodes_legacy;
      `);
      db.pragma('foreign_keys = ON');
    },
  },
  {
    id: 11,
    name: 'deduplicate-graph-edges',
    up: (db) => {
      db.exec(`
        DELETE FROM graph_edges
        WHERE source = 'auto-extracted'
          AND relation = 'references'
          AND EXISTS (
            SELECT 1 FROM graph_edges semantic
            WHERE semantic.source_id = graph_edges.source_id
              AND semantic.target_id = graph_edges.target_id
              AND semantic.relation <> 'references'
          );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_edges_triple
          ON graph_edges(source_id, relation, target_id);
      `);
    },
  },
  {
    id: 12,
    name: 'sync-graph-types-with-page-categories',
    up: (db) => {
      db.exec(`
        UPDATE graph_nodes
        SET type = substr(source_file, 7, instr(substr(source_file, 7), '/') - 1)
        WHERE source_file LIKE 'pages/%/%'
          AND instr(substr(source_file, 7), '/') > 1;
      `);
    },
  },
  {
    id: 13,
    name: 'apply-graph-edge-quality-rules',
    up: (db) => {
      db.exec(`
        DELETE FROM graph_edges AS reference_edge
        WHERE reference_edge.relation = 'references'
          AND EXISTS (
            SELECT 1 FROM graph_edges AS semantic_edge
            WHERE semantic_edge.relation <> 'references'
              AND (
                (semantic_edge.source_id = reference_edge.source_id AND semantic_edge.target_id = reference_edge.target_id)
                OR (semantic_edge.source_id = reference_edge.target_id AND semantic_edge.target_id = reference_edge.source_id)
              )
          );

        DELETE FROM graph_edges AS duplicate
        WHERE duplicate.relation = 'references'
          AND EXISTS (
            SELECT 1 FROM graph_edges AS retained
            WHERE retained.relation = 'references'
              AND retained.source_id = duplicate.target_id
              AND retained.target_id = duplicate.source_id
              AND (
                retained.created_at < duplicate.created_at
                OR (retained.created_at = duplicate.created_at AND retained.id < duplicate.id)
              )
          );

        DELETE FROM graph_edges
        WHERE id IN (
          SELECT id FROM (
            SELECT
              id,
              ROW_NUMBER() OVER (
                PARTITION BY
                  CASE WHEN source_id < target_id THEN source_id ELSE target_id END,
                  CASE WHEN source_id < target_id THEN target_id ELSE source_id END
                ORDER BY
                  CASE relation
                    WHEN '包含' THEN 100 WHEN '属于' THEN 100 WHEN '定义' THEN 95
                    WHEN '导致' THEN 90 WHEN '应对' THEN 90 WHEN '约束' THEN 90
                    WHEN '基于' THEN 85 WHEN '应用于' THEN 85 WHEN '案例' THEN 85
                    WHEN '提供' THEN 80 WHEN '实现' THEN 80 WHEN '支持' THEN 80
                    WHEN '区别于' THEN 75 WHEN '演进到' THEN 75 WHEN '演化自' THEN 75
                    ELSE 0
                  END DESC,
                  COALESCE(json_extract(properties, '$.confidence'), 0.55) DESC,
                  created_at ASC,
                  id ASC
              ) AS relation_rank
            FROM graph_edges
            WHERE relation <> 'references'
          )
          WHERE relation_rank > 1
        );

        UPDATE graph_edges
        SET properties = json_set(
          COALESCE(properties, '{}'),
          '$.strength', 'weak',
          '$.confidence', 0.25,
          '$.evidence', '页面关联链接'
        )
        WHERE relation = 'references';

        UPDATE graph_edges
        SET properties = json_set(
          COALESCE(properties, '{}'),
          '$.strength', 'semantic',
          '$.confidence', COALESCE(json_extract(properties, '$.confidence'), 0.55),
          '$.evidence', COALESCE(json_extract(properties, '$.evidence'), json_extract(properties, '$.reason'), '历史边缺少原文摘录'),
          '$.evidenceType', COALESCE(json_extract(properties, '$.evidenceType'), 'generated_rationale'),
          '$.sourceFile', (SELECT source_file FROM graph_nodes WHERE id = graph_edges.source_id)
        )
        WHERE relation <> 'references';
      `);
    },
  },
  {
    id: 14,
    name: 'add-graph-edge-candidates',
    up: (db) => {
      db.exec(`CREATE TABLE graph_edge_candidates (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
        relation TEXT NOT NULL, evidence TEXT NOT NULL, confidence REAL NOT NULL,
        candidate_score REAL NOT NULL, source_page TEXT NOT NULL, target_page TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','expired')),
        review_note TEXT, created_at TEXT NOT NULL, reviewed_at TEXT,
        FOREIGN KEY(source_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
        FOREIGN KEY(target_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
      ); CREATE INDEX idx_graph_edge_candidates_status ON graph_edge_candidates(status, created_at);`);
    },
  },
  {
    id: 15,
    name: 'add-ingestion-jobs',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ingestion_jobs (
          id TEXT PRIMARY KEY,
          source_type TEXT NOT NULL DEFAULT 'upload' CHECK(source_type IN ('upload', 'chat')),
          conversation_id TEXT,
          file_name TEXT NOT NULL,
          file_size INTEGER NOT NULL DEFAULT 0,
          file_count INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'queued',
          progress INTEGER NOT NULL DEFAULT 0,
          step TEXT NOT NULL DEFAULT '等待处理',
          payload TEXT NOT NULL DEFAULT '{}',
          result TEXT,
          error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          idempotency_key TEXT,
          available_at TEXT NOT NULL,
          locked_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status_updated
          ON ingestion_jobs(status, updated_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_jobs_idempotency
          ON ingestion_jobs(idempotency_key)
          WHERE idempotency_key IS NOT NULL;
      `);
    },
  },
  {
    id: 16,
    name: 'repair-ingestion-jobs-table',
    up: (db) => {
      // 15 可能在旧版本中已登记但进程曾在 DDL 后异常退出；保持迁移可重入。
      db.exec(`
        CREATE TABLE IF NOT EXISTS ingestion_jobs (
          id TEXT PRIMARY KEY,
          source_type TEXT NOT NULL DEFAULT 'upload' CHECK(source_type IN ('upload', 'chat')),
          conversation_id TEXT,
          file_name TEXT NOT NULL,
          file_size INTEGER NOT NULL DEFAULT 0,
          file_count INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'queued',
          progress INTEGER NOT NULL DEFAULT 0,
          step TEXT NOT NULL DEFAULT '等待处理',
          payload TEXT NOT NULL DEFAULT '{}',
          result TEXT,
          error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          idempotency_key TEXT,
          available_at TEXT NOT NULL,
          locked_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status_updated
          ON ingestion_jobs(status, updated_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_jobs_idempotency
          ON ingestion_jobs(idempotency_key)
          WHERE idempotency_key IS NOT NULL;
      `);
    },
  },
  {
    id: 17,
    name: 'add-url-transport-to-mcp-servers',
    up: (db) => {
      db.exec('ALTER TABLE mcp_servers ADD COLUMN url TEXT');
      db.exec("ALTER TABLE mcp_servers ADD COLUMN headers TEXT NOT NULL DEFAULT '{}'");
    },
  },
  {
    id: 18,
    name: 'add-structured-memory-fields',
    up: (db) => {
      const columns = [
        ['memory_key', "TEXT NOT NULL DEFAULT 'general'"],
        ['value_json', 'TEXT'],
        ['memory_type', "TEXT NOT NULL DEFAULT 'semantic'"],
        ['subject', "TEXT NOT NULL DEFAULT 'user'"],
        ['relationship', 'TEXT'],
        ['confidence', 'REAL NOT NULL DEFAULT 0.5'],
        ['importance', 'REAL NOT NULL DEFAULT 0.5'],
        ['valid_from', 'TEXT'],
        ['valid_to', 'TEXT'],
        ['status', "TEXT NOT NULL DEFAULT 'active'"],
        ['supersedes_id', 'TEXT'],
        ['source_message_id', 'TEXT'],
        ['last_accessed_at', 'TEXT'],
        ['access_count', 'INTEGER NOT NULL DEFAULT 0'],
      ];
      for (const [name, definition] of columns) {
        try {
          db.exec(`ALTER TABLE memories ADD COLUMN ${name} ${definition}`);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes('duplicate column')) throw error;
        }
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_memories_active_key_subject
          ON memories(status, memory_key, subject, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_category_status
          ON memories(category, status, updated_at DESC);
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
      `);
    },
  },
  {
    id: 19,
    name: 'retire-weather-agent',
    up: (db) => {
      db.prepare(
        "UPDATE conversations SET locked_agent = NULL WHERE locked_agent = 'weather'",
      ).run();
      db.prepare("DELETE FROM agents WHERE id = 'weather'").run();
    },
  },
  {
    id: 20,
    name: 'add-wiki-knowledge-lifecycle-tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS wiki_sources (
          id TEXT PRIMARY KEY, path TEXT NOT NULL, content_hash TEXT NOT NULL,
          source_type TEXT NOT NULL DEFAULT 'unknown', status TEXT NOT NULL DEFAULT 'ingested',
          authority REAL NOT NULL DEFAULT 0.5, published_at TEXT, ingested_at TEXT NOT NULL,
          superseded_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          UNIQUE(path, content_hash)
        );
        CREATE TABLE IF NOT EXISTS wiki_pages (
          id TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, content_hash TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'draft', source_id TEXT,
          supersedes_id TEXT, quality_score REAL NOT NULL DEFAULT 0.5,
          confidence REAL NOT NULL DEFAULT 0.5, importance REAL NOT NULL DEFAULT 0.5,
          last_confirmed_at TEXT, last_accessed_at TEXT, access_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(path, content_hash),
          FOREIGN KEY (source_id) REFERENCES wiki_sources(id) ON DELETE SET NULL,
          FOREIGN KEY (supersedes_id) REFERENCES wiki_pages(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS wiki_claims (
          id TEXT PRIMARY KEY, page_id TEXT NOT NULL, claim_text TEXT NOT NULL,
          normalized_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed',
          confidence REAL NOT NULL DEFAULT 0.5, importance REAL NOT NULL DEFAULT 0.5,
          support_count INTEGER NOT NULL DEFAULT 1, valid_from TEXT, valid_to TEXT,
          last_confirmed_at TEXT, last_accessed_at TEXT, access_count INTEGER NOT NULL DEFAULT 0,
          supersedes_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY (page_id) REFERENCES wiki_pages(id) ON DELETE CASCADE,
          FOREIGN KEY (supersedes_id) REFERENCES wiki_claims(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS wiki_knowledge_events (
          id TEXT PRIMARY KEY, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
          event_type TEXT NOT NULL, delta REAL, source_id TEXT, source_page TEXT,
          reason TEXT, created_at TEXT NOT NULL,
          FOREIGN KEY (source_id) REFERENCES wiki_sources(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS wiki_lifecycle_jobs (
          id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', available_at TEXT NOT NULL,
          locked_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, error_message TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wiki_sources_path_status ON wiki_sources(path, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_wiki_pages_status_updated ON wiki_pages(status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_wiki_claims_key_status ON wiki_claims(normalized_key, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_wiki_events_object ON wiki_knowledge_events(object_type, object_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_wiki_lifecycle_jobs_status_available ON wiki_lifecycle_jobs(status, available_at);
      `);
    },
  },
  {
    id: 21,
    name: 'add-wiki-search-index',
    up: (db) => {
      db.exec(`
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
      `);
    },
  },
  {
    id: 22,
    name: 'repair-wiki-search-fts-table',
    up: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS wiki_search_documents_fts;
        CREATE VIRTUAL TABLE wiki_search_documents_fts USING fts5(
          title, heading, body, source_path,
          document_id UNINDEXED
        );
      `);
    },
  },
  {
    id: 23,
    name: 'add-a2ui-message-blocks-and-registry',
    up: (db) => {
      db.exec(`
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
      `);
    },
  },
  {
    id: 24,
    name: 'harden-memory-processing-and-audit',
    up: (db) => {
      const columns = [
        ['requested_through_message_id', 'TEXT'],
        ['processed_through_message_id', 'TEXT'],
      ];
      for (const [name, definition] of columns) {
        try {
          db.exec(`ALTER TABLE memory_processing_jobs ADD COLUMN ${name} ${definition}`);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes('duplicate column')) throw error;
        }
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_events (
          id TEXT PRIMARY KEY,
          job_id TEXT,
          conversation_id TEXT,
          source_message_id TEXT,
          action TEXT NOT NULL,
          memory_key TEXT NOT NULL,
          subject TEXT NOT NULL,
          candidate_ids_json TEXT NOT NULL DEFAULT '[]',
          result_memory_id TEXT,
          superseded_ids_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL,
          error_code TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_memory_events_conversation
          ON memory_events(conversation_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_memory_events_job
          ON memory_events(job_id, created_at DESC);
      `);
    },
  },
  {
    id: 25,
    name: 'add-wiki-vector-search-index',
    up: (db) => {
      db.prepare('SELECT vec_version()').get();
      db.exec(`
        CREATE TABLE IF NOT EXISTS wiki_embeddings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id TEXT NOT NULL UNIQUE,
          model TEXT NOT NULL,
          dimensions INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (document_id) REFERENCES wiki_search_documents(id) ON DELETE CASCADE
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS wiki_search_vectors USING vec0(
          embedding float[1024] distance_metric=cosine
        );
        CREATE INDEX IF NOT EXISTS idx_wiki_embeddings_document
          ON wiki_embeddings(document_id);
      `);
    },
  },
  {
    id: 26,
    name: 'add-wiki-vector-index-failures',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS wiki_vector_index_failures (
          document_id TEXT PRIMARY KEY,
          source_path TEXT NOT NULL,
          error TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (document_id) REFERENCES wiki_search_documents(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    id: 27,
    name: 'add-wiki-vector-backfill-jobs',
    up: (db) => {
      db.exec(`
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
    },
  },
  {
    id: 28,
    name: 'add-agent-run-events',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_run_events (
          run_id TEXT NOT NULL,
          sequence INTEGER NOT NULL CHECK(sequence > 0),
          schema_version INTEGER NOT NULL CHECK(schema_version > 0),
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (run_id, sequence)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_sequence
          ON agent_run_events(run_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_agent_run_events_open_runs
          ON agent_run_events(run_id, sequence DESC);
      `);
    },
  },
  {
    id: 29,
    name: 'add-model-endpoint-verification',
    up: (db) => {
      db.exec('ALTER TABLE model_endpoints ADD COLUMN verified_at TEXT');
    },
  },
  {
    id: 30,
    name: 'add-agent-run-recovery-actions',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_run_recovery_index (
          run_id TEXT PRIMARY KEY,
          conversation_id TEXT,
          origin_message_id TEXT,
          agent_id TEXT,
          execution_mode TEXT,
          last_event_sequence INTEGER NOT NULL DEFAULT 0,
          terminal INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_run_recovery_actions (
          action_id TEXT PRIMARY KEY,
          origin_run_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('continue', 'retry', 'abandon')),
          idempotency_key TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('reserved', 'started', 'completed')),
          successor_run_id TEXT,
          created_at TEXT NOT NULL,
          completed_at TEXT,
          UNIQUE(origin_run_id, action, idempotency_key)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_run_recovery_actions_origin
          ON agent_run_recovery_actions(origin_run_id, status);
      `);
    },
  },
];

/**
 * Determines whether a migration error means that the requested schema object
 * already exists and can therefore be recorded as applied.
 * @param error The error raised while applying a migration.
 * @returns True only for SQLite's known idempotent object-exists errors.
 */
function isCompatibleMigrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('duplicate column') || message.includes('already exists');
}

// ── 迁移执行器 ──
// 1. 确保 _migrations 表存在
// 2. 查询已应用的迁移 ID
// 3. 按 ID 升序运行未应用的迁移
// 4. 每条迁移成功后在 _migrations 中记录

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const appliedRows = db.prepare('SELECT id FROM _migrations ORDER BY id').all() as {
    id: number;
  }[];
  const appliedIds = new Set(appliedRows.map((r) => r.id));

  for (const m of migrations) {
    if (appliedIds.has(m.id)) continue;

    try {
      m.up(db);
      db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(m.id, m.name);
      console.log(`[db/migration] Applied: #${m.id} ${m.name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isCompatibleMigrationError(err)) {
        // SQLite 不同版本的错误信息可能不同，记录已存在则视为已应用
        db.prepare('INSERT OR IGNORE INTO _migrations (id, name) VALUES (?, ?)').run(m.id, m.name);
        console.warn(`[db/migration] Skipped compatible: #${m.id} ${m.name}: ${msg}`);
      } else {
        console.error(`[db/migration] Failed: #${m.id} ${m.name}: ${msg}`);
        throw new Error(`Migration failed: #${m.id} ${m.name}: ${msg}`, { cause: err });
      }
    }
  }
}
