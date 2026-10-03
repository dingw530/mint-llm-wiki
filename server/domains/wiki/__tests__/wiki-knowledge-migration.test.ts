import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../db.js';
import { migrateExistingWikiPages } from '../wiki-knowledge-lifecycle-service.js';

const tempDirs: string[] = [];

afterEach(() => {
  getDb().exec(
    'DELETE FROM wiki_knowledge_events; DELETE FROM wiki_claims; DELETE FROM wiki_pages; DELETE FROM wiki_sources;',
  );
  for (const directory of tempDirs.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe('migrateExistingWikiPages', () => {
  it('should backfill legacy pages and be idempotent', () => {
    const wikiPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-lifecycle-migration-'));
    tempDirs.push(wikiPath);
    fs.mkdirSync(path.join(wikiPath, 'pages', 'concept'), { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'concept', 'database.md'),
      '---\ntitle: Database\ntags: [storage]\n---\n# Database\n\nSQLite is embedded.\n',
    );

    const first = migrateExistingWikiPages(wikiPath);
    const second = migrateExistingWikiPages(wikiPath);

    expect(first).toMatchObject({
      scanned: 1,
      migrated: 1,
      unchanged: 0,
      skipped: 0,
      claimsCreated: 1,
    });
    expect(second).toMatchObject({
      scanned: 1,
      migrated: 0,
      unchanged: 1,
      skipped: 0,
      claimsCreated: 1,
    });
    expect(
      getDb()
        .prepare("SELECT COUNT(*) AS count FROM wiki_pages WHERE path='pages/concept/database.md'")
        .get(),
    ).toMatchObject({ count: 1 });
    expect(
      getDb()
        .prepare(
          "SELECT COUNT(*) AS count FROM wiki_sources WHERE path='legacy/pages/concept/database.md'",
        )
        .get(),
    ).toMatchObject({ count: 1 });
    expect(fs.existsSync(path.join(wikiPath, 'pages', 'concept', 'database.md'))).toBe(true);
  });
});
