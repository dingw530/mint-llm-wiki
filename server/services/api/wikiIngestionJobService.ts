import * as path from 'path';
import * as settingsService from './settingsService.js';
import { ingestWikiSource, buildWikiSourceText } from './wikiIngestionService.js';
import { captureWikiPage } from '../utils/wikiPageCapture.js';
import { isSupportedFile } from '../utils/fileParseService.js';
import {
  archiveWikiUpload,
  discardWikiStagedFile,
  readArchivedWikiFile,
  WikiUploadValidationError,
} from './wikiFileService.js';
import type {
  WikiJob,
  WikiJobResult,
  WikiUploadInput,
  WikiUploadStartResult,
  WikiChatIngestionInput,
  WikiJobStartResult,
  WikiCompileStage,
} from './wikiIngestionTypes.js';
import { getWikiCompileStageLabel } from './wikiIngestionTypes.js';
import { parseFile } from '../utils/fileParseService.js';
import * as jobStore from '../jobs/adapters/sqliteJobStore.js';
import type { AiSettings } from '../../types.js';
import { InProcessJobQueue, type JobQueue } from '../jobs/jobQueue.js';
import { createJobStoreAdapter, sqliteJobStore, type JobStore } from '../jobs/jobStore.js';
import { publishJobEvent, subscribeJobEvents, type JobEventListener } from '../jobs/jobEvents.js';

class CancelledJobError extends Error {}

/**
 * 将输入文件名映射为任务详情可用的原文预览类型。
 *
 * @param fileName 原始文件名
 * @returns 详情抽屉支持的预览类型
 */
function getSourcePreviewKind(fileName: string): WikiJobResult['sourcePreviewKind'] {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.txt') return 'text';
  if (extension === '.md') return 'markdown';
  if (extension === '.html' || extension === '.htm') return 'html';
  return 'unsupported';
}

export interface WikiIngestionJobDependencies {
  getAiSettings: typeof settingsService.getAiSettings;
  parseFile: typeof parseFile;
  ingestWikiSource: typeof ingestWikiSource;
  archiveWikiUpload: typeof archiveWikiUpload;
  discardWikiStagedFile: typeof discardWikiStagedFile;
  readArchivedWikiFile: typeof readArchivedWikiFile;
  createJob: typeof jobStore.createJob;
  updateJob: typeof jobStore.updateJob;
  getJob: typeof jobStore.getJob;
  getJobByIdempotencyKey: typeof jobStore.getByIdempotencyKey;
  listJobs: typeof jobStore.listJobs;
  removeJob: typeof jobStore.removeJob;
  getJobPayload: typeof jobStore.getJobPayload;
  countJobs: typeof jobStore.countJobs;
  claimNext: typeof jobStore.claimNext;
  recoverRunning: typeof jobStore.recoverRunning;
  queue: JobQueue;
  store: JobStore;
}

const defaultDependencies: WikiIngestionJobDependencies = {
  getAiSettings: () => settingsService.getAiSettings(),
  parseFile,
  ingestWikiSource,
  archiveWikiUpload,
  discardWikiStagedFile,
  readArchivedWikiFile,
  createJob: jobStore.createJob,
  updateJob: jobStore.updateJob,
  getJob: jobStore.getJob,
  getJobByIdempotencyKey: jobStore.getByIdempotencyKey,
  listJobs: jobStore.listJobs,
  removeJob: jobStore.removeJob,
  getJobPayload: jobStore.getJobPayload,
  countJobs: jobStore.countJobs,
  claimNext: jobStore.claimNext,
  recoverRunning: jobStore.recoverRunning,
  queue: new InProcessJobQueue(),
  store: sqliteJobStore,
};

/**
 * 创建 Wiki 摄入作业服务。依赖注入用于隔离文件系统、AI 编译器和 JobStore 的测试。
 */
export function createWikiIngestionJobService(
  dependencies: Partial<WikiIngestionJobDependencies> = {},
): WikiIngestionJobService {
  const merged = { ...defaultDependencies, ...dependencies };
  const store =
    dependencies.store ||
    createJobStoreAdapter({
      create: dependencies.createJob,
      get: dependencies.getJob,
      getByIdempotencyKey: dependencies.getJobByIdempotencyKey,
      list: dependencies.listJobs,
      count: dependencies.countJobs,
      update: dependencies.updateJob,
      getPayload: dependencies.getJobPayload,
      claimNext: dependencies.claimNext,
      recoverRunning: dependencies.recoverRunning,
      remove: dependencies.removeJob,
    });
  return new WikiIngestionJobService({ ...merged, store });
}

/**
 * 统一 Web 与 Electron 的 Wiki 上传、解析、编译和作业状态编排。
 */
export class WikiIngestionJobService {
  private started = false;

  constructor(private readonly dependencies: WikiIngestionJobDependencies) {}

  /** Start the durable ingestion worker exactly once. */
  startWorker(): void {
    if (this.started) return;
    this.started = true;
    this.dependencies.queue.start(() => this.runNext());
    this.dependencies.store.recoverRunning();
    this.dependencies.queue.enqueue('startup');
  }

  /** Stop accepting new queue work and wait for the current worker to finish. */
  shutdownWorker(): Promise<void> {
    if (!this.started) return Promise.resolve();
    this.started = false;
    return this.dependencies.queue.stop();
  }

  /** 订阅任务变化，供 Chat A2UI SSE 使用。 */
  subscribe(listener: JobEventListener): () => void {
    return subscribeJobEvents(listener);
  }

  /** 发布任务变化；任务存储仍是唯一事实来源。 */
  private updateJob(
    jobId: string,
    updates: Parameters<JobStore['update']>[1],
  ): WikiJob | undefined {
    const current = this.dependencies.store.get(jobId);
    if (current?.status === 'cancelled' && updates.status !== 'cancelled') return current;
    const job = this.dependencies.store.update(jobId, updates);
    if (job) publishJobEvent(job);
    return job;
  }

  /**
   * 校验并暂存上传文件，创建后台作业后立即返回。
   */
  start(input: WikiUploadInput): WikiUploadStartResult {
    const normalizedInput: WikiUploadInput = {
      ...input,
      size: input.buffer.length,
    };
    const settings = this.dependencies.getAiSettings();
    const wikiPath = settings.wikiPath;
    if (!wikiPath) {
      throw new WikiUploadValidationError('Wiki 路径未配置');
    }

    if (normalizedInput.idempotencyKey) {
      const existing = this.dependencies.store.getByIdempotencyKey(normalizedInput.idempotencyKey);
      if (existing)
        return {
          jobId: existing.id,
          sourceFile: String(this.dependencies.store.getPayload(existing.id).sourceFile || ''),
          fileName: existing.fileName,
          fileSize: existing.fileSize,
        };
    }

    const sourceFile = this.dependencies.archiveWikiUpload(wikiPath, settings, normalizedInput);
    const jobId = this.dependencies.store.create(normalizedInput.name, normalizedInput.size, {
      sourceType: 'upload',
      fileCount: 1,
      payload: { sourceFile },
      idempotencyKey: normalizedInput.idempotencyKey,
    });
    const job = this.getStatus(jobId);
    if (job) publishJobEvent(job);
    this.dependencies.queue.enqueue(jobId);

    return {
      jobId,
      sourceFile,
      fileName: normalizedInput.name,
      fileSize: normalizedInput.size,
    };
  }

  /** 创建 Chat 异步摄入任务；文件在入队前暂存，后台任务只读取暂存路径。 */
  startChat(input: WikiChatIngestionInput, conversationId?: string): WikiJobStartResult {
    const settings = this.dependencies.getAiSettings();
    const wikiPath = settings.wikiPath;
    if (!wikiPath) throw new WikiUploadValidationError('Wiki 路径未配置');
    if (!input.source?.trim() && !input.urls?.length && !input.files?.length) {
      throw new WikiUploadValidationError('请提供 source、urls 或 files');
    }

    if (input.idempotencyKey) {
      const existing = this.dependencies.store.getByIdempotencyKey(input.idempotencyKey);
      if (existing)
        return {
          jobId: existing.id,
          status: 'queued',
          executionMode: 'async',
          fileCount: existing.fileCount || 1,
          message: '已加入知识摄入任务',
        };
    }

    const archivedFiles: Array<{ name: string; existingRelativePath: string }> = [];
    let totalSize = 0;
    try {
      for (const file of input.files || []) {
        if (!isSupportedFile(file.name)) {
          throw new WikiUploadValidationError(`不支持的文件类型: ${path.extname(file.name)}`);
        }
        const buffer = Buffer.from(file.content, 'base64');
        if (settings.wikiMaxFileSize > 0 && buffer.length > settings.wikiMaxFileSize) {
          throw new WikiUploadValidationError(`文件 ${file.name} 超过大小限制`);
        }
        const sourceFile = this.dependencies.archiveWikiUpload(wikiPath, settings, {
          name: file.name,
          size: buffer.length,
          buffer,
        });
        archivedFiles.push({ name: file.name, existingRelativePath: sourceFile });
        totalSize += buffer.length;
      }
    } catch (error: unknown) {
      archivedFiles.forEach((file) =>
        this.dependencies.discardWikiStagedFile(wikiPath, file.existingRelativePath),
      );
      throw error;
    }

    const fileCount = (input.files?.length || 0) + (input.urls?.length || 0);
    const jobId = this.dependencies.store.create(
      input.title || input.files?.[0]?.name || 'Chat Wiki 摄入',
      totalSize,
      {
        sourceType: 'chat',
        conversationId: conversationId || null,
        fileCount: Math.max(fileCount, 1),
        payload: { ...input, files: archivedFiles },
        idempotencyKey: input.idempotencyKey,
      },
    );
    const job = this.getStatus(jobId);
    if (job) publishJobEvent(job);
    this.dependencies.queue.enqueue(jobId);
    return {
      jobId,
      status: 'queued',
      executionMode: 'async',
      fileCount: Math.max(fileCount, 1),
      message: '已加入知识摄入任务',
    };
  }

  /** 从持久化 payload 领取并执行一个任务。 */
  private async runNext(): Promise<void> {
    const claimed = this.dependencies.store.claimNext();
    if (!claimed) return;
    try {
      const settings = this.dependencies.getAiSettings();
      const payload = this.dependencies.store.getPayload(claimed.id);
      if (claimed.sourceType === 'chat') {
        const archivedFiles = Array.isArray(payload.files)
          ? (payload.files as Array<{ name: string; existingRelativePath: string }>)
          : [];
        await this.runChat(claimed.id, payload as WikiChatIngestionInput, settings, archivedFiles);
      } else {
        await this.run(
          claimed.id,
          { name: claimed.fileName, size: claimed.fileSize, buffer: Buffer.alloc(0) },
          settings,
          typeof payload.sourceFile === 'string' ? payload.sourceFile : '',
        );
      }
    } catch (error: unknown) {
      this.markError(claimed.id, error);
    } finally {
      this.dependencies.queue.enqueue(claimed.id);
    }
  }

  /** 按 Wiki 路径串行保护包含最终文件提交的摄入操作。 */
  private static readonly commitTails = new Map<string, Promise<void>>();

  private async withWikiCommitLock<T>(wikiPath: string, operation: () => Promise<T>): Promise<T> {
    const previous = WikiIngestionJobService.commitTails.get(wikiPath) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    WikiIngestionJobService.commitTails.set(wikiPath, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (WikiIngestionJobService.commitTails.get(wikiPath) === tail)
        WikiIngestionJobService.commitTails.delete(wikiPath);
    }
  }

  /** 在可能产生 Wiki 写入前确认任务仍可继续。 */
  private assertNotCancelled(jobId: string): void {
    if (this.dependencies.store.get(jobId)?.status === 'cancelled')
      throw new CancelledJobError('任务已取消');
  }

  /** 清理已取消或被移除任务留下的暂存输入，不触碰正式 Wiki 来源。 */
  private discardJobStagedInputs(jobId: string, wikiPath: string): void {
    const payload = this.dependencies.store.getPayload(jobId);
    const paths: string[] = [];
    if (typeof payload.sourceFile === 'string') paths.push(payload.sourceFile);
    if (Array.isArray(payload.files)) {
      for (const file of payload.files) {
        if (!file || typeof file !== 'object') continue;
        const relativePath = (file as { existingRelativePath?: unknown }).existingRelativePath;
        if (typeof relativePath === 'string') paths.push(relativePath);
      }
    }
    paths.forEach((relativePath) =>
      this.dependencies.discardWikiStagedFile(wikiPath, relativePath),
    );
  }

  /** 将编译器阶段映射为当前任务的可见进度。 */
  private updateCompileStage(jobId: string, stage: WikiCompileStage, progress: number): void {
    this.updateJob(jobId, { status: 'compiling', progress, step: getWikiCompileStageLabel(stage) });
  }

  /** 执行 Chat 摄入任务，复用统一 Wiki 编译服务。 */
  async runChat(
    jobId: string,
    input: WikiChatIngestionInput,
    settings: AiSettings,
    archivedFiles: Array<{ name: string; existingRelativePath: string }>,
  ): Promise<void> {
    try {
      this.updateJob(jobId, { status: 'parsing', progress: 25, step: '解析资料中' });
      const segments: Array<{ kind: 'url' | 'file'; name: string; content: string }> = [];
      const capturedTitles: string[] = [];
      for (const url of input.urls || []) {
        const captured = await captureWikiPage(url);
        const parsed = await this.dependencies.parseFile({
          name: `${captured.title || 'web-page'}.html`,
          content: Buffer.from(captured.content, 'utf-8'),
          size: Buffer.byteLength(captured.content),
        });
        segments.push({ kind: 'url', name: captured.title || url, content: parsed.text });
        if (captured.title) capturedTitles.push(captured.title);
      }
      for (const file of archivedFiles) {
        const content = this.dependencies.readArchivedWikiFile(
          settings.wikiPath,
          file.existingRelativePath,
        );
        const parsed = await this.dependencies.parseFile({
          name: file.name,
          content,
          size: content.length,
        });
        segments.push({ kind: 'file', name: file.name, content: parsed.text });
      }
      if (capturedTitles[0]) {
        this.updateJob(jobId, { fileName: capturedTitles[0] });
      }
      const sourceText = buildWikiSourceText(input.source || '', segments);
      if (!sourceText.trim()) throw new Error('未获取到有效内容');
      this.updateCompileStage(jobId, 'prepare', 60);
      const items = [
        ...(input.source?.trim()
          ? [
              {
                name: input.title || '原始资料',
                content: input.source,
                files: [] as Array<{ name: string; existingRelativePath: string }>,
              },
            ]
          : []),
        ...segments.map((segment, index) => ({
          name: segment.name || `输入-${index + 1}`,
          content: segment.content,
          files:
            segment.kind === 'file'
              ? ([
                  archivedFiles.find((file) => file.name === segment.name) || archivedFiles[index],
                ].filter(Boolean) as Array<{ name: string; existingRelativePath: string }>)
              : [],
        })),
      ];
      const successfulResults: WikiJobResult[] = [];
      const failedItems: Array<{ name: string; error: string }> = [];
      for (const [index, item] of items.entries()) {
        this.assertNotCancelled(jobId);
        try {
          const sourceTitle = item.name.replace(/\.[^.]+$/, '') || `untitled-${index + 1}`;
          const compiled = await this.withWikiCommitLock(settings.wikiPath, () =>
            this.dependencies.ingestWikiSource(settings, settings.wikiPath, {
              sourceText: buildWikiSourceText('', [
                { kind: 'file', name: item.name, content: item.content },
              ]),
              sourceTitle,
              sourceFilenameHint: sourceTitle,
              category: input.category,
              archivedFiles: item.files,
              retainStagedFilesOnError: true,
              onCompileProgress: (stage) => {
                const stageProgress =
                  60 +
                  Math.round(
                    ((index + ({ prepare: 0, evidence: 1, pages: 2 }[stage] || 0)) / 3) *
                      (29 / items.length),
                  );
                this.updateCompileStage(jobId, stage, Math.min(89, stageProgress));
              },
            }),
          );
          successfulResults.push({
            sourceFile: compiled.sourceFile,
            format: 'mixed',
            textLength: item.content.length,
            preview: item.content.slice(0, 500),
            pages: compiled.pages,
            graphErrors: compiled.graphErrors,
          });
        } catch (error: unknown) {
          if (error instanceof CancelledJobError) throw error;
          failedItems.push({
            name: item.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        this.updateJob(jobId, {
          progress: Math.min(89, 60 + Math.round(((index + 1) / items.length) * 29)),
          step: '正在生成知识页面',
        });
      }
      if (failedItems.length === items.length) {
        this.updateJob(jobId, {
          status: 'failed',
          progress: 100,
          step: '处理失败',
          error: failedItems.map((item) => `${item.name}: ${item.error}`).join('; '),
        });
        return;
      }
      this.updateJob(jobId, {
        status: 'committing',
        progress: 90,
        step: '提交 Wiki 中',
      });
      const result: WikiJobResult = {
        sourceFile: successfulResults[0]?.sourceFile || '',
        format: 'mixed',
        textLength: sourceText.length,
        preview: sourceText.slice(0, 500),
        pages: successfulResults.flatMap((item) => item.pages || []),
        graphErrors: successfulResults.flatMap((item) => item.graphErrors || []),
        sourceUrls: input.urls?.length ? input.urls : undefined,
        sourcePreviewKind: input.source?.trim()
          ? 'markdown'
          : archivedFiles[0]
            ? getSourcePreviewKind(archivedFiles[0].name)
            : 'unsupported',
        ...(failedItems.length ? { failedItems } : {}),
      };
      this.updateJob(jobId, {
        status: failedItems.length ? 'partial_failed' : 'completed',
        progress: 100,
        step: failedItems.length
          ? '部分完成'
          : result.graphErrors?.length
            ? '完成（图谱警告）'
            : '完成',
        result,
      });
    } catch (error: unknown) {
      if (error instanceof CancelledJobError) {
        this.discardJobStagedInputs(jobId, settings.wikiPath);
      } else {
        this.markError(jobId, error);
      }
    }
  }

  /**
   * 执行一个已创建的摄入作业。该方法公开以便测试验证完整状态序列。
   */
  async run(
    jobId: string,
    input: WikiUploadInput,
    settings: AiSettings,
    sourceFile: string,
  ): Promise<void> {
    try {
      this.updateJob(jobId, { status: 'parsing', progress: 30, step: '解析文件中' });
      const content = this.dependencies.readArchivedWikiFile(settings.wikiPath, sourceFile);
      const parsed = await this.dependencies.parseFile({
        name: input.name,
        content,
        size: content.length,
      });
      const preview =
        parsed.text.length > 500 ? `${parsed.text.substring(0, 500)}\n...` : parsed.text;

      this.updateCompileStage(jobId, 'prepare', 60);
      const compiled = await this.withWikiCommitLock(settings.wikiPath, () =>
        this.dependencies.ingestWikiSource(settings, settings.wikiPath, {
          sourceText: buildWikiSourceText('', [
            { kind: 'file', name: input.name, content: parsed.text },
          ]),
          sourceTitle: input.name.replace(/\.[^.]+$/, ''),
          sourceFilenameHint: path.basename(sourceFile),
          archivedFiles: [{ name: input.name, existingRelativePath: sourceFile }],
          retainStagedFilesOnError: true,
          onCompileProgress: (stage) => {
            const stageProgress =
              60 + Math.round(({ prepare: 0, evidence: 1, pages: 2 }[stage] / 3) * 29);
            this.updateCompileStage(jobId, stage, Math.min(89, stageProgress));
          },
        }),
      );

      const result: WikiJobResult = {
        sourceFile: compiled.sourceFile || sourceFile,
        format: parsed.format,
        textLength: parsed.text.length,
        pageCount: parsed.pageCount,
        preview,
        pages: compiled.pages.length > 0 ? compiled.pages : undefined,
        graphErrors: compiled.graphErrors,
        sourcePreviewKind: getSourcePreviewKind(input.name),
      };
      const hasGraphWarnings = Boolean(compiled.graphErrors && compiled.graphErrors.length > 0);
      this.updateJob(jobId, {
        status: 'committing',
        progress: 90,
        step: '提交 Wiki 中',
      });
      this.updateJob(jobId, {
        status: 'completed',
        progress: 100,
        step: hasGraphWarnings ? '完成（图谱警告）' : '完成',
        result,
      });
    } catch (error: unknown) {
      if (error instanceof CancelledJobError) {
        this.discardJobStagedInputs(jobId, settings.wikiPath);
      } else {
        this.markError(jobId, error);
      }
    }
  }

  /**
   * 查询作业状态，保持入口层的统一返回类型。
   */
  getStatus(jobId: string): WikiJob | undefined {
    return this.dependencies.store.get(jobId);
  }

  /** 获取任务详情；不存在时返回标准 HTTP 404 错误。 */
  getRequiredStatus(jobId: string): WikiJob {
    const job = this.getStatus(jobId);
    if (!job) {
      const error = new WikiUploadValidationError('任务不存在或已过期');
      Object.defineProperty(error, 'status', { value: 404, writable: true, configurable: true });
      throw error;
    }
    return job;
  }

  /** 查询任务看板数据。 */
  list(filter: Parameters<typeof jobStore.listJobs>[0] = {}): WikiJob[] {
    return this.dependencies.store.list(filter);
  }

  /** 为 HTTP 与 IPC 提供统一的任务列表返回形状。 */
  listForApi(status?: string, limit?: number): { jobs: WikiJob[]; total: number } {
    const jobs = this.list({ status: status as WikiJob['status'] | undefined, limit });
    return { jobs, total: this.dependencies.store.count(status as WikiJob['status'] | undefined) };
  }

  /** 取消仍处于排队或执行早期的任务。 */
  cancel(jobId: string): WikiJob {
    const job = this.getStatus(jobId);
    if (!job) throw new WikiUploadValidationError('任务不存在或已过期');
    if (!['queued', 'pending', 'parsing', 'compiling'].includes(job.status)) {
      throw new WikiUploadValidationError('当前任务阶段不支持取消');
    }
    const updated = this.updateJob(jobId, {
      status: 'cancelled',
      progress: job.progress,
      step: '已取消',
    });
    if (!updated) throw new WikiUploadValidationError('任务不存在或已过期');
    return updated;
  }

  /** 重置失败任务并重新执行。 */
  retry(jobId: string): WikiJob {
    const job = this.getStatus(jobId);
    if (!job) throw new WikiUploadValidationError('任务不存在或已过期');
    if (!['error', 'failed', 'partial_failed'].includes(job.status)) {
      throw new WikiUploadValidationError('当前任务状态不支持重试');
    }
    const updated = this.updateJob(jobId, {
      status: 'queued',
      progress: 0,
      step: '等待重试',
      error: undefined,
      result: undefined,
    });
    if (!updated) throw new WikiUploadValidationError('任务不存在或已过期');
    this.dependencies.queue.enqueue(jobId);
    return updated;
  }

  /** 移除终态任务记录；不会删除来源文件或已生成的 Wiki 页面。 */
  remove(jobId: string): { success: true; jobId: string } {
    const job = this.getStatus(jobId);
    if (!job) throw new WikiUploadValidationError('任务不存在或已过期');
    if (!job.isTerminal) throw new WikiUploadValidationError('处理中任务不能移除');
    const settings = this.dependencies.getAiSettings();
    this.discardJobStagedInputs(jobId, settings.wikiPath);
    if (!this.dependencies.store.remove(jobId)) throw new WikiUploadValidationError('任务移除失败');
    return { success: true, jobId };
  }

  private markError(jobId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.updateJob(jobId, {
      status: 'failed',
      progress: 100,
      step: '处理失败',
      error: message,
    });
  }
}

export const wikiIngestionJobService = createWikiIngestionJobService();
