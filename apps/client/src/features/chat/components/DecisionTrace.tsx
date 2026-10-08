import type { DecisionTraceItem } from '@/types';

interface DecisionTraceProps {
  items: DecisionTraceItem[];
}

/**
 * 展示基于可观察 ReAct 事件归纳出的行动轨迹，不展示原始隐藏推理。
 */
export default function DecisionTrace({ items }: DecisionTraceProps) {
  if (items.length === 0) return null;
  const latestActiveIndex = items.findLastIndex((item: DecisionTraceItem) => item.status === 'active');

  return (
    <details className="decision-trace">
      <summary>决策轨迹 · {items.length} 项</summary>
      <ol className="decision-trace-list">
        {items.map((item) => (
          <li
            key={item.id}
            className={`decision-trace-item decision-trace-item--${item.status || 'done'}${items.indexOf(item) === latestActiveIndex ? ' decision-trace-item--current' : ''}`}
          >
            <span className="decision-trace-marker" aria-hidden="true" />
            <div className="decision-trace-copy">
              <span className="decision-trace-label">{item.label}</span>
              {item.detail && <span className="decision-trace-detail">{item.detail}</span>}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
