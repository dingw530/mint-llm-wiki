import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWikiIngestionJobService } from '../wikiIngestionJobService.js';
import type { WikiJob, WikiUploadInput, WikiChatIngestionInput } from '../wikiIngestionTypes.js';
import type { JobStore } from '../../jobs/jobStore.js';
import type { JobQueue } from '../../jobs/jobQueue.js';
import type { AiSettings } from '../../../types.js';

const settings = {
  wikiPath: '/tmp/test-wiki',
  wikiMaxFileSize: 1024,
} as AiSettings;

const input: WikiUploadInput = {
  name: 'notes.md',
  size: 5,
  buffer: Buffer.from('hello'),
};

describe('wikiIngestionJobService', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('drains persisted queued jobs when the worker starts', () => {
    const queue: JobQueue = {
      start: vi.fn(),
      enqueue: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const store = {
      recoverRunning: vi.fn(() => 0),
      claimNext: vi.fn(() => undefined),
    } as unknown as JobStore;
    const service = createWikiIngestionJobService({ queue, store });

    service.startWorker();
    service.startWorker();

    expect(queue.start).toHaveBeenCalledTimes(1);
    expect(store.recoverRunning).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith('startup');
  });

  it('starts a job and exposes the compatibility response', () => {
    const createJob = vi.fn(() => 'job-1');
    const archiveWikiUpload = vi.fn(() => 'sources/notes.md');
    const service = createWikiIngestionJobService({
      getAiSettings: () => settings,
      archiveWikiUpload,
      createJob,
      readArchivedWikiFile: () => Buffer.from('hello'),
      parseFile: async () => ({ text: 'hello', format: 'md', originalName: 'notes.md' }),
      ingestWikiSource: async () => ({
        sourceFile: 'sources/notes.md',
        archivedFiles: ['sources/notes.md'],
        pages: [],
        summary: 'done',
        manifestId: 'manifest-1',
      }),
      updateJob: vi.fn(),
    });

    const result = service.start(input);
    expect(result).toEqual({
      jobId: 'job-1',
      sourceFile: 'sources/notes.md',
      fileName: 'notes.md',
      fileSize: 5,
    });
    expect(archiveWikiUpload).toHaveBeenCalledWith('/tmp/test-wiki', settings, input);
    expect(createJob).toHaveBeenCalledWith('notes.md', 5, {
      sourceType: 'upload',
      fileCount: 1,
      payload: { sourceFile: 'sources/notes.md' },
    });
  });

  it('records a successful result and graph warnings as done', async () => {
    const updates: Array<Partial<WikiJob>> = [];
    const service = createWikiIngestionJobService({
      readArchivedWikiFile: () => Buffer.from('hello'),
      parseFile: async () => ({ text: 'hello', format: 'md', originalName: 'notes.md' }),
      ingestWikiSource: async () => ({
        sourceFile: 'sources/notes.md',
        archivedFiles: ['sources/notes.md'],
        pages: [{ filename: 'page.md', title: 'Page', size: 10 }],
        summary: 'done',
        manifestId: 'manifest-1',
        graphErrors: ['edge failed'],
      }),
      updateJob: vi.fn((_id, patch) => {
        updates.push(patch);
        return undefined;
      }),
    });

    await service.run('job-1', input, settings, 'sources/notes.md');

    expect(updates.map((update) => update.status)).toEqual([
      'parsing',
      'compiling',
      'committing',
      'completed',
    ]);
    expect(updates[3]).toMatchObject({
      status: 'completed',
      progress: 100,
      step: '完成（图谱警告）',
      result: expect.objectContaining({ graphErrors: ['edge failed'] }),
    });
  });

  it('marks parse failures as error', async () => {
    const updates: Array<Partial<WikiJob>> = [];
    const service = createWikiIngestionJobService({
      readArchivedWikiFile: () => Buffer.from('hello'),
      parseFile: async () => {
        throw new Error('parse failed');
      },
      updateJob: vi.fn((_id, patch) => {
        updates.push(patch);
        return undefined;
      }),
    });

    await service.run('job-1', input, settings, 'sources/notes.md');

    expect(updates.at(-1)).toMatchObject({
      status: 'failed',
      progress: 100,
      step: '处理失败',
      error: 'parse failed',
    });
  });

  it('marks compile failures as error', async () => {
    const updates: Array<Partial<WikiJob>> = [];
    const service = createWikiIngestionJobService({
      readArchivedWikiFile: () => Buffer.from('hello'),
      parseFile: async () => ({ text: 'hello', format: 'md', originalName: 'notes.md' }),
      ingestWikiSource: async () => {
        throw new Error('compile failed');
      },
      updateJob: vi.fn((_id, patch) => {
        updates.push(patch);
        return undefined;
      }),
    });

    await service.run('job-1', input, settings, 'sources/notes.md');

    expect(updates.at(-1)).toMatchObject({
      status: 'failed',
      error: 'compile failed',
    });
  });

  it('does not create a job when archive validation fails', () => {
    const createJob = vi.fn(() => 'job-1');
    const service = createWikiIngestionJobService({
      getAiSettings: () => settings,
      archiveWikiUpload: () => {
        throw new Error('不支持的文件类型');
      },
      createJob,
    });

    expect(() => service.start(input)).toThrow('不支持的文件类型');
    expect(createJob).not.toHaveBeenCalled();
  });

  it('cleans already staged Chat files when a later file is invalid', () => {
    const discardWikiStagedFile = vi.fn();
    const service = createWikiIngestionJobService({
      getAiSettings: () => settings,
      archiveWikiUpload: (_path, _settings, file) => `ingestion-pending/${file.name}`,
      discardWikiStagedFile,
    });

    expect(() =>
      service.startChat({
        files: [
          { name: 'good.md', content: 'good' },
          { name: 'bad.exe', content: 'bad' },
        ],
      }),
    ).toThrow('不支持的文件类型');
    expect(discardWikiStagedFile).toHaveBeenCalledWith(
      '/tmp/test-wiki',
      'ingestion-pending/good.md',
    );
  });

  it('returns the existing job for a repeated idempotency key', () => {
    const existing = {
      id: 'job-existing',
      fileName: 'notes.md',
      fileSize: 5,
      fileCount: 1,
    } as WikiJob;
    const archiveWikiUpload = vi.fn(() => 'sources/notes.md');
    const store = {
      getByIdempotencyKey: vi.fn(() => existing),
      getPayload: vi.fn(() => ({ sourceFile: 'sources/notes.md' })),
      recoverRunning: vi.fn(() => 0),
      claimNext: vi.fn(() => undefined),
    } as unknown as JobStore;
    const service = createWikiIngestionJobService({
      getAiSettings: () => settings,
      archiveWikiUpload,
      store,
    });

    const result = service.start({ ...input, idempotencyKey: 'retry-1' });
    expect(result.jobId).toBe('job-existing');
    expect(archiveWikiUpload).not.toHaveBeenCalled();
  });

  it('preserves successful inputs when one chat input fails', async () => {
    const updates: Array<Partial<WikiJob>> = [];
    let current: WikiJob = {
      id: 'job-1',
      status: 'queued',
      fileName: 'batch',
      fileSize: 2,
      fileCount: 2,
      progress: 0,
      step: '等待处理',
      createdAt: '',
      updatedAt: '',
    };
    const store = {
      get: vi.fn(() => current),
      update: vi.fn((_id: string, patch: Partial<WikiJob>) => {
        current = { ...current, ...patch };
        updates.push(patch);
        return current;
      }),
      recoverRunning: vi.fn(() => 0),
      claimNext: vi.fn(() => undefined),
    } as unknown as JobStore;
    const input: WikiChatIngestionInput = {
      files: [
        { name: 'good.md', content: Buffer.from('good').toString('base64') },
        { name: 'bad.md', content: Buffer.from('bad').toString('base64') },
      ],
    };
    const service = createWikiIngestionJobService({
      getAiSettings: () => settings,
      store,
      archiveWikiUpload: (_path, _settings, file) => `sources/${file.name}`,
      readArchivedWikiFile: (_path, file) => Buffer.from(file.includes('bad') ? 'bad' : 'good'),
      parseFile: async ({ name }) => ({
        text: name.includes('bad') ? 'bad' : 'good',
        format: 'md',
        originalName: name,
      }),
      ingestWikiSource: async (_settings, _path, options) => {
        if (options.sourceText.includes('bad')) throw new Error('bad input');
        return {
          sourceFile: 'sources/good.md',
          archivedFiles: [],
          pages: [],
          summary: 'done',
          manifestId: 'manifest-1',
        };
      },
    });

    await service.runChat('job-1', input, settings, [
      { name: 'good.md', existingRelativePath: 'sources/good.md' },
      { name: 'bad.md', existingRelativePath: 'sources/bad.md' },
    ]);

    expect(updates.at(-1)).toMatchObject({ status: 'partial_failed' });
    expect(updates.at(-1)?.result).toMatchObject({
      failedItems: [{ name: 'bad.md', error: 'bad input' }],
    });
  });

  it('serializes Wiki commits for the same Wiki path', async () => {
    let active = 0;
    let maximum = 0;
    const current = {
      id: 'job-1',
      status: 'queued',
      fileName: 'batch',
      fileSize: 1,
      progress: 0,
      step: '等待处理',
      createdAt: '',
      updatedAt: '',
    } as WikiJob;
    const store = {
      get: vi.fn(() => current),
      update: vi.fn((_id: string, patch: Partial<WikiJob>) => ({ ...current, ...patch })),
      recoverRunning: vi.fn(() => 0),
      claimNext: vi.fn(() => undefined),
    } as unknown as JobStore;
    const service = createWikiIngestionJobService({
      store,
      readArchivedWikiFile: () => Buffer.from('hello'),
      parseFile: async () => ({ text: 'hello', format: 'md', originalName: 'notes.md' }),
      ingestWikiSource: async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return {
          sourceFile: 'sources/notes.md',
          archivedFiles: [],
          pages: [],
          summary: 'done',
          manifestId: 'manifest-1',
        };
      },
    });

    await Promise.all([
      service.run('job-1', input, settings, 'sources/one.md'),
      service.run('job-2', input, settings, 'sources/two.md'),
    ]);
    expect(maximum).toBe(1);
  });

  it('enforces retry and cancel state boundaries', () => {
    let current = {
      id: 'job-1',
      status: 'failed',
      fileName: 'notes.md',
      fileSize: 1,
      progress: 100,
      step: '处理失败',
      result: { sourceFile: 'sources/notes.md' },
      createdAt: '',
      updatedAt: '',
    } as WikiJob;
    const store = {
      get: vi.fn(() => current),
      update: vi.fn((_id: string, patch: Partial<WikiJob>) => {
        current = { ...current, ...patch };
        return current;
      }),
      recoverRunning: vi.fn(() => 0),
      claimNext: vi.fn(() => undefined),
    } as unknown as JobStore;
    const service = createWikiIngestionJobService({ store });
    expect(service.retry('job-1')).toMatchObject({
      status: 'queued',
      progress: 0,
      step: '等待重试',
      result: undefined,
    });
    expect(service.cancel('job-1').status).toBe('cancelled');
    expect(() => service.retry('job-1')).toThrow('当前任务状态不支持重试');
  });

  it('removes terminal jobs but rejects active jobs', () => {
    let current = {
      id: 'job-1',
      status: 'completed',
      fileName: 'notes.md',
      fileSize: 1,
      progress: 100,
      step: '完成',
      createdAt: '',
      updatedAt: '',
      isTerminal: true,
      isSuccessful: true,
    } as WikiJob;
    const remove = vi.fn(() => true);
    const store = {
      get: vi.fn(() => current),
      getPayload: vi.fn(() => ({})),
      remove,
      recoverRunning: vi.fn(() => 0),
      claimNext: vi.fn(() => undefined),
    } as unknown as JobStore;
    const service = createWikiIngestionJobService({ store });

    expect(service.remove('job-1')).toEqual({ success: true, jobId: 'job-1' });
    expect(remove).toHaveBeenCalledWith('job-1');
    current = { ...current, status: 'compiling', isTerminal: false };
    expect(() => service.remove('job-1')).toThrow('处理中任务不能移除');
  });
});
