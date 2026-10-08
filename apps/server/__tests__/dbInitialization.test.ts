import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const configuredDatabasePath = process.env.AI_CHAT_DB_PATH;

describe('getDb initialization boundary', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../migrations/index.js');
    if (configuredDatabasePath) process.env.AI_CHAT_DB_PATH = configuredDatabasePath;
    else delete process.env.AI_CHAT_DB_PATH;
  });

  it('closes and resets the singleton when migration initialization fails', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'mint-db-init-'));
    const migrationError = new Error('Migration failed: #1 broken: disk is full');
    const runMigrations = vi.fn(() => {
      throw migrationError;
    });
    process.env.AI_CHAT_DB_PATH = path.join(directory, 'data.db');
    vi.doMock('../migrations/index.js', () => ({ runMigrations }));

    try {
      const { getDb } = await import('../db.js');

      expect(() => getDb()).toThrow(migrationError);
      expect(() => getDb()).toThrow(migrationError);
      expect(runMigrations).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
