import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../db.js';
import * as repository from '../wiki-search-repository.js';
import * as vectorRepository from '../../../repositories/vectorRepository.js';

const documentIds = ['vector-test-a', 'vector-test-b'];
const config = { apiUrl: 'http://127.0.0.1:11434/v1', model: 'bge-m3', dimensions: 1024 };

function vector(first: number): number[] {
  const values = Array.from({ length: 1024 }, () => 0);
  values[first] = 1;
  return values;
}

function documents(bodySuffix = ''): repository.WikiSearchDocumentInput[] {
  return [
    {
      id: documentIds[0],
      pageId: null,
      sourcePath: 'pages/vector-a.md',
      title: '向量 A',
      heading: '',
      body: `alpha ${bodySuffix}`,
      documentType: 'chunk',
      contentHash: repository.hashSearchContent(`alpha ${bodySuffix}`),
    },
    {
      id: documentIds[1],
      pageId: null,
      sourcePath: 'pages/vector-b.md',
      title: '向量 B',
      heading: '',
      body: 'beta',
      documentType: 'chunk',
      contentHash: repository.hashSearchContent('beta'),
    },
  ];
}

describe('vectorRepository', () => {
  afterEach(() => {
    const db = getDb();
    for (const id of documentIds) {
      const embedding = db
        .prepare('SELECT id FROM wiki_embeddings WHERE document_id = ?')
        .get(id) as { id: number } | undefined;
      if (embedding)
        db.prepare('DELETE FROM wiki_search_vectors WHERE rowid = CAST(? AS INTEGER)').run(
          embedding.id,
        );
      db.prepare('DELETE FROM wiki_embeddings WHERE document_id = ?').run(id);
      db.prepare('DELETE FROM wiki_search_documents_fts WHERE document_id = ?').run(id);
      db.prepare('DELETE FROM wiki_search_documents WHERE id = ?').run(id);
    }
  });

  it('stores, queries and incrementally invalidates vectors', async () => {
    const initial = documents();
    const change = repository.replacePageDocuments('pages/vector-a.md', [initial[0]]);
    repository.replacePageDocuments('pages/vector-b.md', [initial[1]]);
    expect(change.changedDocuments).toHaveLength(1);
    await vectorRepository.upsert(initial[0], vector(0), config);
    await vectorRepository.upsert(initial[1], vector(1), config);

    const results = await vectorRepository.search(vector(0), config, 5);
    expect(results[0]).toMatchObject({ document: { id: documentIds[0] }, distance: 0 });
    expect(await vectorRepository.getState(documentIds[0])).toMatchObject({
      contentHash: initial[0].contentHash,
    });

    const unchanged = repository.replacePageDocuments('pages/vector-a.md', [initial[0]]);
    expect(unchanged.changedDocuments).toHaveLength(0);
    const updated = documents('updated');
    const changed = repository.replacePageDocuments('pages/vector-a.md', [updated[0]]);
    expect(changed.changedDocuments).toHaveLength(1);
    expect(await vectorRepository.search(vector(0), config, 5)).toHaveLength(1);
  });
});
