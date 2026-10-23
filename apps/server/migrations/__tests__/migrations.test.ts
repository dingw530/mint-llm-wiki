import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../index.js';
import { encrypt } from '../../infrastructure/security/encryption.js';

describe('runMigrations', () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    vi.restoreAllMocks();
  });

  it('fails closed and stops before recording or running later migrations', () => {
    db = new Database(':memory:');
    db.exec('CREATE VIEW messages AS SELECT 1 AS id');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => runMigrations(db!)).toThrow(
      'Migration failed: #1 add-reasoning-to-messages: Cannot add a column to a view',
    );

    expect(db.prepare('SELECT id FROM _migrations').all()).toEqual([]);
    expect(errorLog).toHaveBeenCalledWith(
      '[db/migration] Failed: #1 add-reasoning-to-messages: Cannot add a column to a view',
    );
  });

  it('records compatible duplicate-column errors, logs a warning, and continues', () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE messages (id TEXT, reasoning TEXT);
      CREATE TABLE conversations (id TEXT);
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(3, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(4, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(5, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(6, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(7, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(8, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(9, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(10, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(11, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(12, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(13, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(14, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(15, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(16, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(17, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(18, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(19, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(20, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(21, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(22, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(23, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(24, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(25, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(26, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(27, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(28, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(29, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(30, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(31, 'seed');
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(32, 'seed');
    const warningLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    runMigrations(db);

    const appliedIds = db.prepare('SELECT id FROM _migrations ORDER BY id').all() as {
      id: number;
    }[];
    expect(appliedIds.map(({ id }) => id)).toEqual(
      Array.from({ length: 37 }, (_, index) => index + 1),
    );
    expect(db.prepare('SELECT name FROM _migrations WHERE id = 35').get()).toEqual({
      name: 'add-conversation-session-events',
    });
    expect(db.prepare('SELECT name FROM _migrations WHERE id = 36').get()).toEqual({
      name: 'store-conversation-session-events-as-json',
    });
    expect(db.prepare('SELECT name FROM _migrations WHERE id = 37').get()).toEqual({
      name: 'remove-conversation-session-writer-lease',
    });
    expect(warningLog).toHaveBeenCalledWith(
      '[db/migration] Skipped compatible: #1 add-reasoning-to-messages: duplicate column name: reasoning',
    );
  });

  it('atomically migrates existing encrypted session events to JSON', () => {
    vi.stubEnv('AI_CHAT_ENCRYPTION_KEY', 'session-migration-key');
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE conversations (id TEXT PRIMARY KEY);
      CREATE TABLE conversation_session_state (
        conversation_id TEXT PRIMARY KEY,
        owner_id TEXT,
        owner_fence INTEGER NOT NULL DEFAULT 0 CHECK(owner_fence >= 0),
        lease_expires_at TEXT
      );
      CREATE TABLE conversation_session_events (
        conversation_id TEXT NOT NULL, event_id TEXT NOT NULL, seq INTEGER NOT NULL,
        schema_version INTEGER NOT NULL, run_id TEXT NOT NULL, turn_id TEXT NOT NULL,
        event_type TEXT NOT NULL, round INTEGER, call_id TEXT, created_at TEXT NOT NULL,
        payload_encrypted TEXT NOT NULL, PRIMARY KEY (conversation_id, seq),
        UNIQUE (conversation_id, event_id),
        FOREIGN KEY (conversation_id) REFERENCES conversation_session_state(conversation_id) ON DELETE CASCADE
      );
    `);
    const markApplied = db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)');
    for (let id = 1; id <= 35; id += 1) markApplied.run(id, 'existing');
    db.prepare('INSERT INTO conversations (id) VALUES (?)').run('conversation-1');
    db.prepare('INSERT INTO conversation_session_state (conversation_id) VALUES (?)').run(
      'conversation-1',
    );
    const event = {
      schemaVersion: 1,
      conversationId: 'conversation-1',
      eventId: 'event-1',
      seq: 1,
      runId: 'run-1',
      turnId: 'turn-1',
      createdAt: '2026-10-20T00:00:00.000Z',
      type: 'user_message',
      messageId: 'message-1',
      content: 'hello from old session',
    };
    db.prepare(
      `INSERT INTO conversation_session_events
        (conversation_id, event_id, seq, schema_version, run_id, turn_id, event_type, round, call_id, created_at, payload_encrypted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'conversation-1',
      'event-1',
      1,
      1,
      'run-1',
      'turn-1',
      'user_message',
      null,
      null,
      event.createdAt,
      encrypt(JSON.stringify(event)),
    );

    vi.stubEnv('AI_CHAT_ENCRYPTION_KEY', 'wrong-session-migration-key');
    expect(() => runMigrations(db!)).toThrow(
      'Migration failed: #36 store-conversation-session-events-as-json',
    );
    expect(db.prepare('PRAGMA table_info(conversation_session_events)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'payload_encrypted' })]),
    );
    expect(db.prepare('SELECT id FROM _migrations WHERE id = 36').get()).toBeUndefined();

    vi.stubEnv('AI_CHAT_ENCRYPTION_KEY', 'session-migration-key');

    runMigrations(db);

    const migrated = db
      .prepare('SELECT payload_json FROM conversation_session_events WHERE event_id = ?')
      .get('event-1') as { payload_json: string };
    expect(JSON.parse(migrated.payload_json)).toEqual(event);
    expect(db.prepare('PRAGMA table_info(conversation_session_events)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'payload_json' })]),
    );
    expect(db.prepare('SELECT count(*) AS count FROM conversation_session_events').get()).toEqual({
      count: 1,
    });
    expect(db.prepare('PRAGMA table_info(conversation_session_state)').all()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'owner_id' }),
        expect.objectContaining({ name: 'owner_fence' }),
        expect.objectContaining({ name: 'lease_expires_at' }),
      ]),
    );
  });
});
