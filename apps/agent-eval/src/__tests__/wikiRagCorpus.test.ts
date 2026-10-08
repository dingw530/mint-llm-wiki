import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingestWikiRagCorpus, prepareWikiRagCorpus } from '../wikiRagCorpus.js';

async function createCorpus(): Promise<{ root: string; rawDir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mint-wiki-rag-test-'));
  const rawDir = path.join(root, 'raw');
  await fs.mkdir(rawDir, { recursive: true });
  await fs.writeFile(path.join(rawDir, 'one.md'), '# One\n\nRAG uses retrieval.\n', 'utf8');
  await fs.writeFile(path.join(rawDir, 'two.html'), '<h1>Two</h1><p>Agent workflow.</p>', 'utf8');
  return { root, rawDir };
}

describe('wiki-rag corpus preparation', () => {
  it('creates a valid isolated fixture from source documents', async () => {
    const { root, rawDir } = await createCorpus();
    try {
      const outputDir = path.join(root, 'fixture');
      const report = await prepareWikiRagCorpus(rawDir, outputDir);
      expect(report.sources).toHaveLength(2);
      expect(await fs.readFile(path.join(outputDir, '_schema.json'), 'utf8')).toContain('eval');
      expect(await fs.readFile(path.join(outputDir, '_manifest.json'), 'utf8')).toContain('pages/eval/one.md');
      expect(await fs.readFile(path.join(outputDir, 'sources/one.md'), 'utf8')).toContain('RAG');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('runs every source through the official ingestion callback', async () => {
    const { root, rawDir } = await createCorpus();
    try {
      const outputDir = path.join(root, 'ingested');
      const progress: string[] = [];
      const report = await ingestWikiRagCorpus(rawDir, outputDir, { mode: 'test' }, async (_settings, wikiPath, request) => {
        const filename = `pages/eval/${request.sourceFilenameHint?.replace(/\.[^.]+$/, '') || 'source'}.md`;
        await fs.mkdir(path.dirname(path.join(wikiPath, filename)), { recursive: true });
        await fs.writeFile(path.join(wikiPath, filename), `---\ntitle: "${request.sourceTitle}"\nsource: "${request.archivedFiles?.[0]?.existingRelativePath || ''}"\n---\n\n${request.sourceText}\n`, 'utf8');
        return {
          sourceFile: request.archivedFiles?.[0]?.existingRelativePath || '',
          archivedFiles: request.archivedFiles?.map(file => file.existingRelativePath || '') || [],
          pages: [{ filename, title: request.sourceTitle, size: request.sourceText.length }],
          summary: 'test ingestion',
          manifestId: `test-${request.sourceTitle}`,
        };
      }, { onProgress: update => progress.push(`${update.phase}:${update.sourceFile}`) });
      expect(report.sources).toHaveLength(2);
      expect(progress).toEqual(['source_started:one.md', 'source_completed:one.md', 'source_started:two.html', 'source_completed:two.html']);
      expect(report.sources.every(source => source.result.pages.length === 1)).toBe(true);
      expect(await fs.readFile(path.join(outputDir, 'ingested-manifest.json'), 'utf8')).toContain('test ingestion');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('clears an existing output directory when requested', async () => {
    const { root, rawDir } = await createCorpus();
    try {
      const outputDir = path.join(root, 'ingested');
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(path.join(outputDir, 'stale.md'), 'stale', 'utf8');
      const report = await ingestWikiRagCorpus(rawDir, outputDir, { mode: 'test' }, async (_settings, wikiPath, request) => {
        const filename = `pages/eval/${request.sourceFilenameHint?.replace(/\.[^.]+$/, '') || 'source'}.md`;
        await fs.mkdir(path.dirname(path.join(wikiPath, filename)), { recursive: true });
        await fs.writeFile(path.join(wikiPath, filename), request.sourceText, 'utf8');
        return {
          sourceFile: request.archivedFiles?.[0]?.existingRelativePath || '',
          archivedFiles: request.archivedFiles?.map(file => file.existingRelativePath || '') || [],
          pages: [{ filename, title: request.sourceTitle, size: request.sourceText.length }],
          summary: 'test ingestion',
          manifestId: `test-${request.sourceTitle}`,
        };
      }, { clean: true });
      expect(report.sources).toHaveLength(2);
      await expect(fs.access(path.join(outputDir, 'stale.md'))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
