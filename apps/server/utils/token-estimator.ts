/**
 * Token 估算工具
 *
 * 不使用外部依赖（如 tiktoken），基于字符数粗略估算 token 数量。
 * 精确度约 70-80%，足以用于滑动窗口决策。
 *
 * 估算规则：
 *   英文 ~4 字符/token，中文 ~2 字符/token
 *   混合文本取中间值，统一按 3 字符/token
 */

import type { HistoryMessage } from '../types.js';

const CHARS_PER_TOKEN = 3;

/**
 * 估算单段文本的 token 数
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * 估算消息列表的总 token 数
 * 包含 content、tool_calls 名称和参数
 */
export function estimateMessagesTokens(messages: HistoryMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content || '');

    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(tc.function.name + tc.function.arguments);
      }
    }
  }
  // 每条消息的开销（role 字段、格式包装等）
  total += messages.length * 4;
  return total;
}
