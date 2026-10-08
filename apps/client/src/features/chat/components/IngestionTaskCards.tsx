import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import { A2uiSurface, createComponentImplementation } from '@a2ui/react/v0_9';
import { Catalog } from '@a2ui/web_core/v0_9';
import { DynamicValueSchema } from '@a2ui/web_core/v0_9';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { BASE_URL, getElectronAPI, isElectron } from '@/services/api/_base';
import { getWikiJob, retryWikiJob } from '@/services/api';
import type { UploadJob } from '@/services/api/wiki';
import IngestionJobDetails from '@/shared/components/IngestionJobDetails';
import {
  createA2uiProcessor,
  createMintComponentApi,
  getSourceSnippet,
  parseA2uiMessage,
  type A2uiSurfaceModel,
} from './a2uiProtocol';

interface IngestionTaskModel {
  jobId: string;
  title: string;
  status: string;
  statusLabel: string;
  progress: number;
  step: string;
  fileCount: number;
  canRetry?: boolean;
  result: { sourceFile?: string; error?: string; pageCount?: number; hasWarnings?: boolean } | null;
}

function isIngestionTaskModel(value: unknown): value is IngestionTaskModel {
  if (!value || typeof value !== 'object') return false;
  const model = value as Partial<IngestionTaskModel>;
  return typeof model.jobId === 'string'
    && typeof model.title === 'string'
    && typeof model.status === 'string'
    && typeof model.progress === 'number';
}

const ingestionTaskCardApi = createMintComponentApi(
  'IngestionTaskCard',
  z.object({ data: DynamicValueSchema }),
);

function getStatusTone(status: string): 'active' | 'success' | 'error' | 'cancelled' {
  if (status === 'completed' || status === 'done') return 'success';
  if (status === 'failed' || status === 'error' || status === 'partial_failed') return 'error';
  if (status === 'cancelled') return 'cancelled';
  return 'active';
}

function requestIngestionDetails(jobId: string): void {
  window.dispatchEvent(new CustomEvent('mint:open-ingestion-detail', { detail: { jobId } }));
}

function requestIngestionRetry(jobId: string): void {
  window.dispatchEvent(new CustomEvent('mint:retry-ingestion-job', { detail: { jobId } }));
}

/** 请求应用打开指定的 Wiki 文档。 */
function requestWikiPage(filePath: string): void {
  window.dispatchEvent(new CustomEvent('mint:open-wiki-page', { detail: { filePath } }));
}

const ingestionTaskCard = createComponentImplementation(ingestionTaskCardApi, ({ props }) => {
  const model = isIngestionTaskModel(props.data) ? props.data : undefined;
  if (!model) return null;

  const progress = Math.max(0, Math.min(100, model.progress));
  const tone = getStatusTone(model.status);
  const currentStep = model.step || model.statusLabel || '处理中';
  const isActive = tone === 'active';
  return (
    <article className={`ingestion-task-card${isActive ? ' is-running' : ''}`} role={isActive ? 'status' : undefined} aria-label={isActive ? '知识摄入任务' : undefined} aria-live={isActive ? 'polite' : undefined}>
      <div className="ingestion-task-card-line">
        <span className={`ingestion-task-card-dot ${tone}`} aria-hidden="true" />
        <strong className="ingestion-task-card-title" title={model.title}>{model.title}</strong>
        <span className={`ingestion-task-status ${tone}`}>{isActive ? `处理中 · ${currentStep}` : currentStep}</span>
        <strong className="ingestion-task-card-percent">{progress}%</strong>
      </div>
      <div className={`ingestion-task-card-progress ${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <span style={{ '--task-progress': `${progress}%` } as CSSProperties} />
      </div>
      <div className="ingestion-task-card-footer">
        <div className="ingestion-task-card-context">
          {model.result?.pageCount !== undefined && <span className="ingestion-task-card-result">已生成 {model.result.pageCount} 篇页面{model.result.hasWarnings ? ' · 有待检查项' : ''}</span>}
          {model.result?.error && <span className="ingestion-task-card-error" title={model.result.error}>{model.result.error}</span>}
        </div>
        {model.canRetry && <button type="button" className="ingestion-task-card-retry" aria-label={`重试：${model.title}`} onClick={() => requestIngestionRetry(model.jobId)}>重试</button>}
        <button type="button" className="ingestion-task-card-detail" aria-label="查看详情" onClick={() => requestIngestionDetails(model.jobId)}>详情</button>
      </div>
    </article>
  );
});

interface SourceReferenceModel {
  refId: string;
  title: string;
  file: string;
  heading: string;
  snippet?: string;
  chunkId: string;
  score?: number;
  matchTypes?: string[];
  pageStatus?: string | null;
  lastVerifiedAt?: string | null;
  lexicalRank?: number | null;
  vectorRank?: number | null;
  distance?: number | null;
}

function isSourceReferenceModel(value: unknown): value is SourceReferenceModel {
  if (!value || typeof value !== 'object') return false;
  const model = value as Partial<SourceReferenceModel>;
  return typeof model.refId === 'string'
    && typeof model.title === 'string'
    && typeof model.file === 'string'
    && typeof model.chunkId === 'string';
}

const sourceReferenceCardApi = createMintComponentApi(
  'SourceReferenceCard',
  z.object({ data: DynamicValueSchema }),
);

const sourceReferenceCard = createComponentImplementation(sourceReferenceCardApi, ({ props }) => {
  const model = isSourceReferenceModel(props.data) ? props.data : undefined;
  if (!model) return null;
  const snippet = getSourceSnippet(model);
  return (
    <button
      type="button"
      className="source-reference-card"
      aria-label={`打开知识库文档：${model.title}`}
      onClick={() => requestWikiPage(model.file)}
    >
      <span className="source-reference-card-label">[{model.refId}]</span>
      <span className="source-reference-card-body">
        <strong className="source-reference-card-title">{model.title}</strong>
        {model.heading && <span className="source-reference-card-heading">{model.heading}</span>}
        {snippet && <span className="source-reference-card-snippet">{snippet}</span>}
        {model.file !== model.title && <span className="source-reference-card-footer">
          <span className="source-reference-card-file">{model.file}</span>
          {model.matchTypes?.includes('keyword') && <span className="source-reference-card-match">关键词</span>}
          {model.matchTypes?.includes('vector') && <span className="source-reference-card-match source-reference-card-match-semantic">语义</span>}
          {model.pageStatus && <span className="source-reference-card-status">{model.pageStatus === 'stale' ? '待复核' : model.pageStatus === 'active' ? '已验证' : model.pageStatus}</span>}
        </span>}
      </span>
    </button>
  );
});

export const mintCatalog = new Catalog('mint', [ingestionTaskCard, sourceReferenceCard]);

/** 将浏览器 SSE 和 Electron IPC 产生的官方 JSONL 消息交给同一个 renderer。 */
export default function IngestionTaskCards({ conversationId }: { conversationId: string | null }) {
  const navigate = useNavigate();
  const processor = useMemo(() => createA2uiProcessor(mintCatalog), []);
  const [, renderVersion] = useReducer((version: number) => version + 1, 0);
  const processorRef = useRef(processor);
  const [isExpanded, setIsExpanded] = useState(true);
  const [detailJob, setDetailJob] = useState<UploadJob | null>(null);
  const [retryingJobIds, setRetryingJobIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const previousActiveCount = useRef(0);
  processorRef.current = processor;

  useEffect(() => {
    const currentProcessor = processorRef.current;
    const refresh = (): void => renderVersion();
    const created = currentProcessor.onSurfaceCreated(refresh);
    const deleted = currentProcessor.onSurfaceDeleted(refresh);
    for (const surfaceId of currentProcessor.model.surfacesMap.keys()) currentProcessor.model.deleteSurface(surfaceId);
    if (!conversationId) {
      return () => {
        created.unsubscribe();
        deleted.unsubscribe();
      };
    }

    const controller = new AbortController();
    const apply = (raw: string): void => {
      const message = parseA2uiMessage(raw);
      if (!message) return;
      try {
        currentProcessor.processMessages([message]);
        refresh();
      } catch (error) {
        console.warn('Rejected A2UI ingestion message', error);
      }
    };
    const consume = async (): Promise<void> => {
      try {
        if (isElectron()) {
          const api = getElectronAPI()!;
          api.removeListener('chat:a2ui');
          api.onA2ui(apply);
          await api.subscribeIngestionEvents(conversationId);
          return;
        }
        const response = await fetch(`${BASE_URL}/conversations/${encodeURIComponent(conversationId)}/ingestion-events`, { signal: controller.signal });
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) if (line.startsWith('data: ')) apply(line.slice(6));
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') console.warn('Failed to consume ingestion task events', error);
      }
    };
    void consume();
    return () => {
      controller.abort();
      created.unsubscribe();
      deleted.unsubscribe();
      if (isElectron()) getElectronAPI()?.removeListener('chat:a2ui');
    };
  }, [conversationId, processorRef]);

  const surfaces = Array.from(processor.model.surfacesMap.values()) as A2uiSurfaceModel[];
  const tasks = surfaces
    .map((surface) => surface.dataModel.get('/job') as IngestionTaskModel | undefined)
    .filter((task): task is IngestionTaskModel => Boolean(task));
  const activeCount = tasks.filter((task) => getStatusTone(task.status) === 'active').length;
  const completedCount = tasks.filter((task) => getStatusTone(task.status) === 'success').length;
  const failedCount = tasks.filter((task) => getStatusTone(task.status) === 'error').length;
  const hasActiveTasks = activeCount > 0;

  useEffect(() => {
    if (hasActiveTasks && previousActiveCount.current === 0) {
      setIsExpanded(true);
    }
    previousActiveCount.current = activeCount;
  }, [activeCount, hasActiveTasks]);

  const openDetails = useCallback(async (jobId: string): Promise<void> => {
    try {
      setDetailJob(await getWikiJob(jobId));
    } catch (error) {
      console.warn('Failed to load ingestion task details', error);
    }
  }, []);

  const retryJob = useCallback(async (jobId: string): Promise<void> => {
    setActionError(null);
    setRetryingJobIds((previous) => new Set(previous).add(jobId));
    try {
      const updated = await retryWikiJob(jobId);
      setDetailJob((previous) => (previous?.id === jobId ? updated : previous));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '任务重试失败，请稍后重试');
    } finally {
      setRetryingJobIds((previous) => {
        const next = new Set(previous);
        next.delete(jobId);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    const handleDetailRequest = (event: Event): void => {
      if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== 'object') return;
      const detail = event.detail as { jobId?: unknown };
      if (typeof detail.jobId === 'string') void openDetails(detail.jobId);
    };
    window.addEventListener('mint:open-ingestion-detail', handleDetailRequest);
    return () => window.removeEventListener('mint:open-ingestion-detail', handleDetailRequest);
  }, [openDetails]);

  useEffect(() => {
    const handleRetryRequest = (event: Event): void => {
      if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== 'object') return;
      const detail = event.detail as { jobId?: unknown };
      if (typeof detail.jobId === 'string') void retryJob(detail.jobId);
    };
    window.addEventListener('mint:retry-ingestion-job', handleRetryRequest);
    return () => window.removeEventListener('mint:retry-ingestion-job', handleRetryRequest);
  }, [retryJob]);

  if (!conversationId || surfaces.length === 0) return null;

  return (
    <section className={`ingestion-task-cards${isExpanded ? ' is-expanded' : ' is-collapsed'}`} aria-label="知识摄入任务">
      <div className="ingestion-task-panel">
        <div className="ingestion-task-panel-header">
          <strong className="ingestion-task-panel-title">知识摄入</strong>
          <div className="ingestion-task-panel-summary" aria-label={`共 ${tasks.length} 个任务`}>
            <span>{tasks.length} 个</span>
            {activeCount > 0 && <span className="active">{activeCount} 处理中</span>}
            {completedCount > 0 && <span className="success">{completedCount} 已完成</span>}
            {failedCount > 0 && <span className="error">{failedCount} 需处理</span>}
          </div>
          <button
            type="button"
            className="ingestion-task-toggle"
            onClick={() => setIsExpanded((expanded) => !expanded)}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? '收起知识摄入任务' : '展开知识摄入任务'}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {actionError && <p className="ingestion-task-action-error" role="alert">{actionError}</p>}
        <div className="ingestion-task-panel-body" aria-hidden={!isExpanded}>
          <div className="ingestion-task-cards-list">
            {surfaces.map((surface) => <A2uiSurface key={surface.id} surface={surface} />)}
          </div>
        </div>
      </div>
      {detailJob && (
        <IngestionJobDetails
          job={detailJob}
          onClose={() => setDetailJob(null)}
          onOpenPage={(path) => navigate(`/wiki?path=${encodeURIComponent(path)}`)}
          onRetry={() => retryJob(detailJob.id)}
          retrying={retryingJobIds.has(detailJob.id)}
        />
      )}
    </section>
  );
}
