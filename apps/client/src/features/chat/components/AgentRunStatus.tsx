export interface AgentRunStatusData {
  round: number;
  maxRounds: number;
  elapsedMs: number;
  toolCount: number;
  currentTool?: string;
  retryCount: number;
  lastError?: string;
  loopDetected: boolean;
  phase: string;
}

/** 将 SSE 的松散字段解析为可安全渲染的状态快照。 */
export function parseAgentRunStatusData(data: Record<string, unknown>): AgentRunStatusData | null {
  if (typeof data.round !== 'number' || typeof data.maxRounds !== 'number') return null;
  if (typeof data.toolCount !== 'number' || typeof data.retryCount !== 'number') return null;
  if (typeof data.phase !== 'string' || typeof data.loopDetected !== 'boolean') return null;
  return {
    round: data.round,
    maxRounds: data.maxRounds,
    elapsedMs: typeof data.elapsedMs === 'number' ? data.elapsedMs : 0,
    toolCount: data.toolCount,
    currentTool: typeof data.currentTool === 'string' ? data.currentTool : undefined,
    retryCount: data.retryCount,
    lastError: typeof data.lastError === 'string' ? data.lastError : undefined,
    loopDetected: data.loopDetected,
    phase: data.phase,
  };
}

interface AgentRunStatusProps {
  status: AgentRunStatusData | null;
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'awaiting_model': return '分析中';
    case 'executing_tools': return '执行工具';
    case 'finalizing': return '整理答案';
    case 'completed': return '已完成';
    case 'failed': return '失败';
    case 'cancelled': return '已停止';
    default: return phase;
  }
}

/**
 * 展示当前 ReAct 运行的结构化状态，不展示隐藏思维链或工具原始结果。
 * @param status 服务端通过 SSE 推送的状态快照
 */
export default function AgentRunStatus({ status }: AgentRunStatusProps) {
  if (!status) return null;

  return (
    <div className={`agent-run-status agent-run-status--${status.phase}`} role="status" aria-live="polite">
      <span className="agent-run-status-pulse" aria-hidden="true" />
      <span className="agent-run-status-phase">Agent {phaseLabel(status.phase)}</span>
      <span className="agent-run-status-stat">第 {status.round}/{status.maxRounds} 轮</span>
      <span className="agent-run-status-stat">工具 {status.toolCount} 次</span>
      {status.currentTool && <span className="agent-run-status-tool">{status.currentTool}</span>}
      {status.retryCount > 0 && <span className="agent-run-status-warning">重试 {status.retryCount}</span>}
      {status.loopDetected && <span className="agent-run-status-warning">已触发循环保护</span>}
      {status.lastError && status.phase !== 'completed' && (
        <span className="agent-run-status-error" title={status.lastError}>有异常</span>
      )}
    </div>
  );
}
