import { Fragment, useMemo, useRef, useState } from 'react';
import type { TraceEntry, TraceEventDetail, TraceRunSummary } from '@mint/session/trace';

export type TracePanelMode = 'duration' | 'rounds' | 'calls';

export interface AgentTracePanelProps {
  readonly entries: readonly TraceEntry[];
  readonly runs?: readonly TraceRunSummary[];
  readonly loading?: boolean;
  readonly historyCompleteness?: 'complete' | 'legacy_partial';
  readonly tailIncomplete?: boolean;
  readonly loadEvent: (eventId: string) => Promise<TraceEventDetail>;
  readonly onLoadMore?: () => void;
}

/** 面向宿主的 Agent 执行轨迹视图，不依赖 Mint 的 API 或状态容器。 */
export function AgentTracePanel({
  entries,
  runs = [],
  loading = false,
  historyCompleteness = 'complete',
  tailIncomplete = false,
  loadEvent,
  onLoadMore,
}: AgentTracePanelProps) {
  const [mode, setMode] = useState<TracePanelMode>('duration');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<TraceEntry | null>(null);
  const [details, setDetails] = useState<readonly TraceEventDetail[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const selectionVersion = useRef(0);
  const visibleEntries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return entries.filter((entry) => {
      const matchesQuery =
        !normalized ||
        `${entry.label} ${entry.runId} ${entry.callId ?? ''}`
          .toLocaleLowerCase()
          .includes(normalized);
      return matchesQuery && (mode !== 'calls' || entry.lane === 'tool' || entry.lane === 'model');
    });
  }, [entries, mode, query]);

  async function selectEntry(entry: TraceEntry): Promise<void> {
    const version = selectionVersion.current + 1;
    selectionVersion.current = version;
    setSelected(entry);
    setDetails([]);
    setDetailsError(null);
    setDetailsLoading(true);
    try {
      const loaded = await Promise.all(entry.detailEventIds.map(loadEvent));
      if (selectionVersion.current !== version) return;
      setDetails(loaded);
    } catch (error) {
      if (selectionVersion.current !== version) return;
      setDetailsError(error instanceof Error ? error.message : '读取详情失败');
    } finally {
      if (selectionVersion.current === version) setDetailsLoading(false);
    }
  }

  return (
    <section className="mint-agent-trace" aria-label="Agent 执行轨迹">
      <header className="mint-agent-trace__header">
        <div>
          <p className="mint-agent-trace__eyebrow">执行记录</p>
          <h2>完整轨迹</h2>
          <span className="mint-agent-trace__run-count">{runs.length} 个运行</span>
        </div>
        <div className="mint-agent-trace__modes" role="group" aria-label="轨迹视图">
          {(['duration', 'rounds', 'calls'] as const).map((item) => (
            <button
              aria-pressed={mode === item}
              className={mode === item ? 'is-active' : ''}
              key={item}
              onClick={() => setMode(item)}
              type="button"
            >
              {modeLabel(item)}
            </button>
          ))}
        </div>
      </header>
      {(historyCompleteness === 'legacy_partial' || tailIncomplete) && (
        <p className="mint-agent-trace__notice" role="status">
          {historyCompleteness === 'legacy_partial' && '旧记录可能不完整。'}
          {tailIncomplete && '最后一段记录未完整提交。'}
        </p>
      )}
      <TraceOverview entries={entries} onSelect={selectEntry} />
      <label className="mint-agent-trace__search">
        <span>搜索轨迹</span>
        <input onChange={(event) => setQuery(event.currentTarget.value)} value={query} />
      </label>
      <div className="mint-agent-trace__body">
        <TraceEntryList
          entries={visibleEntries}
          loading={loading}
          mode={mode}
          selected={selected}
          onSelect={selectEntry}
        />
        {selected && (
          <TraceDetail
            details={details}
            error={detailsError}
            loading={detailsLoading}
            selected={selected}
            onClose={() => {
              selectionVersion.current += 1;
              setSelected(null);
            }}
          />
        )}
      </div>
      {onLoadMore && (
        <button
          className="mint-agent-trace__more"
          disabled={loading}
          onClick={onLoadMore}
          type="button"
        >
          {loading ? '正在加载…' : '加载更早事件'}
        </button>
      )}
    </section>
  );
}

/** 绘制输入、模型和工具三条时间泳道。 */
function TraceOverview({
  entries,
  onSelect,
}: {
  entries: readonly TraceEntry[];
  onSelect: (entry: TraceEntry) => Promise<void>;
}) {
  const axis = useMemo(() => createTimelineAxis(entries), [entries]);
  return (
    <div className="mint-agent-trace__overview" aria-label="轨迹总览">
      {(['input', 'model', 'tool'] as const).map((lane) => (
        <div className="mint-agent-trace__lane" key={lane}>
          <span>{laneLabel(lane)}</span>
          <div>
            {entries
              .filter((entry) => entry.lane === lane)
              .map((entry) => (
                <button
                  aria-label={`${laneLabel(lane)}：${entry.label}`}
                  className={`mint-agent-trace__tick mint-agent-trace__tick--${lane} mint-agent-trace__tick--${entry.status ?? 'neutral'}`}
                  key={entry.id}
                  onClick={() => void onSelect(entry)}
                  style={timelineStyle(entry, axis, entries.length)}
                  type="button"
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 为所有轨迹行计算共享的时间范围，只遍历一次事件列表。 */
function createTimelineAxis(entries: readonly TraceEntry[]): { start: number; span: number } {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    const timestamp = Date.parse(entry.createdAt);
    if (!Number.isFinite(timestamp)) continue;
    start = Math.min(start, timestamp);
    end = Math.max(end, timestamp + (entry.durationMs ?? 0));
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { start: 0, span: 1 };
  return { start, span: Math.max(1, end - start) };
}

/** 将事件时间和持续时长映射到共享时间轴位置与宽度。 */
function timelineStyle(
  entry: TraceEntry,
  axis: { start: number; span: number },
  entryCount: number,
) {
  const timestamp = Date.parse(entry.createdAt);
  const span = axis.span;
  const width = Math.max(0.8, ((entry.durationMs ?? 1) / span) * 100);
  const orderedPosition = (Math.max(1, entry.seq) / Math.max(1, entryCount)) * 100;
  const left = Number.isFinite(timestamp)
    ? Math.min(100 - width, Math.max(0, ((timestamp - axis.start) / span) * 100))
    : Math.min(100 - width, orderedPosition);
  return { left: `${left}%`, width: `${width}%` };
}

/** 按事件序号渲染可键盘聚焦的轨迹列表。 */
function TraceEntryList({
  entries,
  loading,
  mode,
  selected,
  onSelect,
}: {
  entries: readonly TraceEntry[];
  loading: boolean;
  mode: TracePanelMode;
  selected: TraceEntry | null;
  onSelect: (entry: TraceEntry) => Promise<void>;
}) {
  return (
    <ol className="mint-agent-trace__list" aria-label="有序轨迹事件">
      {entries.map((entry, index) => {
        const previous = entries[index - 1];
        const startsRound =
          mode === 'rounds' && entry.round !== undefined && previous?.round !== entry.round;
        return (
          <Fragment key={entry.id}>
            {startsRound && <li className="mint-agent-trace__round">第 {entry.round} 轮</li>}
            <li>
              <button
                aria-current={selected?.id === entry.id ? 'true' : undefined}
                className="mint-agent-trace__row"
                data-testid={`trace-row-${entry.id}`}
                onClick={() => void onSelect(entry)}
                type="button"
              >
                <span className={`mint-agent-trace__badge mint-agent-trace__badge--${entry.lane}`}>
                  {laneLabel(entry.lane)}
                </span>
                <span className="mint-agent-trace__label">{entry.label}</span>
                <span
                  className={`mint-agent-trace__status mint-agent-trace__status--${entry.status ?? 'neutral'}`}
                >
                  {statusLabel(entry.status)}
                </span>
                <time dateTime={entry.createdAt}>{formatTime(entry.createdAt)}</time>
              </button>
            </li>
          </Fragment>
        );
      })}
      {entries.length === 0 && (
        <li className="mint-agent-trace__empty">{loading ? '正在读取轨迹…' : '没有匹配的事件'}</li>
      )}
    </ol>
  );
}

/** 在用户显式选择事件后展示其载荷详情。 */
function TraceDetail({
  selected,
  details,
  error,
  loading,
  onClose,
}: {
  selected: TraceEntry;
  details: readonly TraceEventDetail[];
  error: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <aside className="mint-agent-trace__detail" aria-label="事件详情">
      <div className="mint-agent-trace__detail-head">
        <strong>{selected.label}</strong>
        <button onClick={onClose} type="button" aria-label="关闭详情">
          ×
        </button>
      </div>
      <p>运行 {selected.runId}</p>
      {selected.callId && <p>调用 {selected.callId}</p>}
      {error ? (
        <p role="alert">详情不可用：{error}</p>
      ) : loading ? (
        <p>正在加载详情…</p>
      ) : details.length === 0 ? (
        <p>此事件没有可展开的详细载荷</p>
      ) : (
        details.map((detail) => (
          <div key={detail.eventId}>
            {detail.availability === 'available' ? (
              <pre>{JSON.stringify(detail.payload, null, 2)}</pre>
            ) : (
              <p role="status">{detail.message ?? '原始详情不可读取'}</p>
            )}
          </div>
        ))
      )}
    </aside>
  );
}

/** 返回轨迹视图模式的中文标签。 */
function modeLabel(mode: TracePanelMode): string {
  return mode === 'duration' ? '时长' : mode === 'rounds' ? '轮次' : '调用';
}

/** 返回轨迹泳道的中文名称。 */
function laneLabel(lane: TraceEntry['lane']): string {
  return lane === 'input' ? '输入' : lane === 'model' ? '模型' : lane === 'tool' ? '工具' : '状态';
}

/** 返回工具或运行状态的中文名称。 */
function statusLabel(status: TraceEntry['status']): string {
  if (!status) return '已记录';
  const labels: Record<NonNullable<TraceEntry['status']>, string> = {
    running: '运行中',
    success: '成功',
    failed: '失败',
    cancelled: '已取消',
    not_started: '未执行',
    outcome_unknown: '结果未知',
    interrupted: '已中断',
    completed: '已完成',
  };
  return labels[status];
}

/** 将合法时间转为本地时钟文本。 */
function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}
