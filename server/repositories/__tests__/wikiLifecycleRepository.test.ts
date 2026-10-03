import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../db.js';
import * as repo from '../wikiLifecycleRepository.js';

describe('wikiLifecycleRepository', () => {
  beforeEach(() => {
    getDb().exec(
      'DELETE FROM wiki_knowledge_events; DELETE FROM wiki_claims; DELETE FROM wiki_pages; DELETE FROM wiki_sources;',
    );
  });

  it('creates a source and deduplicates a page by path and content hash', () => {
    const source = repo.createSource({
      path: 'sources/design.md',
      contentHash: 'hash-1',
      sourceType: 'file',
    });
    const first = repo.createPage({
      path: 'pages/concept/design.md',
      title: 'Design',
      contentHash: 'page-1',
      sourceId: source.id,
      status: 'active',
    });
    const duplicate = repo.createPage({
      path: first.path,
      title: first.title,
      contentHash: first.contentHash,
      sourceId: source.id,
      status: 'active',
    });

    expect(duplicate.id).toBe(first.id);
    expect(repo.findLatestPage(first.path)?.version).toBe(1);
  });

  it('supersedes the previous page version and records an event', () => {
    const source = repo.createSource({
      path: 'sources/design.md',
      contentHash: 'hash-2',
      sourceType: 'file',
    });
    const oldPage = repo.createPage({
      path: 'pages/concept/design.md',
      title: 'Design',
      contentHash: 'page-old',
      sourceId: source.id,
      status: 'active',
    });
    const newPage = repo.createPage({
      path: oldPage.path,
      title: oldPage.title,
      contentHash: 'page-new',
      sourceId: source.id,
      status: 'active',
    });

    expect(newPage.version).toBe(2);
    expect(repo.findLatestPage(oldPage.path)?.supersedesId).toBe(oldPage.id);
    const event = getDb()
      .prepare("SELECT * FROM wiki_knowledge_events WHERE object_id=? AND event_type='superseded'")
      .get(oldPage.id);
    expect(event).toBeTruthy();
  });

  it('stores claims and lifecycle events', () => {
    const source = repo.createSource({
      path: 'sources/claim.md',
      contentHash: 'hash-3',
      sourceType: 'text',
    });
    const page = repo.createPage({
      path: 'pages/concept/claim.md',
      title: 'Claim',
      contentHash: 'page-claim',
      sourceId: source.id,
    });
    const claim = repo.createClaim({
      pageId: page.id,
      claimText: '系统使用 SQLite',
      normalizedKey: 'system.database',
    });
    repo.recordEvent('claim', claim.id, 'created', null, source.id, page.path, 'compiled claim');

    expect(repo.findActiveClaims('system.database')).toHaveLength(1);
    expect(
      getDb().prepare('SELECT COUNT(*) AS count FROM wiki_knowledge_events').get(),
    ).toMatchObject({ count: 1 });
  });
});
