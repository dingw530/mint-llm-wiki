import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../db.js';
import * as lifecycleRepo from '../../../repositories/wikiLifecycleRepository.js';
import { registerCompiledKnowledge } from '../wikiKnowledgeLifecycleService.js';

describe('wikiKnowledgeLifecycleService', () => {
  beforeEach(() => {
    getDb().exec(
      'DELETE FROM wiki_knowledge_events; DELETE FROM wiki_claims; DELETE FROM wiki_pages; DELETE FROM wiki_sources;',
    );
  });

  it('registers compiled pages and creates a fallback claim', () => {
    const result = registerCompiledKnowledge('sources/a.md', 'source-a', [
      {
        filename: 'pages/concept/a.md',
        title: 'A',
        tags: [],
        content: '# A\nbody',
      },
    ]);

    expect(result.source.status).toBe('compiled');
    expect(result.pages[0].status).toBe('active');
    expect(result.claims[0].normalizedKey).toBe('page:a');
  });

  it('reinforces an identical claim and contests a conflicting claim', () => {
    const page = { filename: 'pages/concept/a.md', title: 'A', tags: [], content: 'body' };
    const first = registerCompiledKnowledge(
      'sources/a.md',
      'source-a',
      [page],
      [
        {
          pageTitle: 'A',
          text: '系统使用 SQLite',
          normalizedKey: 'database',
          confidence: 0.7,
        },
      ],
    );
    const second = registerCompiledKnowledge(
      'sources/a-2.md',
      'source-b',
      [{ ...page, content: 'new body' }],
      [
        {
          pageTitle: 'A',
          text: '系统使用 SQLite',
          normalizedKey: 'database',
          confidence: 0.7,
        },
      ],
    );
    const third = registerCompiledKnowledge(
      'sources/a-3.md',
      'source-c',
      [{ ...page, content: 'another body' }],
      [
        {
          pageTitle: 'A',
          text: '系统使用 PostgreSQL',
          normalizedKey: 'database',
          confidence: 0.7,
        },
      ],
    );

    expect(first.claims[0].supportCount).toBe(1);
    expect(second.claims[0].id).toBe(first.claims[0].id);
    expect(second.claims[0].supportCount).toBe(2);
    expect(third.claims[0].status).toBe('contested');
    expect(lifecycleRepo.findActiveClaims('database')).toHaveLength(2);
    expect(
      getDb()
        .prepare(
          "SELECT COUNT(*) AS count FROM wiki_knowledge_events WHERE event_type='contradicted'",
        )
        .get(),
    ).toMatchObject({ count: 1 });
  });

  it('does not reinforce lifecycle claims when the same source registration is replayed', () => {
    const page = {
      filename: 'pages/recovery/idempotent.md',
      title: 'Idempotent',
      tags: [],
      content: '# Idempotent',
    };
    const claims = [
      {
        pageTitle: 'Idempotent',
        text: 'stable fact',
        normalizedKey: 'stable fact',
        confidence: 0.7,
        importance: 0.5,
        evidence: 'source excerpt',
      },
    ];

    const first = registerCompiledKnowledge('sources/idempotent.md', 'source text', [page], claims);
    const eventCount = Number(
      (
        getDb().prepare('SELECT COUNT(*) AS count FROM wiki_knowledge_events').get() as {
          count: number;
        }
      ).count,
    );
    const second = registerCompiledKnowledge(
      'sources/idempotent.md',
      'source text',
      [page],
      claims,
    );
    const nextEventCount = Number(
      (
        getDb().prepare('SELECT COUNT(*) AS count FROM wiki_knowledge_events').get() as {
          count: number;
        }
      ).count,
    );

    expect(second.source.id).toBe(first.source.id);
    expect(second.pages[0].id).toBe(first.pages[0].id);
    expect(second.claims[0].supportCount).toBe(1);
    expect(nextEventCount).toBe(eventCount);
  });
});
