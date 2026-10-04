import type { HistoryMessage } from '../types.js';

export type AgentStatusPhase =
  'awaiting_model' | 'executing_tools' | 'finalizing' | 'completed' | 'failed' | 'cancelled';

const PHASE_LABELS: Record<AgentStatusPhase, string> = {
  awaiting_model: '等待模型响应',
  executing_tools: '执行工具中',
  finalizing: '整理结果中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export interface AgentStatusSnapshot {
  round: number;
  maxRounds: number;
  elapsedMs: number;
  toolCount: number;
  toolCounts: Record<string, number>;
  toolBudgets: Record<string, AgentToolBudget>;
  totalToolBudget?: AgentToolBudget;
  currentTool?: string;
  retryCount: number;
  lastError?: string;
  loopDetected: boolean;
  phase: AgentStatusPhase;
}

export interface AgentToolBudget {
  limit: number;
  used: number;
  remaining: number;
}

const STATUS_MARKER = '<agent_status>';
const MAX_FIELD_LENGTH = 160;

function safeField(value: string | undefined): string {
  return value?.replace(/[\r\n]+/g, ' ').slice(0, MAX_FIELD_LENGTH) || '无';
}

function formatToolCounts(toolCounts: Record<string, number>): string {
  const entries = Object.entries(toolCounts);
  return entries.length === 0
    ? '无'
    : entries.map(([name, count]) => `${safeField(name)}=${count}`).join(', ');
}

function formatToolBudgets(
  toolBudgets: Record<string, AgentToolBudget>,
  totalToolBudget?: AgentToolBudget,
): string {
  const entries = Object.entries(toolBudgets);
  const formatted = entries.map(
    ([name, budget]) =>
      `${safeField(name)}=${budget.used}/${budget.limit}（剩余=${budget.remaining}）`,
  );
  if (totalToolBudget) {
    formatted.unshift(
      `总计=${totalToolBudget.used}/${totalToolBudget.limit}（剩余=${totalToolBudget.remaining}）`,
    );
  }
  return formatted.length === 0 ? '无' : formatted.join(', ');
}

/**
 * 将一次 ReAct 运行的真实状态转换为模型可直接读取的末尾元消息。
 * @param snapshot 当前运行状态快照
 * @returns 追加到模型上下文末尾的状态消息
 */
export function buildAgentStatusMessage(snapshot: AgentStatusSnapshot): HistoryMessage {
  const loopGuard = snapshot.loopDetected ? '已触发' : '正常';
  // 注意：不渲染 elapsedMs。它是每轮必变的时间戳，对模型决策无价值，
  // 却会让这条状态消息每轮内容不同，破坏 LLM 前缀缓存稳定性。
  const content = [
    STATUS_MARKER,
    `当前轮次：${snapshot.round}/${snapshot.maxRounds}`,
    `工具调用：${formatToolCounts(snapshot.toolCounts)}（总计=${snapshot.toolCount}）`,
    `工具预算：${formatToolBudgets(snapshot.toolBudgets, snapshot.totalToolBudget)}`,
    `当前工具：${safeField(snapshot.currentTool)}`,
    `重试次数：${snapshot.retryCount}`,
    `最近错误：${safeField(snapshot.lastError)}`,
    `循环保护：${loopGuard}`,
    '策略：重复失败后更换处理方式；接近迭代上限时交付已验证的答案；循环检测触发或工具预算耗尽时停止。',
    `阶段：${PHASE_LABELS[snapshot.phase]}`,
    '</agent_status>',
  ].join('\n');

  return { role: 'user', content };
}

/**
 * 删除当前运行上下文中旧的状态栏消息，保留历史用户消息和模型轨迹。
 * @param messages 当前模型上下文
 * @returns 不含旧状态栏的消息列表
 */
export function removeAgentStatusMessages(messages: HistoryMessage[]): HistoryMessage[] {
  return messages.filter(
    (message) =>
      !(
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.includes(STATUS_MARKER)
      ),
  );
}

export function isAgentStatusMessage(message: HistoryMessage): boolean {
  return (
    message.role === 'user' &&
    typeof message.content === 'string' &&
    message.content.includes(STATUS_MARKER)
  );
}
