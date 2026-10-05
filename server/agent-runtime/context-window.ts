/**
 * 上下文窗口管理
 *
 * 在 ReAct 循环的每次 AI 调用前修剪消息历史，防止消息数组无限制增长。
 * 策略：保留 system 消息 + 最近 N 轮对话，连带保留关联的 tool 消息。
 */

import type { HistoryMessage } from '../types.js';
import { estimateMessagesTokens } from '../utils/token-estimator.js';

/** 默认上下文预算，留出模型输出空间后再交给消息历史使用。 */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 100_000;
export const DEFAULT_OUTPUT_TOKEN_RESERVE = 4_096;
export const CONTEXT_COMPRESSION_THRESHOLD = 0.8;

export interface ContextPreparationOptions {
  /** 输入消息可使用的最大 estimated token 数。 */
  maxTokens: number;
  /** 超过阈值后，将旧上下文交给调用方生成摘要。 */
  summarize?: (messages: HistoryMessage[]) => Promise<string>;
}

export interface TrimOptions {
  /** 保留的最新对话轮数，默认 10 */
  maxRounds: number;
  /** 可选：token 上限（当前未实现） */
  maxTokens?: number;
}

/**
 * 修剪消息列表到滑动窗口内
 *
 * 规则：
 * 1. system 消息始终保留
 * 2. 从尾部向前取最近 N 轮对话
 * 3. tool 消息连带保留（不能脱离其 assistant 独立存在）
 */
export function trimContext(messages: HistoryMessage[], options: TrimOptions): HistoryMessage[] {
  const { maxRounds } = options;

  if (maxRounds <= 0) return messages;

  // 分离 system 消息
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');

  if (nonSystem.length === 0) return messages;

  // 截取最近 N 轮
  const recent = takeRecentRounds(nonSystem, maxRounds);

  return [...systemMessages, ...recent];
}

/**
 * 按 user 边界切分完整上下文单元。
 * 一个单元包含 user 消息及其后的 assistant/tool 消息，避免裁剪出孤立 tool 结果。
 * @param messages 待处理的消息列表
 * @returns 不包含 system 消息的上下文单元
 */
export function splitContextUnits(messages: HistoryMessage[]): HistoryMessage[][] {
  const units: HistoryMessage[][] = [];
  let current: HistoryMessage[] = [];

  for (const message of messages.filter((item) => item.role !== 'system')) {
    if (message.role === 'user' && current.length > 0) {
      units.push(current);
      current = [];
    }
    current.push(message);
  }

  if (current.length > 0) units.push(current);
  return units;
}

/**
 * 为超长上下文生成不依赖 LLM 的降级摘要。
 * 保留工具名、角色、路径/URL 等原始标识符附近的文本，避免压缩失败时阻断任务。
 * @param messages 待摘要的历史消息
 * @param maxTokens 摘要最大 estimated token 数
 * @returns 确定性摘要文本
 */
export function buildFallbackContextSummary(messages: HistoryMessage[], maxTokens = 2_000): string {
  const lines = messages.map((message) => {
    const toolNames = message.tool_calls?.map((call) => call.function.name).join(', ');
    const role = toolNames ? `${message.role} [${toolNames}]` : message.role;
    return `${role}: ${(message.content || '').replace(/\s+/g, ' ').trim()}`;
  });
  const maxChars = Math.max(240, maxTokens * 3);
  const content = lines.join('\n').slice(0, maxChars);
  return `[CONTEXT_SUMMARY]\n以下是较早上下文的降级摘要，原始内容已不再完整保留：\n${content}`;
}

/**
 * 为当前模型调用准备预算受控的上下文。
 * 低于阈值时保留原消息；超过阈值时压缩较早单元，并最终按完整单元降级裁剪。
 * @param messages 原始消息列表
 * @param options 预算和摘要回调
 * @returns 不超过预算的消息列表
 */
export async function prepareContext(
  messages: HistoryMessage[],
  options: ContextPreparationOptions,
): Promise<HistoryMessage[]> {
  const systemMessages = messages.filter((message) => message.role === 'system');
  const units = splitContextUnits(messages);
  if (units.length === 0) return systemMessages;

  const budget = Math.max(1, options.maxTokens);
  const threshold = Math.floor(budget * CONTEXT_COMPRESSION_THRESHOLD);
  const estimateTokens = estimateMessagesTokens(messages);
  if (estimateTokens <= threshold) return messages;

  const latestUnit = units[units.length - 1];
  const olderUnits = units.slice(0, -1);
  let summary = '';

  if (olderUnits.length > 0) {
    const olderMessages = olderUnits.flat();
    try {
      summary = (await options.summarize?.(olderMessages))?.trim() || '';
    } catch {
      summary = '';
    }
    if (!summary) summary = buildFallbackContextSummary(olderMessages);
  }

  const summaryMessage: HistoryMessage | null = summary
    ? {
        role: 'user',
        content: `[压缩后的历史摘要]\n${summary}`,
      }
    : null;
  let candidate = [...systemMessages, ...(summaryMessage ? [summaryMessage] : []), ...latestUnit];

  // 当前最新单元必须优先保留；旧单元按时间从旧到新删除，直到满足预算。
  let retainedUnits = units.slice(-1);
  while (
    estimateMessagesTokens([
      ...systemMessages,
      ...(summaryMessage && candidate.includes(summaryMessage) ? [summaryMessage] : []),
      ...retainedUnits.flat(),
    ]) > budget &&
    retainedUnits.length > 1
  ) {
    retainedUnits = retainedUnits.slice(1);
  }

  candidate = [
    ...systemMessages,
    ...(summaryMessage && retainedUnits.length > 0 ? [summaryMessage] : []),
    ...retainedUnits.flat(),
  ];

  // 极端情况下最新单元自身超预算，按消息内容做最后保护性截断。
  if (estimateMessagesTokens(candidate) > budget) {
    const latestOnly = [...systemMessages, ...retainedUnits.flat()];
    const summaryAllowance = Math.max(0, (budget - estimateMessagesTokens(latestOnly) - 8) * 3);
    if (summaryMessage && summaryAllowance > 0) {
      candidate = [
        ...latestOnly.slice(0, systemMessages.length),
        {
          ...summaryMessage,
          content: summaryMessage.content.slice(0, summaryAllowance),
        },
        ...latestOnly.slice(systemMessages.length),
      ];
    }

    if (estimateMessagesTokens(candidate) <= budget) return candidate;

    const availableChars = Math.max(0, (budget - estimateMessagesTokens(systemMessages)) * 3);
    const latest = retainedUnits.flat();
    let remaining = availableChars;
    const shortened = latest.map((message) => {
      const content = message.content || '';
      const allowance = Math.max(0, Math.min(content.length, remaining));
      remaining -= allowance;
      return allowance === content.length
        ? message
        : { ...message, content: content.slice(0, allowance) + '\n[内容已按上下文预算截断]' };
    });
    candidate = [...systemMessages, ...shortened];
  }

  return candidate;
}

/**
 * 从消息列表尾部向前扫描，取最近 N 轮对话
 *
 * "一轮"定义：
 *   user → assistant(可能含 tool_calls) → tool*(可选，零到多个)
 *
 * 扫描规则：
 *   从尾部开始，遇到 assistant(含 tool_calls) 或 user 标记为一轮计数
 *   tool 消息跟随其关联的 assistant，不计入轮数
 */
function takeRecentRounds(messages: HistoryMessage[], maxRounds: number): HistoryMessage[] {
  let rounds = 0;
  let cutIndex = messages.length;

  // 从后向前扫描
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];

    if (msg.role === 'tool') {
      continue; // tool 消息随其 assistant 保留
    }

    // user 或 assistant 消息标记为一轮
    rounds++;

    if (rounds > maxRounds) {
      // 超过窗口：从下一轮开始截断
      // 跳过当前轮的 user/assistant 及其后续的 tool 消息
      cutIndex = i + 1;
      break;
    }

    if (i === 0) {
      cutIndex = 0;
    }
  }

  // 确保不截断在 tool 消息中间：tool 消息必须跟随其 assistant(tool_calls) 消息
  while (cutIndex < messages.length && messages[cutIndex].role === 'tool') {
    cutIndex++;
  }

  return messages.slice(cutIndex);
}
