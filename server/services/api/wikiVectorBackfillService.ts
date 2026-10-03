import * as backfillRepo from '../../repositories/wikiVectorBackfillRepository.js';
import { getAiSettings } from './settingsService.js';
import {
  rebuildWikiSearchIndex,
  backfillWikiEmbeddings,
  getWikiVectorHealth,
  listWikiSearchDocuments,
  hasWikiSearchDocuments,
} from '../../domains/wiki/index.js';
import type {
  OpenAICompatibleEmbeddingConfig,
  VectorHealth,
  WikiSearchDocument,
} from '../../domains/wiki/index.js';

export interface WikiVectorBackfillInput {
  scope: backfillRepo.WikiVectorBackfillScope;
  prefix?: string;
  paths?: string[];
}

export interface WikiVectorBackfillStartResult {
  job: backfillRepo.WikiVectorBackfillJob;
}

function embeddingConfig(): OpenAICompatibleEmbeddingConfig {
  const settings = getAiSettings();
  return {
    apiUrl: settings.embeddingApiUrl,
    model: settings.embeddingModel,
    dimensions: settings.embeddingDimensions,
    vectorStore: settings.vectorStore,
    chromaUrl: settings.chromaUrl,
    chromaApiKey: settings.chromaApiKey,
  };
}

function normalizedInput(input: WikiVectorBackfillInput): WikiVectorBackfillInput {
  return {
    scope: input.scope,
    prefix: input.scope === 'prefix' ? input.prefix?.trim() || '' : undefined,
    paths:
      input.scope === 'selected'
        ? [...new Set((input.paths || []).map((path) => path.trim()).filter(Boolean))]
        : undefined,
  };
}

function selectedDocuments(job: backfillRepo.WikiVectorBackfillJob): WikiSearchDocument[] {
  const documents = listWikiSearchDocuments();
  if (job.scope === 'prefix')
    return documents.filter((document) => document.sourcePath.startsWith(job.prefix || ''));
  if (job.scope === 'selected') {
    const paths = new Set(job.paths);
    return documents.filter((document) => paths.has(document.sourcePath));
  }
  return documents;
}

function startWorker(jobId: string): void {
  setTimeout(() => {
    void runWorker(jobId);
  }, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function runWorker(jobId: string): Promise<void> {
  const queued = backfillRepo.getRequiredJob(jobId);
  const settings = getAiSettings();
  try {
    if (!hasWikiSearchDocuments()) await rebuildWikiSearchIndex(settings.wikiPath);
    const documents = selectedDocuments(queued);
    backfillRepo.updateJob(jobId, {
      status: 'running',
      total: documents.length,
      processed: 0,
      indexed: 0,
      skipped: 0,
      failed: 0,
      currentPath: null,
      error: null,
      attempts: queued.attempts + 1,
    });
    const result = await backfillWikiEmbeddings(
      documents,
      embeddingConfig(),
      (processed, indexed, skipped, failed, currentPath) => {
        backfillRepo.updateJob(jobId, {
          status: 'running',
          total: documents.length,
          processed,
          indexed,
          skipped,
          failed,
          currentPath,
        });
      },
    );
    const status =
      result.failed === 0
        ? 'completed'
        : result.indexed + result.skipped > 0
          ? 'partial_failed'
          : 'failed';
    backfillRepo.updateJob(jobId, {
      status,
      total: documents.length,
      processed: documents.length,
      indexed: result.indexed,
      skipped: result.skipped,
      failed: result.failed,
      currentPath: null,
      error: result.failed > 0 ? '部分文档向量化失败，可重试' : null,
    });
  } catch (error) {
    backfillRepo.updateJob(jobId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      currentPath: null,
    });
  }
}

function parseInput(value: unknown): WikiVectorBackfillInput {
  if (!isRecord(value)) throw new Error('回填范围参数无效');
  const record = value;
  const scope = record.scope;
  if (scope !== 'all' && scope !== 'prefix' && scope !== 'selected')
    throw new Error('scope 必须是 all、prefix 或 selected');
  const prefix = typeof record.prefix === 'string' ? record.prefix : undefined;
  const paths = Array.isArray(record.paths)
    ? record.paths.filter((item): item is string => typeof item === 'string')
    : undefined;
  if (scope === 'prefix' && !prefix?.trim()) throw new Error('prefix 不能为空');
  if (scope === 'selected' && (!paths || paths.length === 0))
    throw new Error('selected scope 至少需要一个页面');
  return normalizedInput({ scope, prefix, paths });
}

/** 解析并启动一个异步向量回填任务。 */
export function start(input: unknown): WikiVectorBackfillStartResult {
  const normalized = parseInput(input);
  const job = backfillRepo.createJob(
    normalized.scope,
    normalized.prefix || null,
    normalized.paths || [],
  );
  startWorker(job.id);
  return { job };
}

/** 获取向量回填任务状态。 */
export function getStatus(jobId: string): backfillRepo.WikiVectorBackfillJob {
  return backfillRepo.getRequiredJob(jobId);
}

/** 获取当前 embedding 模型的向量索引健康度。 */
export async function getHealth(): Promise<VectorHealth> {
  return getWikiVectorHealth(embeddingConfig());
}

/** 重试失败或部分失败的回填任务。 */
export function retry(jobId: string): WikiVectorBackfillStartResult {
  const job = backfillRepo.getRequiredJob(jobId);
  if (job.status !== 'failed' && job.status !== 'partial_failed')
    throw new Error('当前任务状态不支持重试');
  const queued = backfillRepo.updateJob(jobId, {
    status: 'queued',
    processed: 0,
    indexed: 0,
    skipped: 0,
    failed: 0,
    currentPath: null,
    error: null,
  });
  startWorker(queued.id);
  return { job: queued };
}

export const wikiVectorBackfillService = { start, getStatus, getHealth, retry };
