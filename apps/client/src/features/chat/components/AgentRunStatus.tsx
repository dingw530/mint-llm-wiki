export interface SubagentStatusData {
  childRunId: string;
  agentId: string;
  status: 'running' | 'awaiting_parent_action' | 'completed' | 'failed' | 'cancelled';
  approvalId?: string;
  round?: number;
  toolName?: string;
  reason?: string;
}

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
  subagents?: SubagentStatusData[];
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
  onToolApproval?: (approvalId: string, action: 'approve' | 'deny') => void;
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'awaiting_model':
      return '分析中';
    case 'executing_tools':
      return '执行工具';
    case 'finalizing':
      return '整理答案';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已停止';
    default:
      return phase;
  }
}

/** Returns a concise visible label for a delegated Agent's lifecycle state. */
function subagentStatusLabel(status: SubagentStatusData['status']): string {
  switch (status) {
    case 'running':
      return '运行中';
    case 'awaiting_parent_action':
      return '等待审批';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已停止';
  }
}

/** 展示当前 ReAct 运行和委派子 Agent 的结构化状态。
 * @param status 当前父 Agent 和子 Agent 状态
 * @param onToolApproval 审批回调
 */
export default function AgentRunStatus({ status, onToolApproval }: AgentRunStatusProps) {
  if (!status) return null;

  return (
    <div
      className={`agent-run-status agent-run-status--${status.phase}`}
      role="status"
      aria-live="polite"
    >
      <div className="agent-run-status-summary">
        <span className="agent-run-status-pulse" aria-hidden="true" />
        <span className="agent-run-status-phase">Agent {phaseLabel(status.phase)}</span>
        <span className="agent-run-status-stat">
          第 {status.round}/{status.maxRounds} 轮
        </span>
        <span className="agent-run-status-stat">工具 {status.toolCount} 次</span>
        {status.currentTool && <span className="agent-run-status-tool">{status.currentTool}</span>}
        {status.retryCount > 0 && (
          <span className="agent-run-status-warning">重试 {status.retryCount}</span>
        )}
        {status.loopDetected && <span className="agent-run-status-warning">已触发循环保护</span>}
        {status.lastError && status.phase !== 'completed' && (
          <span className="agent-run-status-error" title={status.lastError}>
            有异常
          </span>
        )}
      </div>
      {status.subagents?.map((subagent) => (
        <div className="agent-run-subagent" key={subagent.childRunId}>
          <span>
            {subagent.agentId}: {subagentStatusLabel(subagent.status)}
          </span>
          {subagent.toolName && <span className="agent-run-status-tool">{subagent.toolName}</span>}
          {subagent.reason && <span className="agent-run-subagent-reason">{subagent.reason}</span>}
          {subagent.status === 'awaiting_parent_action' &&
            subagent.approvalId &&
            onToolApproval && (
              <span className="agent-run-subagent-actions">
                <button
                  type="button"
                  onClick={() => onToolApproval(subagent.approvalId!, 'approve')}
                >
                  批准
                </button>
                <button type="button" onClick={() => onToolApproval(subagent.approvalId!, 'deny')}>
                  拒绝
                </button>
              </span>
            )}
        </div>
      ))}
    </div>
  );
}
