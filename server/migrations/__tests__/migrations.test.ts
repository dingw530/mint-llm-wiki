import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../index.js';

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
    const warningLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    runMigrations(db);

    const appliedIds = db.prepare('SELECT id FROM _migrations ORDER BY id').all() as {
      id: number;
    }[];
    expect(appliedIds.map(({ id }) => id)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
    expect(warningLog).toHaveBeenCalledWith(
      '[db/migration] Skipped compatible: #1 add-reasoning-to-messages: duplicate column name: reasoning',
    );
  });
});
