import type { Agent, JevSettings } from '../types.js';
import { createJevRoutingProvider } from '../infrastructure/ai/jevRoutingProvider.js';
import { llmClassifyAgents } from '../infrastructure/ai/llmRoutingClassifier.js';
import {
  GENERAL_AGENT_ID,
  createKeywordExactProvider,
  createLegacyRoutingProvider,
} from '../domains/routing/index.js';
import type { RoutingStep } from '../domains/routing/index.js';

/** Bind the model classifier to the domain's fallback Agent id. */
export const classify = (message: string, candidates: readonly Agent[]) =>
  llmClassifyAgents(message, candidates, GENERAL_AGENT_ID);

/** provider 是无状态单例，配置每次由调用方传入，因此每条消息零分配。 */
const LEGACY_PROVIDER = createLegacyRoutingProvider(classify);
const JEV_PROVIDER = createJevRoutingProvider(GENERAL_AGENT_ID);
const KEYWORD_EXACT_PROVIDER = createKeywordExactProvider();

/** 只含原有实现的单步列表；Jev 关闭与异常兜底都使用它。 */
export const LEGACY_ROUTING_STEPS: readonly RoutingStep[] = [
  { provider: LEGACY_PROVIDER, minConfidence: 0 },
];

/**
 * 组装本次路由的 provider 步。
 *
 * Jev 关闭时只返回原有实现一步，等价于接入前的行为；Jev 开启时按
 * 「关键词精确命中 → Jev → 原有实现」排序，原有实现永远兜底。
 *
 * @param jev Jev 实验设置
 * @returns 有序的 provider 步
 */
export function createDefaultRoutingSteps(jev: JevSettings): RoutingStep[] {
  const legacyStep: RoutingStep = { provider: LEGACY_PROVIDER, minConfidence: 0 };
  if (!jev.routingEnabled) return [legacyStep];

  const steps: RoutingStep[] = [];
  if (jev.routingBypassOnKeyword) {
    steps.push({ provider: KEYWORD_EXACT_PROVIDER, minConfidence: 0 });
  }
  steps.push({ provider: JEV_PROVIDER, minConfidence: jev.routingMinConfidence });
  steps.push(legacyStep);
  return steps;
}
