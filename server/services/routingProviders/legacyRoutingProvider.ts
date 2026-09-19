import { AI_REQUEST_TIMEOUT_MS, getAdapter } from '../adapters/apiAdapter.js';
import * as settingsService from '../api/settingsService.js';
import type { Agent } from '../../types.js';
import type { AgentRoutingOutcome, AgentRoutingProvider } from './types.js';

/**
 * 原有路由实现，行为与接入 Jev 之前逐位一致。
 * 阈值语义属于本 provider 自身，不对外共享：见 `AgentRoutingDecision.confidence` 的说明。
 */

/** 路由兜底使用的 Agent id。 */
export const GENERAL_AGENT_ID = 'general';

/** 关键词精确命中的置信度。 */
const KEYWORD_EXACT_CONFIDENCE = 1.0;

/** 关键词正则命中的置信度。 */
const KEYWORD_REGEX_CONFIDENCE = 0.9;

/** 关键词子串命中的置信度。 */
const KEYWORD_SUBSTRING_CONFIDENCE = 0.6;

/** 高于该值直接采用关键词结果，不再调用 LLM 分类。 */
const KEYWORD_HIGH_CONFIDENCE = 0.8;

/** LLM 分类命中后写入的占位置信度；该值不代表模型校准结果。 */
const LLM_PLACEHOLDER_CONFIDENCE = 0.85;

/** 关键词匹配结果，等价于既有 `RoutingService.keywordMatch` 的返回形状。 */
export interface KeywordMatchResult {
  agentId: string | null;
  confidence: number;
}

/**
 * 关键词匹配（同步）。
 * 遍历所有 Agent 的 triggerKeywords，按优先级计算最佳匹配。
 * @param message 用户消息
 * @param agents 全量 Agent
 * @returns 最佳匹配的 Agent id 与置信度；无匹配时 agentId 为 null
 */
export function keywordMatchAgents(message: string, agents: readonly Agent[]): KeywordMatchResult {
  let bestAgent: string | null = null;
  let bestScore = 0;

  for (const agent of agents) {
    if (agent.available === false) continue;
    const keywords = agent.triggerKeywords || [];
    for (const keyword of keywords) {
      let score = 0;

      // 精确命中 (exact match)
      if (message === keyword) {
        score = KEYWORD_EXACT_CONFIDENCE;
      }
      // 正则匹配 — keyword 以 / 开头且以 / 结尾则视为正则
      else if (keyword.startsWith('/') && keyword.endsWith('/')) {
        try {
          const regex = new RegExp(keyword.slice(1, -1));
          if (regex.test(message)) score = KEYWORD_REGEX_CONFIDENCE;
        } catch {
          /* invalid regex, skip */
        }
      }
      // 部分包含 (substring match)
      else if (message.includes(keyword)) {
        score = KEYWORD_SUBSTRING_CONFIDENCE;
      }

      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent.id;
      }
    }
  }

  return { agentId: bestAgent, confidence: bestScore };
}

/**
 * 构建 LLM 分类 prompt。
 * @param agents 候选 Agent
 * @returns 分类提示词
 */
function buildClassifyPrompt(agents: readonly Agent[]): string {
  const agentLines = agents.map((a) => `- ${a.id}: ${a.description || a.name}`).join('\n');
  return `你是一个意图分类器。从以下 Agent 中选择最匹配用户问题的 Agent。
只返回 Agent ID，不要返回其他内容。

Agent 列表：
${agentLines}

最匹配的 Agent ID：`;
}

/**
 * LLM 分类（异步）。
 * 调用 AI API 从候选 Agent 中选择最匹配的。超时或异常返回 null 以便调用方降级。
 * @param message 用户消息
 * @param candidates 候选 Agent（含 general 时会被过滤）
 * @returns 命中的 agentId 与置信度；不可用时返回 null
 */
export async function llmClassifyAgents(
  message: string,
  candidates: readonly Agent[],
): Promise<{ agentId: string; confidence: number } | null> {
  // 无候选 Agent（仅有 general）时跳过
  const available = candidates.filter((a) => a.available !== false && a.id !== GENERAL_AGENT_ID);
  if (available.length === 0) return null;

  const prompt = buildClassifyPrompt(available);

  try {
    const settings = settingsService.getAiSettings();
    if (!settings.apiUrl || !settings.apiKey) return null;

    const adapter = getAdapter(settings.apiType || 'openai-chat');
    if (!adapter) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
    try {
      const content = await adapter.call(
        [
          { role: 'system', content: prompt },
          { role: 'user', content: message },
        ],
        { modelId: settings.modelId },
        settings.apiUrl,
        settings.apiKey,
        { maxTokens: 10, temperature: 0, signal: controller.signal },
      );

      const agentId = content.trim();

      // 验证返回的 agentId 是否在候选列表中
      if (agentId && candidates.some((a) => a.id === agentId)) {
        return { agentId, confidence: LLM_PLACEHOLDER_CONFIDENCE };
      }

      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    // 网络错误或超时 → 返回 null 降级
    return null;
  }
}

/** 用指定结论构造 outcome。 */
function decide(
  agentId: string,
  confidence: number,
  method: 'keyword' | 'llm' | 'fallback',
): AgentRoutingOutcome {
  return { kind: 'decision', decision: { agentId, confidence, method } };
}

/**
 * 构造原有路由 provider。
 *
 * 内部保留既有的三段阈值逻辑，低置信时返回 `general/fallback` 而不是弃权 ——
 * 这样当 Jev 关闭、步列表只剩本 provider 时，输出与接入前逐位一致。
 * @returns 路由 provider
 */
export function createLegacyRoutingProvider(): AgentRoutingProvider {
  return {
    id: 'legacy',
    route: async ({ message, agents }) => {
      const keywordResult = keywordMatchAgents(message, agents);

      if (!keywordResult.agentId) {
        return decide(GENERAL_AGENT_ID, 0, 'fallback');
      }
      if (keywordResult.confidence > KEYWORD_HIGH_CONFIDENCE) {
        return decide(keywordResult.agentId, keywordResult.confidence, 'keyword');
      }
      if (keywordResult.confidence >= KEYWORD_SUBSTRING_CONFIDENCE) {
        const llmResult = await llmClassifyAgents(message, agents);
        if (llmResult) return decide(llmResult.agentId, llmResult.confidence, 'llm');
        // LLM 超时/失败 → 降级用 keyword 结果
        return decide(keywordResult.agentId, keywordResult.confidence, 'keyword');
      }
      return decide(GENERAL_AGENT_ID, keywordResult.confidence, 'fallback');
    },
  };
}
