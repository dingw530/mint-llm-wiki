import { useCallback, useEffect, useState } from 'react';
import {
  getWikiVectorBackfill,
  getWikiVectorHealth,
  retryWikiVectorBackfill,
  startWikiVectorBackfill,
} from '@/services/api';
import type { WikiVectorBackfillJob, WikiVectorHealth } from '@/services/api/wiki';

/**
 * 展示 Wiki 向量索引覆盖率，并提供历史向量回填操作。
 *
 * @returns 向量索引健康度卡片
 */
export default function WikiVectorHealthCard() {
  const [vectorHealth, setVectorHealth] = useState<WikiVectorHealth | null>(null);
  const [vectorJob, setVectorJob] = useState<WikiVectorBackfillJob | null>(null);
  const [vectorLoading, setVectorLoading] = useState(false);

  const loadVectorHealth = useCallback(async () => {
    try {
      setVectorHealth(await getWikiVectorHealth());
    } catch (err) {
      console.error('无法加载向量索引健康度', err);
    }
  }, []);

  useEffect(() => {
    loadVectorHealth();
  }, [loadVectorHealth]);

  useEffect(() => {
    if (!vectorJob || !['queued', 'running'].includes(vectorJob.status)) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const next = await getWikiVectorBackfill(vectorJob.id);
        setVectorJob(next);
        await loadVectorHealth();
        if (!['queued', 'running'].includes(next.status)) window.clearInterval(timer);
      } catch (err) {
        console.error('无法更新向量回填任务', err);
        window.clearInterval(timer);
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [loadVectorHealth, vectorJob]);

  const startVectorBackfill = async () => {
    if (vectorLoading) return;
    setVectorLoading(true);
    try {
      setVectorJob(await startWikiVectorBackfill({ scope: 'all' }));
    } catch (err) {
      console.error('无法启动向量回填', err);
    } finally {
      setVectorLoading(false);
    }
  };

  const retryVectorBackfill = async () => {
    if (!vectorJob) return;
    try {
      setVectorJob(await retryWikiVectorBackfill(vectorJob.id));
    } catch (err) {
      console.error('无法重试向量回填', err);
    }
  };

  const coverage =
    vectorHealth && Number.isFinite(vectorHealth.coverage)
      ? `${Math.round(vectorHealth.coverage * 100)}%`
      : '—';

  return (
    <section className="wiki-vector-health wiki-vector-health--welcome" aria-label="向量索引健康度">
      <div className="wiki-vector-health-label">
        <i aria-hidden="true" />
        <strong>向量索引</strong>
      </div>
      <span className="wiki-vector-health-coverage">
        <small>覆盖率</small>
        {coverage}
      </span>
      <div className="wiki-vector-health-stats">
        <span>
          已覆盖 {vectorHealth?.vectorizedCount ?? '—'} / {vectorHealth?.documentCount ?? '—'} 片段
        </span>
        <span>待处理 {vectorHealth?.pendingCount ?? '—'}</span>
        {(vectorHealth?.failedCount || 0) > 0 && (
          <span className="wiki-vector-health-alert">失败 {vectorHealth?.failedCount}</span>
        )}
        {(vectorHealth?.orphanCount || 0) > 0 && (
          <span className="wiki-vector-health-alert">孤儿 {vectorHealth?.orphanCount}</span>
        )}
      </div>
      {vectorJob && (vectorJob.status === 'queued' || vectorJob.status === 'running') && (
        <div className="wiki-vector-health-progress" aria-live="polite">
          <span>
            {vectorJob.status === 'queued'
              ? '等待回填'
              : `正在处理 ${vectorJob.currentPath || '页面'}`}
          </span>
          <span>
            {vectorJob.processed} / {vectorJob.total || '—'}
          </span>
        </div>
      )}
      {vectorJob?.status === 'partial_failed' || vectorJob?.status === 'failed' ? (
        <button type="button" className="wiki-vector-health-action" onClick={retryVectorBackfill}>
          重试失败项
        </button>
      ) : (
        <button
          type="button"
          className="wiki-vector-health-action"
          onClick={startVectorBackfill}
          disabled={
            vectorLoading || vectorJob?.status === 'queued' || vectorJob?.status === 'running'
          }
        >
          {vectorLoading ? '正在启动…' : '回填历史向量'}
        </button>
      )}
    </section>
  );
}
