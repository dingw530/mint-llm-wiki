import { callJev } from '../jev/jevClient.js';
import { toJevConfig } from '../jev/config.js';
import {
  ROUTING_AGENT_KEY,
  buildAgentRoutingQuestions,
  buildAgentRoutingState,
} from '../jev/questions.js';
import { GENERAL_AGENT_ID } from './legacyRoutingProvider.js';
import type { AgentRoutingProvider } from './types.js';

/**
 * Jev 路由 provider：把候选 Agent 放进 choice 的选项表，由 Jev 选出最匹配的一项。
 * 选项 key 是 ASCII 稳定 id，返回值必须命中映射表，因此不依赖任何文本解析。
 */
export function createJevRoutingProvider(): AgentRoutingProvider {
  return {
    id: 'jev',
    route: async ({ message, agents }, config) => {
      const candidates = agents.filter(
        (agent) => agent.available !== false && agent.id !== GENERAL_AGENT_ID,
      );
      if (candidates.length === 0) return { kind: 'abstain', reason: 'no_candidates' };

      const { questions, agentIdByOption } = buildAgentRoutingQuestions(candidates);
      const result = await callJev(
        toJevConfig(config.jev),
        {
          state: buildAgentRoutingState(message, candidates),
          model: config.jev.model,
          questions,
        },
        { operation: 'agent_routing' },
      );

      if (!result.ok) {
        return { kind: 'unavailable', reason: result.reason, message: result.message };
      }

      const answer = result.answers[ROUTING_AGENT_KEY];
      if (!answer || answer.type !== 'choice') {
        return { kind: 'abstain', reason: 'answer_not_a_candidate' };
      }

      const agentId = agentIdByOption[answer.choice];
      if (agentId === undefined) return { kind: 'abstain', reason: 'answer_not_a_candidate' };

      return {
        kind: 'decision',
        decision: { agentId, confidence: answer.confidence, method: 'jev' },
      };
    },
  };
}
