import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../db.js';
import { registerCompiledKnowledge } from '../wiki-knowledge-lifecycle-service.js';
import { runWikiLifecycleOnce } from '../wiki-lifecycle-service.js';

describe('wikiLifecycleService', () => {
  beforeEach(() => {
    getDb().exec(
      'DELETE FROM wiki_knowledge_events; DELETE FROM wiki_claims; DELETE FROM wiki_pages; DELETE FROM wiki_sources;',
    );
  });

  it('marks old low-retention pages stale and then archived', () => {
    const result = registerCompiledKnowledge(
      'sources/old.md',
      'old-source',
      [
        {
          filename: 'pages/concept/old.md',
          title: 'Old',
          tags: [],
          content: 'old',
        },
      ],
      [
        {
          pageTitle: 'Old',
          text: 'old fact',
          normalizedKey: 'old.fact',
          confidence: 0.2,
          importance: 0.2,
        },
      ],
    );
    const old = '2024-01-01T00:00:00.000Z';
    getDb()
      .prepare('UPDATE wiki_pages SET last_confirmed_at=?, updated_at=? WHERE id=?')
      .run(old, old, result.pages[0].id);
    getDb()
      .prepare('UPDATE wiki_claims SET last_confirmed_at=?, updated_at=? WHERE page_id=?')
      .run(old, old, result.pages[0].id);

    const first = runWikiLifecycleOnce({
      now: new Date('2026-07-24T00:00:00.000Z'),
      staleAfterDays: 30,
      archiveAfterDays: 5000,
      claimExpiryDays: 5000,
    });
    expect(first.pagesStaled).toBe(1);
    expect(
      getDb().prepare('SELECT status FROM wiki_pages WHERE id=?').get(result.pages[0].id),
    ).toMatchObject({ status: 'stale' });

    const second = runWikiLifecycleOnce({
      now: new Date('2026-07-24T00:00:00.000Z'),
      staleAfterDays: 30,
      archiveAfterDays: 30,
      claimExpiryDays: 5000,
    });
    expect(second.pagesArchived).toBe(1);
    expect(
      getDb().prepare('SELECT status FROM wiki_pages WHERE id=?').get(result.pages[0].id),
    ).toMatchObject({ status: 'archived' });
  });

  it('expires old proposed claims but preserves event history', () => {
    const result = registerCompiledKnowledge(
      'sources/claim.md',
      'claim-source',
      [
        {
          filename: 'pages/concept/claim.md',
          title: 'Claim',
          tags: [],
          content: 'claim',
        },
      ],
      [{ pageTitle: 'Claim', text: 'old fact', normalizedKey: 'old.fact', confidence: 0.4 }],
    );
    getDb()
      .prepare('UPDATE wiki_claims SET created_at=? WHERE id=?')
      .run('2024-01-01T00:00:00.000Z', result.claims[0].id);
    const run = runWikiLifecycleOnce({
      now: new Date('2026-07-24T00:00:00.000Z'),
      claimExpiryDays: 30,
    });
    expect(run.claimsExpired).toBe(1);
    expect(
      getDb().prepare('SELECT status FROM wiki_claims WHERE id=?').get(result.claims[0].id),
    ).toMatchObject({ status: 'expired' });
    expect(
      getDb()
        .prepare(
          "SELECT COUNT(*) AS count FROM wiki_knowledge_events WHERE object_id=? AND event_type='expired'",
        )
        .get(result.claims[0].id),
    ).toMatchObject({ count: 1 });
  });
});
