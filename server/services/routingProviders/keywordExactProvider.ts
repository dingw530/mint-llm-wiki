import { keywordMatchAgents } from './legacyRoutingProvider.js';
import type { AgentRoutingProvider } from './types.js';

/**
 * 关键词精确命中时短路 Jev。
 * 用户的显式触发词是最强的意图信号，且中文语义最不可质疑，因此优先于 Jev 判定。
 */
export function createKeywordExactProvider(): AgentRoutingProvider {
  return {
    id: 'keyword-exact',
    route: async ({ message, agents }) => {
      const match = keywordMatchAgents(message, agents);
      if (match.agentId && match.confidence >= 1.0) {
        return {
          kind: 'decision',
          decision: { agentId: match.agentId, confidence: match.confidence, method: 'keyword' },
        };
      }
      return { kind: 'abstain', reason: 'no_match' };
    },
  };
}
