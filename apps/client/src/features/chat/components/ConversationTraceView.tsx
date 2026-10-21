import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentTracePanel } from '@mint/agent-ui';
import type { TraceEntry, TraceEventMetadata, TraceRunSummary } from '@mint/session/trace';
import {
  getConversationTrajectory,
  getConversationTrajectoryEvent,
  subscribeConversationTrajectory,
} from '@/services/api';
import type { ConversationTrajectoryPage } from '@/services/api/trajectory';

interface ConversationTraceViewProps {
  readonly conversationId: string;
}

/** 连接宿主轨迹 API 与可移植的 Agent 轨迹面板。 */
export default function ConversationTraceView({ conversationId }: ConversationTraceViewProps) {
  const [page, setPage] = useState<ConversationTrajectoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;

  const load = useCallback(
    async (afterSeq = 0, throughSeq?: number) => {
      setLoading(true);
      setError(null);
      try {
        const next = await getConversationTrajectory(conversationId, {
          afterSeq,
          pageSize: 100,
          ...(throughSeq === undefined ? {} : { throughSeq }),
        });
        setPage((current) =>
          afterSeq === 0 || !current
            ? next
            : {
                ...next,
                events: mergeTraceEvents(current.events, next.events),
                entries: mergeTraceEntries(current.entries, next.entries),
                runs: mergeTraceRuns(current.runs, next.runs),
              },
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '读取轨迹失败');
      } finally {
        setLoading(false);
      }
    },
    [conversationId],
  );

  useEffect(() => {
    setPage(null);
    void load();
  }, [load]);

  const loadEvent = useCallback(
    (eventId: string) => getConversationTrajectoryEvent(conversationId, eventId),
    [conversationId],
  );
  const loadMore = useCallback(() => {
    if (page?.hasMore) void load(page.nextAfterSeq, page.highWatermark);
  }, [load, page]);

  const applyUpdates = useCallback(
    (update: {
      readonly cursor: number;
      readonly events: readonly TraceEventMetadata[];
      readonly entries: readonly TraceEntry[];
      readonly runs: readonly TraceRunSummary[];
    }) => {
      setPage((current) =>
        current
          ? update.cursor <= current.highWatermark &&
            update.events.length === 0 &&
            update.entries.length === 0 &&
            update.runs.length === 0
            ? current
            : {
                ...current,
                highWatermark: Math.max(current.highWatermark, update.cursor),
                events: mergeTraceEvents(current.events, update.events),
                entries: mergeTraceEntries(current.entries, update.entries),
                runs: mergeTraceRuns(current.runs, update.runs),
              }
          : current,
      );
    },
    [],
  );

  useEffect(() => {
    const currentPage = pageRef.current;
    if (!currentPage) return;
    return subscribeConversationTrajectory(
      conversationId,
      currentPage.highWatermark,
      applyUpdates,
      (cause) => setError(cause.message),
    );
  }, [applyUpdates, conversationId, page?.generation]);

  if (error && !page) return <p role="alert">轨迹暂不可用：{error}</p>;
  return (
    <>
      {error && <p role="alert">更新轨迹失败：{error}</p>}
      <AgentTracePanel
        entries={page?.entries ?? []}
        runs={page?.runs ?? []}
        historyCompleteness={page?.historyCompleteness}
        tailIncomplete={page?.tailIncomplete}
        loading={loading}
        loadEvent={loadEvent}
        onLoadMore={page?.hasMore ? loadMore : undefined}
      />
    </>
  );
}

/** 按轨迹行标识合并增量，并用新状态替换旧行。 */
function mergeTraceEntries(
  current: readonly TraceEntry[],
  updates: readonly TraceEntry[],
): TraceEntry[] {
  const entries = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of updates) entries.set(entry.id, entry);
  return [...entries.values()].sort((left, right) => left.seq - right.seq);
}

/** 按持久序号合并事件元数据并去重。 */
function mergeTraceEvents(
  current: readonly TraceEventMetadata[],
  updates: readonly TraceEventMetadata[],
): TraceEventMetadata[] {
  const events = new Map(current.map((event) => [event.eventId, event]));
  for (const event of updates) events.set(event.eventId, event);
  return [...events.values()].sort((left, right) => left.seq - right.seq);
}

/** 用增量中的运行状态替换已有摘要。 */
function mergeTraceRuns(
  current: readonly TraceRunSummary[],
  updates: readonly TraceRunSummary[],
): TraceRunSummary[] {
  const runs = new Map(current.map((run) => [run.runId, run]));
  for (const run of updates) runs.set(run.runId, run);
  return [...runs.values()].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}
