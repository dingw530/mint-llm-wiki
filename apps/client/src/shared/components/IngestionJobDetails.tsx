import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { readWiki } from '@/services/api';
import type { UploadJob } from '@/services/api/wiki';
import { emitIngestionResultEvent } from '@/services/ingestionResultTelemetry';
import MarkdownRenderer from './MarkdownRenderer';

type SourcePreviewMode = 'raw' | 'rendered';
type SourcePreviewKind = NonNullable<NonNullable<UploadJob['result']>['sourcePreviewKind']>;

interface IngestionJobDetailsProps {
  job: UploadJob;
  onClose: () => void;
  onOpenPage: (path: string) => void;
  onOpenSourceUrl?: (url: string) => void;
  onRetry?: () => Promise<void>;
  retrying?: boolean;
}

function isPreviewable(kind: SourcePreviewKind | undefined): boolean {
  return kind === 'text' || kind === 'markdown' || kind === 'html';
}

function sourceKindLabel(kind: string | undefined): string {
  if (kind === 'markdown') return 'Markdown';
  if (kind === 'html') return 'HTML';
  if (kind === 'text') return '文本';
  return '当前格式暂不支持在线预览';
}

function canRetryJob(job: UploadJob): boolean {
  return Boolean(job.canRetry || ['failed', 'error', 'partial_failed'].includes(job.status || ''));
}

function PageList({ job, onOpenPage }: Pick<IngestionJobDetailsProps, 'job' | 'onOpenPage'>) {
  const pages = job.result?.pages || [];
  const [showAll, setShowAll] = useState(false);
  const visiblePages = showAll ? pages : pages.slice(0, 3);

  if (pages.length === 0) return <p className="ingestion-details-empty">没有生成页面</p>;
  return (
    <div className="ingestion-details-pages">
      {visiblePages.map((page, index) => (
        <article className="ingestion-details-page" key={page.filename}>
          <span className="ingestion-details-page-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <div className="ingestion-details-page-main">
            <strong>{page.title}</strong>
            <code>{page.filename}</code>
            <p>{page.summary || '暂无摘要'}</p>
          </div>
          <div className="ingestion-details-page-action">
            <span>WIKI PAGE</span>
            <button type="button" className="ingestion-details-link" aria-label="查看生成页面" onClick={() => onOpenPage(page.filename)}>
              查看生成页面
            </button>
          </div>
        </article>
      ))}
      {pages.length > 3 && (
        <button type="button" className="ingestion-details-secondary" onClick={() => setShowAll((value) => !value)}>
          {showAll ? '收起页面' : `查看全部（${pages.length}）`}
        </button>
      )}
    </div>
  );
}

function SourcePreview({ job }: { job: UploadJob }) {
  const [content, setContent] = useState<string | null>(null);
  const [mode, setMode] = useState<SourcePreviewMode>('raw');
  const [error, setError] = useState<string | null>(null);
  const kind = job.result?.sourcePreviewKind;
  const previewable = isPreviewable(kind);

  useEffect(() => {
    let active = true;
    setContent(null);
    setError(null);
    setMode('raw');
    if (!previewable || !job.result?.sourceFile) return () => { active = false; };
    void readWiki(job.result.sourceFile)
      .then((response) => { if (active) setContent(response.content); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '原文读取失败');
      });
    return () => { active = false; };
  }, [job.result?.sourceFile, kind, previewable]);

  if (!previewable) return <p className="ingestion-details-muted">{sourceKindLabel(kind)}</p>;
  if (error) return <p className="ingestion-details-error">{error}</p>;
  if (content === null) return <p className="ingestion-details-muted">正在加载原文…</p>;

  return (
    <div className="ingestion-details-preview">
      {(kind === 'markdown' || kind === 'html') && (
        <div className="ingestion-details-preview-tabs">
          <button type="button" className={mode === 'raw' ? 'active' : ''} onClick={() => setMode('raw')}>原始内容</button>
          <button type="button" className={mode === 'rendered' ? 'active' : ''} onClick={() => setMode('rendered')}>渲染预览</button>
        </div>
      )}
      {mode === 'raw' || kind === 'text' ? <pre>{content}</pre> : <MarkdownRenderer content={content} />}
    </div>
  );
}

/** 展示摄入来源、生成页面和风险信息，供 Chat 与 Wiki 两个入口复用。 */
export default function IngestionJobDetails({ job, onClose, onOpenPage, onOpenSourceUrl, onRetry, retrying = false }: IngestionJobDetailsProps) {
  const sourceUrls = job.result?.sourceUrls || [];
  const warnings = useMemo(() => [
    ...(job.result?.graphErrors || []).map((message) => `图谱：${message}`),
    ...(job.result?.failedItems || []).map((item) => `${item.name}：${item.error}`),
    ...(job.error ? [job.error] : []),
  ], [job.error, job.result?.failedItems, job.result?.graphErrors]);
  useEffect(() => {
    emitIngestionResultEvent({ name: 'ingestion_result_detail_opened', jobId: job.id, sourceType: job.sourceType });
  }, [job.id, job.sourceType]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  const handleOpenPage = (path: string): void => {
    emitIngestionResultEvent({ name: 'ingestion_result_page_opened', jobId: job.id, path, sourceType: job.sourceType });
    onOpenPage(path);
  };

  return createPortal((
    <div className="ingestion-details-overlay" onClick={onClose}>
      <aside className="ingestion-details-drawer" role="dialog" aria-modal="true" aria-label="摄入任务详情" onClick={(event) => event.stopPropagation()}>
        <header className="ingestion-details-header">
          <div className="ingestion-details-heading">
            <span className="ingestion-details-eyebrow"><i aria-hidden="true" /> KNOWLEDGE INGESTION / RESULT</span>
            <h2>{job.fileName}</h2>
            <div className="ingestion-details-header-meta">
              <span className={`ingestion-details-status ${job.isSuccessful ? 'is-success' : 'is-warning'}`}>
                <i aria-hidden="true" /> {job.statusLabel || job.step}
              </span>
              <span>{job.result?.pages?.length || 0} 篇生成页面</span>
              {canRetryJob(job) && onRetry && <button type="button" className="ingestion-details-retry" aria-label={`重试：${job.fileName}`} onClick={() => void onRetry()} disabled={retrying}>{retrying ? '重试中…' : '重试'}</button>}
            </div>
          </div>
          <button type="button" className="ingestion-details-close" onClick={onClose} aria-label="关闭"><span aria-hidden="true">×</span></button>
        </header>
        <div className="ingestion-details-body">
          <section className="ingestion-details-section ingestion-details-source-section">
            <div className="ingestion-details-section-heading">
              <div><span className="ingestion-details-section-kicker">01 / SOURCE</span><h3>来源</h3></div>
              <span className="ingestion-details-kind">{sourceKindLabel(job.result?.sourcePreviewKind)}</span>
            </div>
            <SourcePreview job={job} />
            {sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="ingestion-details-source-url" onClick={() => onOpenSourceUrl?.(url)}>{url}</a>)}
          </section>
          <section className="ingestion-details-section">
            <div className="ingestion-details-section-heading">
              <div><span className="ingestion-details-section-kicker">02 / OUTPUT</span><h3>生成页面</h3></div>
              <span className="ingestion-details-count">{job.result?.pages?.length || 0} PAGES</span>
            </div>
            <PageList job={job} onOpenPage={handleOpenPage} />
          </section>
          {warnings.length > 0 && <section className="ingestion-details-section ingestion-details-warning"><div className="ingestion-details-section-heading"><div><span className="ingestion-details-section-kicker">03 / REVIEW</span><h3>需要检查</h3></div><span className="ingestion-details-count">{warnings.length} ITEMS</span></div><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section>}
        </div>
      </aside>
    </div>
  ), document.body);
}
