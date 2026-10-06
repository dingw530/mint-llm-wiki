import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMemoryScopeMigration } from '../index.js';

describe('applyMemoryScopeMigration', () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  function createLegacySchema(): void {
    db = new Database(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE conversations (id TEXT PRIMARY KEY);
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id)
      );
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source_message_id TEXT,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE memory_events (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        conversation_id TEXT,
        source_message_id TEXT,
        action TEXT NOT NULL,
        memory_key TEXT NOT NULL,
        subject TEXT NOT NULL,
        candidate_ids_json TEXT NOT NULL,
        result_memory_id TEXT,
        superseded_ids_json TEXT NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE memory_processing_jobs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        available_at TEXT NOT NULL,
        locked_at TEXT,
        requested_through_message_id TEXT,
        processed_through_message_id TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO conversations VALUES ('conversation-1');
      INSERT INTO conversations VALUES ('conversation-2');
      INSERT INTO messages VALUES ('message-1', 'conversation-1');
      INSERT INTO memories (id, content, source_message_id, status, updated_at)
        VALUES ('memory-1', 'prefers concise answers', 'message-1', 'active', '2026-09-01');
      INSERT INTO memory_processing_jobs (
        id, conversation_id, status, attempts, available_at, locked_at,
        requested_through_message_id, processed_through_message_id, error_message,
        created_at, updated_at
      ) VALUES
        ('pending-job', 'conversation-1', 'pending', 2, '2026-09-01', NULL,
          'message-1', NULL, NULL, '2026-09-01', '2026-09-01'),
        ('processing-job', 'conversation-2', 'processing', 1, '2026-09-01', '2026-09-01',
          'message-1', NULL, NULL, '2026-09-01', '2026-09-01');
    `);
  }

  it('preserves legacy memories and quarantines jobs without assigning a scope', () => {
    createLegacySchema();
    const before = db!
      .prepare('SELECT id, content, source_message_id, status, updated_at FROM memories')
      .all();

    applyMemoryScopeMigration(db!);

    expect(
      db!.prepare('SELECT id, content, source_message_id, status, updated_at FROM memories').all(),
    ).toEqual(before);
    expect(db!.prepare('SELECT * FROM memories').all()).toEqual([
      expect.objectContaining({
        id: 'memory-1',
        content: 'prefers concise answers',
        scope_kind: 'unassigned',
        space_id: null,
        context_policy: 'retrievable',
        policy_source: 'migration',
      }),
    ]);
    expect(before).toHaveLength(1);
    expect(
      db!
        .prepare(
          'SELECT status, scope_kind, space_id, binding_revision, error_message FROM memory_processing_jobs ORDER BY id',
        )
        .all(),
    ).toEqual([
      {
        status: 'failed',
        scope_kind: 'unassigned',
        space_id: null,
        binding_revision: 0,
        error_message: 'legacy_scope_unassigned',
      },
      {
        status: 'failed',
        scope_kind: 'unassigned',
        space_id: null,
        binding_revision: 0,
        error_message: 'legacy_scope_unassigned',
      },
    ]);
    expect(
      db!.prepare('SELECT action, status, error_code, scope_kind FROM memory_events').get(),
    ).toEqual({
      action: 'SCOPE_MIGRATION',
      status: 'failed',
      error_code: 'legacy_scope_unassigned',
      scope_kind: 'unassigned',
    });

    expect(() => applyMemoryScopeMigration(db!)).not.toThrow();
    expect(db!.prepare('SELECT id FROM memories').all()).toEqual([{ id: 'memory-1' }]);
    expect(db!.prepare('SELECT count(*) AS count FROM memory_events').get()).toEqual({ count: 2 });
  });

  it('rolls back all schema changes when a required legacy table is absent', () => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE conversations (id TEXT PRIMARY KEY)');

    expect(() => applyMemoryScopeMigration(db!)).toThrow();
    expect(
      db!
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_spaces'")
        .get(),
    ).toBeUndefined();
    expect(db!.prepare('PRAGMA table_info(conversations)').all()).toEqual([
      expect.objectContaining({ name: 'id' }),
    ]);
  });

  it('supports minimal legacy fixtures without the optional memory event table', () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE conversations (id TEXT PRIMARY KEY);
      CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL);
      CREATE TABLE memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE memory_processing_jobs (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
        attempts INTEGER NOT NULL, available_at TEXT NOT NULL, locked_at TEXT,
        requested_through_message_id TEXT, processed_through_message_id TEXT,
        error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);

    expect(() => applyMemoryScopeMigration(db!)).not.toThrow();
    expect(
      db!.prepare("SELECT name FROM sqlite_master WHERE name = 'memory_events'").get(),
    ).toEqual({
      name: 'memory_events',
    });
  });
});
