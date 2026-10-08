import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { getWikiJob, removeWikiJob, retryWikiJob } from '@/services/api';
import type { UploadJob } from '@/services/api/wiki';
import IngestionJobDetails from './IngestionJobDetails';

type TaskFilter = 'all' | 'active' | 'attention' | 'completed';

interface IngestionTaskCenterProps {
  jobs: UploadJob[];
  isOpen: boolean;
  onClose: () => void;
  onJobsChange: Dispatch<SetStateAction<UploadJob[]>>;
  onOpenPage: (path: string) => void;
}

function getJobKey(job: UploadJob): string {
  return job.id || `${job.fileName}:${job.createdAt}:${job.fileSize}`;
}

function getTaskTone(job: UploadJob): 'active' | 'success' | 'error' | 'cancelled' {
  if (!job.isTerminal) return 'active';
  if (job.phase === 'cancelled' || job.status === 'cancelled') return 'cancelled';
  return job.isSuccessful ? 'success' : 'error';
}

function getTaskLabel(job: UploadJob): string {
  if (!job.isTerminal) return job.step || job.statusLabel || '处理中';
  if (job.phase === 'cancelled' || job.status === 'cancelled') return '已取消';
  return job.isSuccessful ? '已完成' : job.statusLabel || '需处理';
}

function canRetryJob(job: UploadJob): boolean {
  return Boolean(job.canRetry || ['failed', 'error', 'partial_failed'].includes(job.status || ''));
}

function filterJob(job: UploadJob, filter: TaskFilter): boolean {
  if (filter === 'active') return !job.isTerminal;
  if (filter === 'attention') return Boolean(job.isTerminal && !job.isSuccessful);
  if (filter === 'completed') return Boolean(job.isTerminal && job.isSuccessful);
  return true;
}

function formatTaskDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 提供全量任务筛选、批量清理和详情入口，任务数据由所属页面持有。 */
export default function IngestionTaskCenter({
  jobs,
  isOpen,
  onClose,
  onJobsChange,
  onOpenPage,
}: IngestionTaskCenterProps) {
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [removingKeys, setRemovingKeys] = useState<Set<string>>(new Set());
  const [retryingKeys, setRetryingKeys] = useState<Set<string>>(new Set());
  const [detailJob, setDetailJob] = useState<UploadJob | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const counts = useMemo(() => ({
    active: jobs.filter((job) => !job.isTerminal).length,
    attention: jobs.filter((job) => job.isTerminal && !job.isSuccessful).length,
    completed: jobs.filter((job) => job.isTerminal && job.isSuccessful).length,
  }), [jobs]);

  const visibleJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return jobs.filter((job) => filterJob(job, filter)).filter((job) => (
      !normalizedQuery || job.fileName.toLocaleLowerCase().includes(normalizedQuery)
    ));
  }, [filter, jobs, query]);

  const removableVisibleJobs = visibleJobs.filter((job) => job.isTerminal);
  const selectedRemovableJobs = jobs.filter((job) => selectedKeys.has(getJobKey(job)) && job.isTerminal);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !detailJob) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [detailJob, isOpen, onClose]);

  useEffect(() => {
    const validKeys = new Set(jobs.map((job) => getJobKey(job)));
    setSelectedKeys((previous) => new Set([...previous].filter((key) => validKeys.has(key))));
  }, [jobs]);

  if (!isOpen) return null;

  const removeJobs = async (targets: UploadJob[]): Promise<void> => {
    if (targets.length === 0) return;
    setActionError(null);
    const keys = new Set(targets.map((job) => getJobKey(job)));
    setRemovingKeys(keys);
    try {
      await Promise.all(targets.filter((job) => job.id).map((job) => removeWikiJob(job.id)));
      onJobsChange((previous) => previous.filter((job) => !keys.has(getJobKey(job))));
      setSelectedKeys((previous) => new Set([...previous].filter((key) => !keys.has(key))));
      if (detailJob && keys.has(detailJob.id)) setDetailJob(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '任务移除失败，请稍后重试');
    } finally {
      setRemovingKeys(new Set());
    }
  };

  const retryJob = async (jobId: string): Promise<void> => {
    const target = jobs.find((job) => job.id === jobId);
    if (!target) return;
    const key = getJobKey(target);
    setActionError(null);
    setRetryingKeys((previous) => new Set(previous).add(key));
    try {
      const updated = await retryWikiJob(jobId);
      onJobsChange((previous) => previous.map((job) => (job.id === jobId ? updated : job)));
      setDetailJob((previous) => (previous?.id === jobId ? updated : previous));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '任务重试失败，请稍后重试');
    } finally {
      setRetryingKeys((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  };

  const confirmRemove = (targets: UploadJob[]): void => {
    const count = targets.length;
    if (count === 0 || !window.confirm(`确认移除 ${count} 个终态任务吗？来源文件和已生成页面不会被删除。`)) return;
    void removeJobs(targets);
  };

  const toggleSelection = (job: UploadJob): void => {
    const key = getJobKey(job);
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else if (job.isTerminal) next.add(key);
      return next;
    });
  };

  const toggleVisibleSelection = (): void => {
    const visibleKeys = new Set(removableVisibleJobs.map((job) => getJobKey(job)));
    const allSelected = [...visibleKeys].every((key) => selectedKeys.has(key));
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      visibleKeys.forEach((key) => (allSelected ? next.delete(key) : next.add(key)));
      return next;
    });
  };

  const openDetails = async (job: UploadJob): Promise<void> => {
    setActionError(null);
    if (!job.id) {
      setDetailJob(job);
      return;
    }
    try {
      setDetailJob(await getWikiJob(job.id));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '无法加载任务详情');
    }
  };

  const tab = (value: TaskFilter, label: string, count: number) => (
    <button type="button" className={`ingestion-task-center-tab${filter === value ? ' active' : ''}`} onClick={() => setFilter(value)}>
      <span>{label}</span><b>{count}</b>
    </button>
  );

  return (
    <>
      <div className="ingestion-task-center-overlay" onClick={onClose}>
        <aside className={`ingestion-task-center-drawer${detailJob ? ' is-obscured' : ''}`} role="dialog" aria-modal="true" aria-hidden={Boolean(detailJob)} aria-label="摄入任务中心" onClick={(event) => event.stopPropagation()}>
          <header className="ingestion-task-center-header">
            <div>
              <span className="ingestion-task-center-kicker">MINT / TASK CENTER</span>
              <h2>摄入任务</h2>
              <p>{counts.active > 0 ? `${counts.active} 个任务正在处理` : '所有任务状态都在这里留痕'}</p>
            </div>
            <button type="button" className="ingestion-task-center-close" onClick={onClose} aria-label="关闭任务中心">×</button>
          </header>
          <div className="ingestion-task-center-toolbar">
            <label className="ingestion-task-center-search">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名" aria-label="搜索任务" />
            </label>
            <div className="ingestion-task-center-tabs" role="tablist" aria-label="任务筛选">
              {tab('all', '全部', jobs.length)}
              {tab('active', '处理中', counts.active)}
              {tab('attention', '需处理', counts.attention)}
              {tab('completed', '已完成', counts.completed)}
            </div>
          </div>
          <div className="ingestion-task-center-bulk">
            <label>
              <input type="checkbox" checked={removableVisibleJobs.length > 0 && removableVisibleJobs.every((job) => selectedKeys.has(getJobKey(job)))} onChange={toggleVisibleSelection} disabled={removableVisibleJobs.length === 0} />
              <span>选择终态任务</span>
            </label>
            <span>{selectedRemovableJobs.length > 0 ? `已选 ${selectedRemovableJobs.length} 个` : `显示 ${visibleJobs.length} 个`}</span>
            {selectedRemovableJobs.length > 0 && <button type="button" onClick={() => confirmRemove(selectedRemovableJobs)}>移除已选</button>}
            {counts.completed + counts.attention > 0 && <button type="button" className="quiet" onClick={() => confirmRemove(jobs.filter((job) => job.isTerminal))}>清理终态</button>}
          </div>
          {actionError && <p className="ingestion-task-center-error" role="alert">{actionError}</p>}
          <div className="ingestion-task-center-list">
            {visibleJobs.length === 0 && <div className="ingestion-task-center-empty"><strong>没有符合条件的任务</strong><span>新的摄入任务会出现在这里</span></div>}
            {visibleJobs.map((job) => {
              const tone = getTaskTone(job);
              const key = getJobKey(job);
              const isRemoving = removingKeys.has(key);
              const isRetrying = retryingKeys.has(key);
              return (
                <article className={`ingestion-task-center-item ${tone}`} key={key}>
                  <div className="ingestion-task-center-item-top">
                    <label className="ingestion-task-center-check">
                      <input type="checkbox" checked={selectedKeys.has(key)} onChange={() => toggleSelection(job)} disabled={!job.isTerminal || isRemoving || isRetrying} aria-label={`选择任务 ${job.fileName}`} />
                      <span className={`ingestion-task-center-dot ${tone}`} aria-hidden="true" />
                    </label>
                    <div className="ingestion-task-center-item-main">
                      <strong title={job.fileName}>{job.fileName}</strong>
                      <span>{getTaskLabel(job)}{formatTaskDate(job.updatedAt) ? ` · ${formatTaskDate(job.updatedAt)}` : ''}</span>
                    </div>
                    <span className="ingestion-task-center-percent">{job.isTerminal ? (job.isSuccessful ? 'DONE' : 'REVIEW') : `${job.progress}%`}</span>
                  </div>
                  <div className={`ingestion-task-center-progress ${tone}`}><span style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} /></div>
                  {job.error && <p className="ingestion-task-center-item-error">{job.error}</p>}
                  <div className="ingestion-task-center-item-actions">
                    {job.id && <button type="button" aria-label={`查看详情：${job.fileName}`} onClick={() => void openDetails(job)} disabled={isRemoving || isRetrying}>查看详情</button>}
                    {job.id && canRetryJob(job) && <button type="button" className="ingestion-task-center-retry" aria-label={`重试：${job.fileName}`} onClick={() => void retryJob(job.id)} disabled={isRemoving || isRetrying}>{isRetrying ? '重试中…' : '重试'}</button>}
                    {job.isTerminal && <button type="button" className="danger" onClick={() => confirmRemove([job])} disabled={isRemoving || isRetrying}>{isRemoving ? '移除中…' : '移除'}</button>}
                  </div>
                </article>
              );
            })}
          </div>
        </aside>
      </div>
      {detailJob && <IngestionJobDetails job={detailJob} onClose={() => setDetailJob(null)} onOpenPage={onOpenPage} onRetry={() => retryJob(detailJob.id)} retrying={retryingKeys.has(getJobKey(detailJob))} />}
    </>
  );
}
