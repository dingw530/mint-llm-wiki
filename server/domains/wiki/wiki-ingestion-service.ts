import type { AiSettings } from '../../types.js';
import { compileSource, type WikiCompileProgressStage } from './wiki-compiler.js';
import { appendWikiManifestEntry } from '../../services/utils/wikiShared.js';
import { buildGraphFromPages } from '../knowledge-graph/index.js';
import { inferWikiGraphNodeType } from '../../infrastructure/filesystem/wiki-graph-metadata.js';
import { generateCrossBatchCandidates } from '../knowledge-graph/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  discardWikiStagedFile,
  finalizeWikiSourceFile,
  rollbackWikiSourceFile,
  isStagedWikiFile,
  stageWikiRawFile,
  stageWikiSourceText,
} from '../../infrastructure/filesystem/wiki-ingestion-files.js';
import { registerCompiledKnowledge } from './wiki-knowledge-lifecycle-service.js';
import { rebuildWikiSearchIndex } from './wiki-search-service.js';
import type { OpenAICompatibleEmbeddingConfig } from '../../infrastructure/search/vector/types.js';
import type { WikiPageSummary } from './wiki-ingestion-types.js';
import type { CompiledPage, Relationship } from '../../services/utils/wikiShared.js';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import * as commitRepository from '../../infrastructure/persistence/wiki-ingestion-commit-repository.js';
import type {
  WikiIngestionCommit,
  WikiIngestionCommitPhase,
} from '../../infrastructure/persistence/wiki-ingestion-commit-repository.js';
import { updateIndexMd, writePreparedWikiPages } from '../../services/utils/wikiShared.js';
import { finalizeWikiSourceFileTo } from '../../infrastructure/filesystem/wiki-ingestion-files.js';

export {
  archiveWikiRawFile,
  buildWikiSourceText,
} from '../../infrastructure/filesystem/wiki-ingestion-files.js';
export type { WikiSourceSegment } from './wiki-ingestion-types.js';

const log = createLogger('wiki-ingestion');

/**
 * 原始归档文件输入。上传链路可直接传 buffer，异步作业链路可复用既有相对路径。
 */
export interface WikiArchivedFileInput {
  name: string;
  buffer?: Buffer;
  existingRelativePath?: string;
}

/**
 * 共享编译服务的标准入参，覆盖文本源、归档文件和分类提示。
 */
export interface WikiIngestionRequest {
  sourceText: string;
  sourceTitle: string;
  sourceFilenameHint?: string;
  category?: string;
  summaryHint?: string;
  archivedFiles?: WikiArchivedFileInput[];
  /** 异步可重试任务失败时保留其暂存输入；成功后仍会 finalize。 */
  retainStagedFilesOnError?: boolean;
  /** Stable identity for a durable asynchronous job item. */
  commit?: { jobId: string; itemKey: string };
  /** 将真实编译阶段转发给异步任务状态。 */
  onCompileProgress?: (stage: WikiCompileProgressStage) => void;
}

export interface WikiIngestionCommitResumeOptions {
  onCheckpoint?: (checkpoint: string) => void;
  settings?: AiSettings;
}

interface PersistedCompileSnapshot {
  sourceText: string;
  sourceFile: string;
  archivedFiles: string[];
  stagedFiles: string[];
  summaryHint?: string;
  compileResult: Awaited<ReturnType<typeof compileSource>>;
}

/**
 * 统一编译后返回给入口层的落盘结果与 manifest 关联信息。
 */
export interface WikiIngestionResult {
  sourceFile: string;
  archivedFiles: string[];
  pages: WikiPageSummary[];
  summary: string;
  manifestId: string;
  graphErrors?: string[];
}

/**
 * 用于统一拼装 source 文本的结构化片段。
 */
function archiveRawFiles(wikiPath: string, files: WikiArchivedFileInput[] | undefined): string[] {
  if (!files || files.length === 0) return [];

  const archivedPaths: string[] = [];

  for (const file of files) {
    if (file.existingRelativePath) {
      archivedPaths.push(file.existingRelativePath.replace(/\\/g, '/'));
      continue;
    }
    if (!file.buffer) continue;
    archivedPaths.push(stageWikiRawFile(wikiPath, file.name, file.buffer));
  }

  return archivedPaths;
}

/**
 * 统一 Wiki 编译入口：保存 source、归档原始文件、写页面、更新索引并追加 manifest。
 */
export async function ingestWikiSource(
  settings: AiSettings,
  wikiPath: string,
  request: WikiIngestionRequest,
): Promise<WikiIngestionResult> {
  const existingCommit = request.commit
    ? commitRepository.getWikiIngestionCommit(request.commit.jobId, request.commit.itemKey)
    : undefined;
  if (existingCommit?.snapshot) {
    return resumeWikiIngestionCommit(wikiPath, existingCommit.commitId, { settings });
  }

  const archivedFiles = archiveRawFiles(wikiPath, request.archivedFiles);
  // 单文件上传已经有不可变原始归档，直接复用它，避免为同一文件再生成规范化副本。
  // 多文件或文本/URL摄入仍生成组合快照。
  const sourceFile =
    archivedFiles.length === 1
      ? archivedFiles[0]
      : stageWikiSourceText(
          wikiPath,
          request.sourceText,
          request.sourceTitle,
          request.sourceFilenameHint,
        );
  const stagedFiles = [...new Set([...archivedFiles, sourceFile])];
  const finalizedFiles: string[] = [];

  if (request.commit)
    return ingestDurableWikiSource(
      settings,
      wikiPath,
      request,
      existingCommit,
      archivedFiles,
      sourceFile,
    );

  try {
    const compileResult = await compileSource(
      settings,
      wikiPath,
      request.sourceText,
      sourceFile.split('/').pop() || request.sourceTitle,
      {
        title: request.sourceTitle,
        category: request.category,
        onProgress: request.onCompileProgress,
      },
    );
    const finalizedByPath = finalizeStagedFiles(wikiPath, stagedFiles, finalizedFiles);
    const committedSourceFile = finalizedByPath.get(sourceFile) || sourceFile;
    const committedArchivedFiles = archivedFiles.map((file) => finalizedByPath.get(file) || file);

    registerCompiledKnowledge(
      committedSourceFile,
      request.sourceText,
      compileResult.compiledPages,
      compileResult.claims,
    );
    const embeddingConfig: OpenAICompatibleEmbeddingConfig | undefined =
      settings.wikiSearchMode === 'hybrid'
        ? {
            apiUrl: settings.embeddingApiUrl,
            model: settings.embeddingModel,
            dimensions: settings.embeddingDimensions,
            vectorStore: settings.vectorStore,
            chromaUrl: settings.chromaUrl,
            chromaApiKey: settings.chromaApiKey,
          }
        : undefined;
    await rebuildWikiSearchIndex(wikiPath, embeddingConfig);

    const graphErrors = buildIngestionGraph(
      compileResult.compiledPages,
      compileResult.relationships,
      wikiPath,
    );
    try {
      await generateCrossBatchCandidates(settings, wikiPath, compileResult.compiledPages);
    } catch (err) {
      log.warn('[crossBatchCandidates] 生成失败', { error: (err as Error).message });
    }

    const manifestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    appendWikiManifestEntry(wikiPath, {
      id: manifestId,
      sourceFile: committedSourceFile,
      archivedFiles: committedArchivedFiles,
      pageFiles: compileResult.pages.map((page) => page.filename),
      summary: request.summaryHint || compileResult.summary,
      createdAt: new Date().toISOString(),
    });

    return {
      sourceFile: committedSourceFile,
      archivedFiles: committedArchivedFiles,
      pages: compileResult.pages,
      summary: compileResult.summary,
      manifestId,
      graphErrors: graphErrors.length > 0 ? graphErrors : undefined,
    };
  } catch (error: unknown) {
    if (!request.retainStagedFilesOnError) {
      stagedFiles.forEach((file) => discardWikiStagedFile(wikiPath, file));
    }
    finalizedFiles.forEach((file) => rollbackWikiSourceFile(wikiPath, file));
    throw error;
  }
}

async function ingestDurableWikiSource(
  settings: AiSettings,
  wikiPath: string,
  request: WikiIngestionRequest,
  existingCommit: WikiIngestionCommit | undefined,
  archivedFiles: string[],
  sourceFile: string,
): Promise<WikiIngestionResult> {
  if (!request.commit) throw new Error('缺少持久摄入提交标识');
  const canonicalSourceFile = existingCommit?.stagedSourcePath || sourceFile;
  const canonicalStagedFiles = [...new Set([...archivedFiles, canonicalSourceFile, sourceFile])];
  const sourcePath =
    existingCommit?.sourcePath ||
    buildStableSourcePath(canonicalSourceFile, request.commit.jobId, request.commit.itemKey);
  const commit = commitRepository.createOrGetWikiIngestionCommit({
    ...request.commit,
    wikiPath,
    stagedSourcePath: canonicalSourceFile,
    sourcePath,
  });
  try {
    const snapshot: PersistedCompileSnapshot = (commit.snapshot as PersistedCompileSnapshot) || {
      sourceText: request.sourceText,
      sourceFile: canonicalSourceFile,
      archivedFiles: archivedFiles.map((file) =>
        existingCommit?.stagedSourcePath && file === sourceFile
          ? existingCommit.stagedSourcePath
          : file,
      ),
      stagedFiles: canonicalStagedFiles,
      summaryHint: request.summaryHint,
      compileResult: await compileSource(
        settings,
        wikiPath,
        request.sourceText,
        canonicalSourceFile.split('/').pop() || request.sourceTitle,
        {
          title: request.sourceTitle,
          category: request.category,
          onProgress: request.onCompileProgress,
          persistPages: false,
        },
      ),
    };
    if (!commit.snapshot) commitRepository.saveWikiIngestionSnapshot(commit.commitId, snapshot);
    const result = await applyPersistedWikiIngestionCommit(wikiPath, commit.commitId, {
      settings,
    });
    await generateCandidatesWithoutFailing(
      settings,
      wikiPath,
      snapshot.compileResult.compiledPages,
    );
    return result;
  } catch (error: unknown) {
    commitRepository.setWikiIngestionCommitError(
      commit.commitId,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

async function generateCandidatesWithoutFailing(
  settings: AiSettings,
  wikiPath: string,
  pages: CompiledPage[],
): Promise<void> {
  try {
    await generateCrossBatchCandidates(settings, wikiPath, pages);
  } catch (error) {
    log.warn('[crossBatchCandidates] 生成失败', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Resume a durable commit from its compiler snapshot and the last committed phase. */
export async function resumeWikiIngestionCommit(
  wikiPath: string,
  commitId: string,
  options: WikiIngestionCommitResumeOptions = {},
): Promise<WikiIngestionResult> {
  const commit = commitRepository.getWikiIngestionCommitById(commitId);
  if (!commit) throw new Error(`Wiki 摄入提交记录不存在: ${commitId}`);
  if (commit.wikiPath !== wikiPath) throw new Error('Wiki 摄入提交路径与恢复路径不匹配');
  if (!commit.snapshot) throw new Error('Wiki 摄入提交尚无可恢复的编译快照');
  return applyPersistedWikiIngestionCommit(wikiPath, commitId, options);
}

async function applyPersistedWikiIngestionCommit(
  wikiPath: string,
  commitId: string,
  options: WikiIngestionCommitResumeOptions = {},
): Promise<WikiIngestionResult> {
  const initialCommit = commitRepository.getWikiIngestionCommitById(commitId);
  if (!initialCommit?.snapshot) throw new Error(`Wiki 摄入提交快照不存在: ${commitId}`);
  let commit: WikiIngestionCommit = initialCommit;
  const snapshot = initialCommit.snapshot as PersistedCompileSnapshot;
  if (commit.phase === 'committed') {
    return parseCommitResult(commit);
  }
  const advance = (
    phase: WikiIngestionCommitPhase,
    checkpoint: string,
    updates: { result?: unknown } = {},
  ): void => {
    commit = commitRepository.advanceWikiIngestionCommit(commitId, phase, updates);
    options.onCheckpoint?.(checkpoint);
  };

  if (!isCommitAtLeast(commit.phase, 'source_finalized')) {
    options.onCheckpoint?.('before-source-finalize');
    finalizeWikiSourceFileTo(wikiPath, snapshot.sourceFile, commit.sourcePath, true);
    snapshot.archivedFiles.forEach((file, index) => {
      if (file === snapshot.sourceFile || !isStagedWikiFile(file)) return;
      finalizeWikiSourceFileTo(
        wikiPath,
        file,
        buildStableArchivedPath(file, commitId, index),
        true,
      );
    });
    options.onCheckpoint?.('after-source-finalize-before-checkpoint');
    advance('source_finalized', 'source-finalized');
  }

  if (!isCommitAtLeast(commit.phase, 'pages_written')) {
    options.onCheckpoint?.('before-pages-write');
    const summaries = writePreparedWikiPages(wikiPath, snapshot.compileResult.compiledPages);
    updateIndexMd(wikiPath, snapshot.compileResult.compiledPages);
    snapshot.compileResult.pages = summaries;
    options.onCheckpoint?.('after-pages-write-before-checkpoint');
    advance('pages_written', 'pages-written');
  }

  const sourceFile = commit.sourcePath;
  if (!isCommitAtLeast(commit.phase, 'lifecycle_registered')) {
    options.onCheckpoint?.('before-lifecycle-register');
    registerCompiledKnowledge(
      sourceFile,
      snapshot.sourceText,
      snapshot.compileResult.compiledPages,
      snapshot.compileResult.claims,
    );
    options.onCheckpoint?.('after-lifecycle-register-before-checkpoint');
    advance('lifecycle_registered', 'lifecycle-registered');
  }

  if (!isCommitAtLeast(commit.phase, 'search_indexed')) {
    options.onCheckpoint?.('before-search-index');
    await rebuildWikiSearchIndex(wikiPath, getEmbeddingConfig(options.settings));
    options.onCheckpoint?.('after-search-index-before-checkpoint');
    advance('search_indexed', 'search-indexed');
  }

  const graphErrors = buildIngestionGraph(
    snapshot.compileResult.compiledPages,
    snapshot.compileResult.relationships,
    wikiPath,
  );
  const committedArchivedFiles = snapshot.archivedFiles.map((file, index) => {
    if (file === snapshot.sourceFile) return commit.sourcePath;
    return isStagedWikiFile(file) ? buildStableArchivedPath(file, commitId, index) : file;
  });
  const result: WikiIngestionResult = {
    sourceFile,
    archivedFiles: committedArchivedFiles,
    pages: snapshot.compileResult.pages,
    summary: snapshot.compileResult.summary,
    manifestId: commitId,
    graphErrors: graphErrors.length > 0 ? graphErrors : undefined,
  };

  if (!isCommitAtLeast(commit.phase, 'manifest_written')) {
    options.onCheckpoint?.('before-manifest-write');
    appendWikiManifestEntry(wikiPath, {
      id: commitId,
      sourceFile,
      archivedFiles: result.archivedFiles,
      pageFiles: snapshot.compileResult.pages.map((page) => page.filename),
      summary: snapshot.summaryHint || snapshot.compileResult.summary,
      createdAt: commit.createdAt,
    });
    options.onCheckpoint?.('after-manifest-write-before-checkpoint');
    advance('manifest_written', 'manifest-written', { result });
  }

  const completed = commitRepository.advanceWikiIngestionCommit(commitId, 'committed', { result });
  options.onCheckpoint?.('committed');
  return parseCommitResult(completed);
}

/** Remove staged input snapshots only after their parent job reaches a terminal state. */
export function cleanupWikiIngestionJobStagedFiles(wikiPath: string, jobId: string): void {
  for (const commit of commitRepository.listWikiIngestionCommits(jobId)) {
    if (commit.wikiPath !== wikiPath || !commit.snapshot) continue;
    const snapshot = commit.snapshot as PersistedCompileSnapshot;
    snapshot.stagedFiles.forEach((file) => discardWikiStagedFile(wikiPath, file));
  }
}

function getEmbeddingConfig(
  settings: AiSettings | undefined,
): OpenAICompatibleEmbeddingConfig | undefined {
  if (!settings || settings.wikiSearchMode !== 'hybrid') return undefined;
  return {
    apiUrl: settings.embeddingApiUrl,
    model: settings.embeddingModel,
    dimensions: settings.embeddingDimensions,
    vectorStore: settings.vectorStore,
    chromaUrl: settings.chromaUrl,
    chromaApiKey: settings.chromaApiKey,
  };
}

function parseCommitResult(commit: WikiIngestionCommit): WikiIngestionResult {
  if (!commit.result || typeof commit.result !== 'object') {
    throw new Error(`Wiki 摄入提交缺少最终结果: ${commit.commitId}`);
  }
  return commit.result as WikiIngestionResult;
}

function isCommitAtLeast(
  current: WikiIngestionCommitPhase,
  target: WikiIngestionCommitPhase,
): boolean {
  const order: WikiIngestionCommitPhase[] = [
    'compiling',
    'prepared',
    'source_finalized',
    'pages_written',
    'lifecycle_registered',
    'search_indexed',
    'manifest_written',
    'committed',
  ];
  return order.indexOf(current) >= order.indexOf(target);
}

function buildStableSourcePath(sourceFile: string, jobId: string, itemKey: string): string {
  const extension = path.extname(sourceFile);
  const baseName = path.basename(sourceFile, extension);
  const suffix = createHash('sha256').update(`${jobId}\0${itemKey}`).digest('hex').slice(0, 12);
  return `sources/${baseName}-${suffix}${extension}`;
}

function buildStableArchivedPath(sourceFile: string, commitId: string, index: number): string {
  const extension = path.extname(sourceFile);
  const baseName = path.basename(sourceFile, extension);
  const suffix = createHash('sha256')
    .update(`${commitId}\0archive\0${index}\0${sourceFile}`)
    .digest('hex')
    .slice(0, 12);
  return `sources/${baseName}-${suffix}${extension}`;
}

function finalizeStagedFiles(
  wikiPath: string,
  files: string[],
  finalizedFiles: string[],
): Map<string, string> {
  const finalizedByPath = new Map<string, string>();
  for (const file of files) {
    const finalized = finalizeWikiSourceFile(wikiPath, file);
    finalizedByPath.set(file, finalized);
    if (finalized !== file) finalizedFiles.push(finalized);
  }
  return finalizedByPath;
}

function buildIngestionGraph(
  pages: CompiledPage[],
  relationships: Relationship[],
  wikiPath: string,
): string[] {
  try {
    const graphResult = buildGraphFromPages(pages, relationships, wikiPath, inferWikiGraphNodeType);
    if (graphResult.errors.length > 0)
      log.warn('[graphBuilder] 部分构建失败:', { errors: graphResult.errors });
    return graphResult.errors;
  } catch (err) {
    log.error('[graphBuilder] 构建异常:', { error: (err as Error).message });
    return [(err as Error).message];
  }
}
