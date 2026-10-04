import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

vi.mock('../wiki-compiler.js', () => ({
  compileSource: vi.fn(),
}));

vi.mock('../../../services/utils/wikiShared.js', () => ({
  appendWikiManifestEntry: vi.fn(),
  updateIndexMd: vi.fn(),
  writePreparedWikiPages: vi.fn((_wikiPath, pages) =>
    pages.map((page) => ({
      filename: page.filename,
      title: page.title,
      size: Buffer.byteLength(page.content),
      summary: page.summary || page.content,
    })),
  ),
}));

vi.mock('../../knowledge-graph/index.js', () => ({
  buildGraphFromPages: vi.fn(() => ({ nodesCreated: 0, edgesCreated: 0, errors: [] })),
  generateCrossBatchCandidates: vi.fn(),
}));

vi.mock('../wiki-knowledge-lifecycle-service.js', () => ({
  registerCompiledKnowledge: vi.fn(),
}));

vi.mock('../wiki-search-service.js', () => ({
  rebuildWikiSearchIndex: vi.fn(),
}));

import * as wikiIngestionService from '../wiki-ingestion-service.js';
import { compileSource } from '../wiki-compiler.js';
import { stageWikiRawFile } from '../../../infrastructure/filesystem/wiki-ingestion-files.js';
import { rebuildWikiSearchIndex } from '../wiki-search-service.js';
import type { AiSettings } from '../../../types.js';
import * as jobStore from '../../../infrastructure/jobs/sqlite-job-store.js';
import * as commitRepository from '../../../infrastructure/persistence/wiki-ingestion-commit-repository.js';

describe('wikiIngestionService', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-ingest-'));
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'sources'), { recursive: true });
    vi.clearAllMocks();
  });

  describe('archiveWikiRawFile', () => {
    it('saves file to sources/ with date prefix', () => {
      const buffer = Buffer.from('test content');
      // Create sources dir
      fs.mkdirSync(path.join(tmpDir, 'sources'), { recursive: true });

      const relativePath = wikiIngestionService.archiveWikiRawFile(tmpDir, 'test.txt', buffer);
      expect(relativePath).toContain('sources/');
      expect(relativePath).toContain('.txt');

      const fullPath = path.join(tmpDir, relativePath);
      expect(fs.existsSync(fullPath)).toBe(true);
      expect(fs.readFileSync(fullPath, 'utf-8')).toBe('test content');
    });

    it('handles slugified filenames', () => {
      const buffer = Buffer.from('content');
      fs.mkdirSync(path.join(tmpDir, 'sources'), { recursive: true });

      const relativePath = wikiIngestionService.archiveWikiRawFile(
        tmpDir,
        'My Great File!!.md',
        buffer,
      );
      expect(relativePath).toContain('.md');
      // Should be lowercased and slugified
      expect(relativePath).not.toContain('My Great File');
    });

    it('avoids overwriting with counter suffix', () => {
      const buffer = Buffer.from('content');
      fs.mkdirSync(path.join(tmpDir, 'sources'), { recursive: true });

      const first = wikiIngestionService.archiveWikiRawFile(tmpDir, 'dup.txt', buffer);
      const second = wikiIngestionService.archiveWikiRawFile(tmpDir, 'dup.txt', buffer);
      expect(first).not.toBe(second);
    });
  });

  describe('buildWikiSourceText', () => {
    it('combines base text with segments', () => {
      const result = wikiIngestionService.buildWikiSourceText('base text', [
        { kind: 'url', name: 'https://example.com', content: 'web content' },
        { kind: 'file', name: 'notes.txt', content: 'file content' },
      ]);
      expect(result).toContain('base text');
      expect(result).toContain('来源');
      expect(result).toContain('web content');
      expect(result).toContain('文件');
      expect(result).toContain('file content');
    });

    it('handles empty segments', () => {
      const result = wikiIngestionService.buildWikiSourceText('just text');
      expect(result).toBe('just text');
    });

    it('does not leave a source file after compilation fails', async () => {
      const staged = stageWikiRawFile(tmpDir, 'failed.md', Buffer.from('failed'));
      vi.mocked(compileSource).mockRejectedValueOnce(new Error('evidence rejected'));
      const ingestionSettings = { wikiPath: tmpDir } as AiSettings;

      await expect(
        wikiIngestionService.ingestWikiSource(ingestionSettings, tmpDir, {
          sourceText: 'failed',
          sourceTitle: 'failed',
          archivedFiles: [{ name: 'failed.md', existingRelativePath: staged }],
        }),
      ).rejects.toThrow('evidence rejected');

      expect(fs.readdirSync(path.join(tmpDir, 'sources'))).toHaveLength(0);
    });

    it('retains the staged input when a retryable job compilation fails', async () => {
      const staged = stageWikiRawFile(tmpDir, 'retry.md', Buffer.from('retry'));
      vi.mocked(compileSource).mockRejectedValueOnce(new Error('temporary failure'));

      await expect(
        wikiIngestionService.ingestWikiSource({ wikiPath: tmpDir } as AiSettings, tmpDir, {
          sourceText: 'retry',
          sourceTitle: 'retry',
          archivedFiles: [{ name: 'retry.md', existingRelativePath: staged }],
          retainStagedFilesOnError: true,
        }),
      ).rejects.toThrow('temporary failure');

      expect(fs.existsSync(path.join(tmpDir, staged))).toBe(true);
      expect(fs.readdirSync(path.join(tmpDir, 'sources'))).toHaveLength(0);
    });

    it('moves the source into sources only after the ingestion pipeline succeeds', async () => {
      const staged = stageWikiRawFile(tmpDir, 'success.md', Buffer.from('success'));
      const page = {
        filename: 'pages/success.md',
        title: 'Success',
        tags: [],
        content: '# Success\n\n已验证内容',
      };
      vi.mocked(compileSource).mockResolvedValueOnce({
        pages: [
          {
            filename: page.filename,
            title: page.title,
            size: page.content.length,
            summary: 'done',
          },
        ],
        compiledPages: [page],
        relationships: [],
        claims: [],
        summary: 'done',
      });

      const result = await wikiIngestionService.ingestWikiSource(
        { wikiPath: tmpDir } as AiSettings,
        tmpDir,
        {
          sourceText: 'success',
          sourceTitle: 'success',
          archivedFiles: [{ name: 'success.md', existingRelativePath: staged }],
        },
      );

      expect(result.sourceFile).toMatch(/^sources\//);
      expect(fs.existsSync(path.join(tmpDir, result.sourceFile))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, staged))).toBe(false);
    });

    it('rolls back a finalized source when a later ingestion step fails', async () => {
      const staged = stageWikiRawFile(tmpDir, 'index-failure.md', Buffer.from('index failure'));
      vi.mocked(compileSource).mockResolvedValueOnce({
        pages: [],
        compiledPages: [],
        relationships: [],
        claims: [],
        summary: 'done',
      });
      vi.mocked(rebuildWikiSearchIndex).mockRejectedValueOnce(new Error('index failed'));

      await expect(
        wikiIngestionService.ingestWikiSource({ wikiPath: tmpDir } as AiSettings, tmpDir, {
          sourceText: 'index failure',
          sourceTitle: 'index-failure',
          archivedFiles: [{ name: 'index-failure.md', existingRelativePath: staged }],
        }),
      ).rejects.toThrow('index failed');

      expect(fs.readdirSync(path.join(tmpDir, 'sources'))).toHaveLength(0);
    });

    it('resumes a durable commit from its snapshot without recompiling or duplicating the source', async () => {
      const staged = stageWikiRawFile(tmpDir, 'recovery.md', Buffer.from('recovery source'));
      const jobId = jobStore.createJob('recovery.md', 15, {
        sourceType: 'upload',
        payload: { sourceFile: staged },
      });
      const page = {
        filename: 'pages/recovery/recovered.md',
        title: 'Recovered',
        tags: [],
        content: '# Recovered\n\nEvidence',
      };
      vi.mocked(compileSource).mockResolvedValueOnce({
        pages: [{ filename: page.filename, title: page.title, size: 30, summary: 'Evidence' }],
        compiledPages: [page],
        relationships: [],
        claims: [],
        summary: 'recovered',
      });
      const request = {
        sourceText: 'recovery source',
        sourceTitle: 'recovery',
        archivedFiles: [{ name: 'recovery.md', existingRelativePath: staged }],
        retainStagedFilesOnError: true,
        commit: { jobId, itemKey: 'upload' },
      };

      const first = await wikiIngestionService.ingestWikiSource(
        { wikiPath: tmpDir } as AiSettings,
        tmpDir,
        request,
      );
      const second = await wikiIngestionService.ingestWikiSource(
        { wikiPath: tmpDir } as AiSettings,
        tmpDir,
        request,
      );

      const commit = commitRepository.getWikiIngestionCommit(jobId, 'upload');
      expect(vi.mocked(compileSource)).toHaveBeenCalledTimes(1);
      expect(second.manifestId).toBe(first.manifestId);
      expect(commit?.phase).toBe('committed');
      expect(fs.readdirSync(path.join(tmpDir, 'sources'))).toHaveLength(1);
      expect(fs.existsSync(path.join(tmpDir, staged))).toBe(true);

      wikiIngestionService.cleanupWikiIngestionJobStagedFiles(tmpDir, jobId);
      expect(fs.existsSync(path.join(tmpDir, staged))).toBe(false);
    });
  });
});
