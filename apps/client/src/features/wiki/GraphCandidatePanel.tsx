import { useCallback, useEffect, useState } from 'react';
import {
  acceptGraphCandidate,
  listGraphCandidates,
  rejectGraphCandidate,
  type GraphEdgeCandidate,
} from '@/services/api/wiki';

export default function GraphCandidatePanel() {
  const [items, setItems] = useState<GraphEdgeCandidate[]>([]);
  const [status, setStatus] = useState<'pending' | 'accepted' | 'rejected' | 'expired'>('pending');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    return listGraphCandidates(status)
      .then(setItems)
      .catch((err: Error) => setError(err.message));
  }, [status]);
  useEffect(() => {
    load();
  }, [load]);
  const accept = async (id: string) => {
    try {
      await acceptGraphCandidate(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '采纳失败');
    }
  };
  const reject = async (id: string) => {
    try {
      await rejectGraphCandidate(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '拒绝失败');
    }
  };
  const statusLabels = {
    pending: '待审查',
    accepted: '已采纳',
    rejected: '已拒绝',
    expired: '已过期',
  } as const;
  return (
    <div className="graph-candidates">
      <div className="graph-candidates-header">
        <div>
          <p className="graph-candidates-kicker">KNOWLEDGE GRAPH</p>
          <h2>关系候选</h2>
          <p>审查知识页之间的潜在关联，确认后才会写入图谱。</p>
        </div>
        <span className="graph-candidates-count">{items.length} 条</span>
      </div>
      <div className="graph-candidates-toolbar" role="tablist" aria-label="候选关系状态">
        {(['pending', 'accepted', 'rejected', 'expired'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={status === value}
            className={status === value ? 'is-active' : ''}
            onClick={() => setStatus(value)}
          >
            {statusLabels[value]}
          </button>
        ))}
      </div>
      {error && <p className="graph-candidates-error">{error}</p>}
      {items.length === 0 && !error && <p className="graph-candidates-empty">暂无候选关系</p>}
      {items.map((item) => (
        <article className="graph-candidate" key={item.id}>
          <div className="graph-candidate-topline">
            <span className="graph-candidate-label">潜在关系</span>
            <span className="graph-candidate-confidence">
              <strong>{Math.round(item.confidence * 100)}%</strong>
              <span>置信度</span>
            </span>
          </div>
          <div className="graph-candidate-relation">{item.relation}</div>
          <div className="graph-candidate-nodes">
            <span>{item.sourcePage}</span>
            <i aria-hidden="true">→</i>
            <span>{item.targetPage}</span>
          </div>
          <div
            className="graph-candidate-confidence-bar"
            aria-label={`置信度 ${Math.round(item.confidence * 100)}%`}
          >
            <span style={{ width: `${Math.max(0, Math.min(item.confidence * 100, 100))}%` }} />
          </div>
          <div className="graph-candidate-evidence">
            <span>证据</span>
            <p>{item.evidence}</p>
          </div>
          {item.status === 'pending' && (
            <div className="graph-candidate-actions">
              <button className="graph-candidate-accept" onClick={() => accept(item.id)}>
                采纳关系
              </button>
              <button className="graph-candidate-reject" onClick={() => reject(item.id)}>
                暂不采纳
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
