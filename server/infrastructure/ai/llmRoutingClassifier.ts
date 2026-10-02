import { AI_REQUEST_TIMEOUT_MS, getAdapter } from '../../services/adapters/apiAdapter.js';
import * as settingsService from '../../services/api/settingsService.js';
import type { Agent } from '../../types.js';

/** LLM 分类使用既有占位置信度。 */
const LLM_PLACEHOLDER_CONFIDENCE = 0.85;

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
 * @param generalAgentId 领域提供的兜底 Agent id
 * @returns 命中的 agentId 与置信度；不可用时返回 null
 */
export async function llmClassifyAgents(
  message: string,
  candidates: readonly Agent[],
  generalAgentId: string,
): Promise<{ agentId: string; confidence: number } | null> {
  // 无候选 Agent（仅有 general）时跳过
  const available = candidates.filter((a) => a.available !== false && a.id !== generalAgentId);
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
