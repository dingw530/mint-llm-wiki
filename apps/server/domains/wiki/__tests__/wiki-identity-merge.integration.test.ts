import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AiSettings } from '../../../types.js';
import { getDb } from '../../../db.js';
import * as graphRepository from '../../../infrastructure/persistence/graph-repository.js';
import { ingestWikiSource } from '../wiki-ingestion-service.js';

const adapter = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock('../../../infrastructure/ai/adapters/api-adapter.js', () => ({
  getAdapter: () => adapter,
}));

vi.mock('../../knowledge-graph/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../knowledge-graph/index.js')>();
  return {
    ...original,
    generateCrossBatchCandidates: vi.fn().mockResolvedValue(undefined),
  };
});

interface TestRows {
  pageId?: string;
  sourcePath?: string;
  sourceId?: string;
  claimIds: string[];
  graphNodeIds: string[];
  searchDocumentIds: string[];
}

function compilerResponse(title: string, fact: string): string {
  return JSON.stringify({
    pages: [{ filename: 'pages/concepts/incoming.md', title, tags: ['new-source'], content: fact }],
    claims: [{ pageTitle: title, text: fact, evidenceQuote: fact }],
    relationships: [],
    summary: 'identity integration',
  });
}

function mergedPageResponse(title: string, oldFact: string, newFact: string): string {
  return `---\ntitle: ${title}\ncreated: 2026-01-01\ntags: [existing, new-source]\n---\n\n# ${title}\n\n${oldFact}\n\n${newFact}`;
}

function collectTestRows(pagePath: string, sourcePath: string): TestRows {
  const db = getDb();
  const page = db
    .prepare('SELECT id, source_id AS sourceId FROM wiki_pages WHERE path = ?')
    .get(pagePath) as { id: string; sourceId: string | null } | undefined;
  const source = db.prepare('SELECT id FROM wiki_sources WHERE path = ?').get(sourcePath) as
    { id: string } | undefined;
  const claims = page
    ? (db.prepare('SELECT id FROM wiki_claims WHERE page_id = ?').all(page.id) as { id: string }[])
    : [];
  const documents = db
    .prepare('SELECT id FROM wiki_search_documents WHERE source_path = ?')
    .all(pagePath) as { id: string }[];
  const graphNodes = graphRepository
    .getAllNodesWithSource()
    .filter((node) => node.sourceFile === pagePath);
  return {
    pageId: page?.id,
    sourcePath: sourcePath || undefined,
    sourceId: source?.id || page?.sourceId || undefined,
    claimIds: claims.map((claim) => claim.id),
    graphNodeIds: graphNodes.map((node) => node.id),
    searchDocumentIds: documents.map((document) => document.id),
  };
}

function cleanupTestRows(pagePath: string, rows: TestRows): void {
  const db = getDb();
  const objectIds = [...rows.claimIds, rows.pageId, rows.sourceId].filter((id): id is string =>
    Boolean(id),
  );
  for (const objectId of objectIds) {
    db.prepare('DELETE FROM wiki_knowledge_events WHERE object_id = ?').run(objectId);
  }
  for (const documentId of rows.searchDocumentIds) {
    db.prepare('DELETE FROM wiki_search_documents_fts WHERE document_id = ?').run(documentId);
    db.prepare('DELETE FROM wiki_search_documents WHERE id = ?').run(documentId);
  }
  for (const nodeId of rows.graphNodeIds) graphRepository.deleteNode(nodeId);
  if (rows.pageId) db.prepare('DELETE FROM wiki_claims WHERE page_id = ?').run(rows.pageId);
  db.prepare('DELETE FROM wiki_pages WHERE path = ?').run(pagePath);
  if (rows.sourceId) db.prepare('DELETE FROM wiki_sources WHERE id = ?').run(rows.sourceId);
}

describe('Wiki identity merge ingestion integration', () => {
  let wikiPath: string;
  let canonicalPath: string;
  let sourcePath = '';
  let rows: TestRows = {
    claimIds: [],
    graphNodeIds: [],
    searchDocumentIds: [],
  };
  let sourceBytes: string;
  let canonicalTitle: string;
  let incomingTitle: string;
  let fact: string;

  beforeEach(() => {
    const identity = randomUUID();
    wikiPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-wiki-identity-'));
    canonicalPath = `pages/concepts/${identity}.md`;
    canonicalTitle = `Retrieval Generation ${identity}`;
    incomingTitle = `RG ${identity}`;
    fact = `Source fact ${identity}.`;
    sourceBytes = `Original immutable source ${identity}.`;
    fs.mkdirSync(path.join(wikiPath, 'pages', 'concepts'), { recursive: true });
    fs.mkdirSync(path.join(wikiPath, 'sources'), { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, '_schema.json'),
      JSON.stringify({ version: 1, categories: ['concepts'] }),
    );
    fs.writeFileSync(
      path.join(wikiPath, canonicalPath),
      `---\ntitle: ${canonicalTitle}\ncreated: 2026-01-01\naliases: ["${incomingTitle}"]\ntags: [existing]\n---\n\nOld established fact ${identity}.`,
    );
    adapter.call
      .mockReset()
      .mockResolvedValueOnce(compilerResponse(incomingTitle, fact))
      .mockResolvedValueOnce(
        mergedPageResponse(canonicalTitle, `Old established fact ${identity}.`, fact),
      );
  });

  afterEach(() => {
    rows = collectTestRows(canonicalPath, sourcePath);
    cleanupTestRows(canonicalPath, rows);
    fs.rmSync(wikiPath, { recursive: true, force: true });
    sourcePath = '';
    rows = { claimIds: [], graphNodeIds: [], searchDocumentIds: [] };
  });

  it('keeps one canonical page consistent across Source, Claim, FTS, graph and manifest', async () => {
    const settings = {
      apiUrl: 'https://llm.example/v1',
      apiKey: 'test-key',
      modelId: 'test-model',
      apiType: 'openai-chat',
      wikiPath,
      wikiSearchMode: 'keyword',
      vectorStore: 'sqlite',
    } as AiSettings;
    const result = await ingestWikiSource(settings, wikiPath, {
      sourceText: fact,
      sourceTitle: incomingTitle,
      archivedFiles: [{ name: 'source.md', buffer: Buffer.from(sourceBytes) }],
      jevSettings: {
        apiUrl: '',
        apiKey: '',
        model: 'jev-latest',
        timeoutMs: 1000,
        routingEnabled: false,
        routingMinConfidence: 0.5,
        routingBypassOnKeyword: true,
        memoryEnabled: false,
        memoryGateThreshold: 0.4,
        wikiIdentityEnabled: false,
      },
    });
    sourcePath = result.sourceFile;
    rows = collectTestRows(canonicalPath, sourcePath);

    const pageFile = path.join(wikiPath, canonicalPath);
    const page = fs.readFileSync(pageFile, 'utf8');
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].filename).toBe(canonicalPath);
    expect(page).toContain('Old established fact');
    expect(page).toContain(incomingTitle);
    expect(page).toContain(fact);
    expect(page).toContain(`aliases: ["${incomingTitle}"]`);
    expect(fs.readFileSync(path.join(wikiPath, sourcePath), 'utf8')).toBe(sourceBytes);

    const manifest = JSON.parse(fs.readFileSync(path.join(wikiPath, '_manifest.json'), 'utf8'));
    expect(manifest.entries.at(-1).pageFiles).toEqual([canonicalPath]);
    const db = getDb();
    expect(rows.pageId).toBeTruthy();
    expect(rows.sourceId).toBeTruthy();
    expect(rows.claimIds.length).toBeGreaterThan(0);
    expect(rows.searchDocumentIds.length).toBeGreaterThan(0);
    expect(rows.graphNodeIds.length).toBeGreaterThan(0);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM wiki_pages WHERE path = ?').get(canonicalPath),
    ).toMatchObject({ count: 1 });
  });
});
