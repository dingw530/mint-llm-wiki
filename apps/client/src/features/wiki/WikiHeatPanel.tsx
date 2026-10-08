import { useEffect, useMemo, useState } from 'react';
import { getWikiHeat } from '@/services/api';
import type { WikiHeatPage, WikiHeatResponse } from '@/services/api/wiki';

interface WikiHeatPanelProps {
  onOpenFile?: (path: string) => void;
}

const STATUS_LABELS: Record<WikiHeatPage['status'], string> = {
  draft: '草稿', active: '有效', stale: '待复核', archived: '已归档', superseded: '已替代', deleted: '已删除',
};

const HEAT_BANDS = [
  { label: '沉静', range: '0—25', min: 0, max: 0.25, className: 'quiet' },
  { label: '升温', range: '25—45', min: 0.25, max: 0.45, className: 'warm' },
  { label: '活跃', range: '45—65', min: 0.45, max: 0.65, className: 'alive' },
  { label: '高热', range: '65+', min: 0.65, max: Number.POSITIVE_INFINITY, className: 'hot' },
];

function formatDate(value: string | null): string {
  if (!value) return '尚未访问';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function formatScore(value: number): string {
  return Math.round(Math.min(1, value) * 100).toString().padStart(2, '0');
}

function getBand(score: number) {
  return HEAT_BANDS.find((band) => score >= band.min && score < band.max) || HEAT_BANDS[0];
}

function HeatRow({ page, index, maxAccess, onOpenFile }: {
  page: WikiHeatPage; index: number; maxAccess: number; onOpenFile?: (path: string) => void;
}) {
  const heatPercent = Math.max(4, Math.min(100, page.retentionScore / 1.2 * 100));
  const accessPercent = maxAccess > 0 ? Math.max(3, page.accessCount / maxAccess * 100) : 3;
  const band = getBand(page.retentionScore);
  return (
    <button type="button" className="wiki-heat-row" onClick={() => onOpenFile?.(page.path)}>
      <span className={`wiki-heat-rank wiki-heat-rank--${band.className}`}>{String(index + 1).padStart(2, '0')}</span>
      <span className="wiki-heat-main">
        <span className="wiki-heat-title">{page.title}</span>
        <span className="wiki-heat-path">{page.path}</span>
        <span className="wiki-heat-track" aria-hidden="true">
          <span className="wiki-heat-fill" style={{ width: `${heatPercent}%` }} />
          <span className="wiki-heat-access-fill" style={{ width: `${accessPercent}%` }} />
        </span>
      </span>
      <span className="wiki-heat-score"><strong>{formatScore(page.retentionScore)}</strong><small>热度</small></span>
      <span className="wiki-heat-access"><strong>{page.accessCount}</strong><small>访问</small></span>
      <span className={`wiki-heat-status wiki-heat-status--${page.status}`}>{STATUS_LABELS[page.status]}</span>
      <span className="wiki-heat-date">{formatDate(page.lastAccessedAt)}</span>
    </button>
  );
}

function HeatRing({ score }: { score: number }) {
  return (
    <div className="wiki-heat-ring" style={{ '--heat-angle': `${Math.round(Math.min(1, score) * 360)}deg` } as React.CSSProperties}>
      <div className="wiki-heat-ring-inner"><strong>{formatScore(score)}</strong><span>平均热度</span></div>
    </div>
  );
}

export default function WikiHeatPanel({ onOpenFile }: WikiHeatPanelProps) {
  const [data, setData] = useState<WikiHeatResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getWikiHeat(30)
      .then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) setError((err as Error).message || '热度数据加载失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const derived = useMemo(() => {
    if (!data) return null;
    const pages = data.pages;
    const average = pages.length ? pages.reduce((sum, page) => sum + page.retentionScore, 0) / pages.length : 0;
    const maxAccess = Math.max(...pages.map((page) => page.accessCount), 0);
    const distribution = HEAT_BANDS.map((band) => ({ ...band, count: pages.filter((page) => page.retentionScore >= band.min && page.retentionScore < band.max).length }));
    return { average, maxAccess, distribution, featured: pages[0], mostAccessed: [...pages].sort((a, b) => b.accessCount - a.accessCount)[0] };
  }, [data]);

  if (loading) return <div className="wiki-heat-panel"><div className="wiki-heat-hero-skeleton" /><div className="wiki-heat-skeleton-grid"><div /><div /><div /></div><div className="wiki-heat-skeleton" /><div className="wiki-heat-skeleton" />;</div>;
  if (error) return <div className="wiki-heat-empty"><strong>无法加载热度</strong><span>{error}</span></div>;
  if (!data || !derived || data.summary.totalPages === 0) return <div className="wiki-heat-empty"><strong>还没有生命周期数据</strong><span>完成知识库迁移或摄入页面后，这里会显示知识热度。</span></div>;

  return (
    <div className="wiki-heat-panel">
      <section className="wiki-heat-hero">
        <div className="wiki-heat-orbit wiki-heat-orbit--one" />
        <div className="wiki-heat-orbit wiki-heat-orbit--two" />
        <div className="wiki-heat-hero-copy">
          <span className="wiki-heat-kicker">KNOWLEDGE SIGNAL / 02</span>
          <h1>知识热度</h1>
          <div className="wiki-heat-hero-note"><span className="wiki-heat-pulse" />基于最近的访问反馈实时计算</div>
        </div>
        <div className="wiki-heat-hero-score"><HeatRing score={derived.average} /><span className="wiki-heat-hero-total"><strong>{data.summary.totalAccesses}</strong> 次累计访问</span></div>
      </section>

      <section className="wiki-heat-signal-grid">
        <div className="wiki-heat-signal-card wiki-heat-signal-card--primary"><span className="wiki-heat-card-label">知识库体量</span><strong>{data.summary.totalPages}</strong><span>个页面正在参与生命周期管理</span><div className="wiki-heat-signal-line"><i style={{ width: `${Math.min(100, data.summary.activePages / Math.max(data.summary.totalPages, 1) * 100)}%` }} /></div></div>
        <div className="wiki-heat-signal-card"><span className="wiki-heat-card-label">当前有效</span><strong>{data.summary.activePages}</strong><span>页面保持 active 状态</span><em>ACTIVE FIELD</em></div>
        <div className="wiki-heat-signal-card"><span className="wiki-heat-card-label">最高使用</span><strong>{derived.mostAccessed?.accessCount || 0}</strong><span>{derived.mostAccessed?.title || '尚无访问记录'}</span><em>TOP RECALL</em></div>
      </section>

      <section className="wiki-heat-insight-grid">
        <div className="wiki-heat-distribution">
          <div className="wiki-heat-section-heading"><div><span className="wiki-heat-kicker">SIGNAL MAP</span><h2>知识温度分布</h2></div><span>按 retention score 分层</span></div>
          <div className="wiki-heat-bars">{derived.distribution.map((band) => { const height = Math.max(8, band.count / Math.max(data.summary.totalPages, 1) * 100); return <div className={`wiki-heat-bar-group wiki-heat-bar-group--${band.className}`} key={band.label}><div className="wiki-heat-bar-value">{band.count}</div><div className="wiki-heat-bar" style={{ height: `${height}%` }} /><span>{band.label}</span><small>{band.range}</small></div>; })}</div>
          <p className="wiki-heat-caption">热度分越高，页面在下一次相关检索中越容易获得优先展示。</p>
        </div>
        <button type="button" className="wiki-heat-featured" onClick={() => onOpenFile?.(derived.featured.path)}>
          <span className="wiki-heat-featured-mark">01 / CURRENTLY RESONATING</span><span className="wiki-heat-featured-title">{derived.featured.title}</span><span className="wiki-heat-featured-path">{derived.featured.path}</span><span className="wiki-heat-featured-score">{formatScore(derived.featured.retentionScore)}<small>热度分</small></span><span className="wiki-heat-featured-link">打开页面 →</span>
        </button>
      </section>

      <section className="wiki-heat-ranking">
        <div className="wiki-heat-section-heading"><div><span className="wiki-heat-kicker">RECALL LEADERBOARD</span><h2>页面排行</h2></div><span>点击行查看原文</span></div>
        <div className="wiki-heat-list-header"><span>序号</span><span>页面</span><span>热度</span><span>访问</span><span>状态</span><span>最近访问</span></div>
        <div className="wiki-heat-list">{data.pages.map((page, index) => <HeatRow key={page.id} page={page} index={index} maxAccess={derived.maxAccess} onOpenFile={onOpenFile} />)}</div>
      </section>
    </div>
  );
}
