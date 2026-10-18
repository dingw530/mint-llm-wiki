import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AiSettings } from '../../../types.js';
import { getDb } from '../../../db.js';
import * as graphRepository from '../../../infrastructure/persistence/graph-repository.js';
import * as graphService from '../../knowledge-graph/graph-service.js';
import { mergeExistingWikiPage } from '../wiki-page-merge-service.js';
import { registerCompiledKnowledge } from '../wiki-knowledge-lifecycle-service.js';
import type { CompiledPage } from '../../../infrastructure/filesystem/wiki-content.js';

const adapter = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../infrastructure/ai/adapters/api-adapter.js', () => ({
  getAdapter: () => adapter,
}));

describe('Wiki page merge integration', () => {
  let wikiPath: string;
  let sourcePath: string;
  let targetPath: string;
  let revisionPath: string;
  let sourceRecordPath: string;
  let targetRecordPath: string;

  function settings(): AiSettings {
    return {
      apiUrl: 'https://llm.example/v1',
      apiKey: 'test-key',
      modelId: 'test-model',
      apiType: 'openai-chat',
      wikiSearchMode: 'keyword',
      vectorStore: 'sqlite',
    } as AiSettings;
  }

  function jevSettings() {
    return {
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
    };
  }

  beforeEach(() => {
    const id = randomUUID();
    wikiPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-wiki-page-merge-'));
    sourcePath = `pages/concepts/source-${id}.md`;
    targetPath = `pages/concepts/target-${id}.md`;
    revisionPath = '';
    sourceRecordPath = `sources/source-${id}.md`;
    targetRecordPath = `sources/target-${id}.md`;
    fs.mkdirSync(path.join(wikiPath, 'pages', 'concepts'), { recursive: true });
    fs.mkdirSync(path.join(wikiPath, 'sources'), { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, '_schema.json'),
      JSON.stringify({ version: 1, categories: ['concepts'] }),
    );
    const sourceMarkdown = `---\ntitle: Source ${id}\naliases: ["Canonical ${id}"]\ntags: [source]\n---\n\nSource fact ${id} is preserved in the merged page.\n\n[Source page](./${path.posix.basename(sourcePath)})`;
    const targetMarkdown = `---\ntitle: Canonical ${id}\ntags: [target]\n---\n\nEstablished fact ${id} remains in the canonical page.`;
    fs.writeFileSync(path.join(wikiPath, sourcePath), sourceMarkdown);
    fs.writeFileSync(path.join(wikiPath, targetPath), targetMarkdown);
    const sourcePage: CompiledPage = {
      filename: sourcePath,
      title: `Source ${id}`,
      content: `Source fact ${id} is preserved in the merged page.\n\n[Source page](./${path.posix.basename(sourcePath)})`,
      tags: ['source'],
      aliases: [`Canonical ${id}`],
    };
    const targetPage: CompiledPage = {
      filename: targetPath,
      title: `Canonical ${id}`,
      content: `Established fact ${id} remains in the canonical page.`,
      tags: ['target'],
    };
    registerCompiledKnowledge(sourceRecordPath, sourceMarkdown, [sourcePage]);
    registerCompiledKnowledge(targetRecordPath, targetMarkdown, [targetPage]);
    graphRepository.createNode({
      label: sourcePage.title,
      type: 'concepts',
      sourceFile: sourcePath,
    });
    graphRepository.createNode({
      label: targetPage.title,
      type: 'concepts',
      sourceFile: targetPath,
    });
    adapter.call
      .mockReset()
      .mockResolvedValue(
        `---\ntitle: Canonical ${id}\ntags: [target, source]\n---\n\n# Canonical ${id}\n\nEstablished fact ${id} remains in the canonical page.\n\nSource fact ${id} is preserved in the merged page.\n\n[Source page](./${path.posix.basename(sourcePath)})`,
      );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    const db = getDb();
    const paths = [sourcePath, targetPath, sourceRecordPath, targetRecordPath, revisionPath].filter(
      Boolean,
    );
    const sourceRows = db
      .prepare(`SELECT id FROM wiki_sources WHERE path IN (${paths.map(() => '?').join(',')})`)
      .all(...paths) as { id: string }[];
    const pageRows = db
      .prepare(`SELECT id FROM wiki_pages WHERE path IN (${paths.map(() => '?').join(',')})`)
      .all(...paths) as { id: string }[];
    const objectIds = [...sourceRows, ...pageRows].map((row) => row.id);
    const pageIds = pageRows.map((row) => row.id);
    const documentRows = db
      .prepare(`SELECT id FROM wiki_search_documents WHERE source_path IN (?, ?)`)
      .all(sourcePath, targetPath) as { id: string }[];
    for (const row of documentRows) {
      db.prepare('DELETE FROM wiki_search_documents_fts WHERE document_id = ?').run(row.id);
      db.prepare('DELETE FROM wiki_search_documents WHERE id = ?').run(row.id);
    }
    for (const node of graphRepository
      .getAllNodesWithSource()
      .filter((item) => item.sourceFile === sourcePath || item.sourceFile === targetPath)) {
      graphRepository.deleteNode(node.id);
    }
    if (objectIds.length > 0) {
      const placeholders = objectIds.map(() => '?').join(',');
      db.prepare(
        `DELETE FROM wiki_knowledge_events WHERE object_id IN (${placeholders}) OR source_id IN (${placeholders})`,
      ).run(...objectIds, ...objectIds);
    }
    if (pageIds.length > 0) {
      db.prepare(
        `DELETE FROM wiki_claims WHERE page_id IN (${pageIds.map(() => '?').join(',')})`,
      ).run(...pageIds);
      db.prepare(`DELETE FROM wiki_pages WHERE id IN (${pageIds.map(() => '?').join(',')})`).run(
        ...pageIds,
      );
    }
    for (const row of sourceRows) db.prepare('DELETE FROM wiki_sources WHERE id = ?').run(row.id);
    fs.rmSync(wikiPath, { recursive: true, force: true });
  });

  it('archives and removes the source after updating the canonical page and indexes', async () => {
    const id = path.basename(sourcePath).replace('source-', '').replace('.md', '');
    const result = await mergeExistingWikiPage(
      settings(),
      wikiPath,
      sourcePath,
      jevSettings(),
      async () => ({ kind: 'unavailable', reason: 'not_configured' }),
    );
    revisionPath = result.revisionPath;

    expect(result.targetPath).toBe(targetPath);
    expect(fs.existsSync(path.join(wikiPath, sourcePath))).toBe(false);
    expect(fs.readFileSync(path.join(wikiPath, revisionPath), 'utf8')).toContain(
      `Source fact ${id} is preserved`,
    );
    const target = fs.readFileSync(path.join(wikiPath, targetPath), 'utf8');
    expect(target).toContain(`Established fact ${id} remains`);
    expect(target).toContain(`Source fact ${id} is preserved`);
    expect(target).not.toContain(path.posix.basename(sourcePath));
    expect(fs.readFileSync(path.join(wikiPath, '_manifest.json'), 'utf8')).toContain(revisionPath);
    expect(fs.readFileSync(path.join(wikiPath, '_index.md'), 'utf8')).not.toContain(sourcePath);
    expect(
      getDb()
        .prepare('SELECT status FROM wiki_pages WHERE path = ? ORDER BY version DESC LIMIT 1')
        .get(sourcePath),
    ).toMatchObject({ status: 'superseded' });
    const targetClaims = getDb()
      .prepare(
        'SELECT COUNT(*) AS count FROM wiki_claims WHERE page_id = (SELECT id FROM wiki_pages WHERE path = ? AND status = ? ORDER BY version DESC LIMIT 1)',
      )
      .get(targetPath, 'active') as { count: number };
    expect(targetClaims.count).toBeGreaterThan(0);
    expect(
      graphRepository.getAllNodesWithSource().filter((node) => node.sourceFile === sourcePath),
    ).toHaveLength(0);
    expect(
      getDb()
        .prepare('SELECT COUNT(*) AS count FROM wiki_search_documents WHERE source_path = ?')
        .get(sourcePath),
    ).toMatchObject({ count: 0 });
  });

  it('rejects an unsafe path without writing a snapshot or touching pages', async () => {
    const targetBefore = fs.readFileSync(path.join(wikiPath, targetPath), 'utf8');
    await expect(
      mergeExistingWikiPage(settings(), wikiPath, '../outside.md', jevSettings(), async () => ({
        kind: 'unavailable',
        reason: 'test',
      })),
    ).rejects.toThrow('路径必须是 Wiki 根目录');

    expect(fs.readFileSync(path.join(wikiPath, targetPath), 'utf8')).toBe(targetBefore);
    expect(fs.existsSync(path.join(wikiPath, '_manifest.json'))).toBe(false);
    expect(fs.existsSync(path.join(wikiPath, sourcePath))).toBe(true);
  });

  it('keeps source and target unchanged when no identity candidate is found', async () => {
    const sourceMarkdown = `---\ntitle: Totally Unrelated ${randomUUID()}\ntags: [source]\n---\n\nUnrelated source body.`;
    fs.writeFileSync(path.join(wikiPath, sourcePath), sourceMarkdown);
    const targetBefore = fs.readFileSync(path.join(wikiPath, targetPath), 'utf8');

    await expect(
      mergeExistingWikiPage(settings(), wikiPath, sourcePath, jevSettings(), async () => ({
        kind: 'unavailable',
        reason: 'test',
      })),
    ).rejects.toThrow('源页面已保留');

    expect(fs.readFileSync(path.join(wikiPath, sourcePath), 'utf8')).toBe(sourceMarkdown);
    expect(fs.readFileSync(path.join(wikiPath, targetPath), 'utf8')).toBe(targetBefore);
    expect(fs.existsSync(path.join(wikiPath, '_manifest.json'))).toBe(false);
  });

  it('rolls back the target and database when the graph update fails', async () => {
    const sourceBefore = fs.readFileSync(path.join(wikiPath, sourcePath), 'utf8');
    const targetBefore = fs.readFileSync(path.join(wikiPath, targetPath), 'utf8');
    vi.spyOn(graphService, 'mergeWikiPageNode').mockImplementationOnce(() => {
      throw new Error('graph write failed');
    });

    await expect(
      mergeExistingWikiPage(settings(), wikiPath, sourcePath, jevSettings(), async () => ({
        kind: 'unavailable',
        reason: 'test',
      })),
    ).rejects.toThrow('graph write failed');

    expect(fs.readFileSync(path.join(wikiPath, sourcePath), 'utf8')).toBe(sourceBefore);
    expect(fs.readFileSync(path.join(wikiPath, targetPath), 'utf8')).toBe(targetBefore);
    expect(fs.existsSync(path.join(wikiPath, '_manifest.json'))).toBe(false);
    expect(fs.readdirSync(path.join(wikiPath, 'sources', 'wiki-merge-revisions'))).toHaveLength(1);
    expect(
      getDb()
        .prepare('SELECT status FROM wiki_pages WHERE path = ? ORDER BY version DESC LIMIT 1')
        .get(sourcePath),
    ).toMatchObject({ status: 'active' });
  });
});
