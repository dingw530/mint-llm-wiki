import type { Agent } from '../../types.js';
import type { JevQuestion } from './types.js';

/**
 * Jev 的判定指令与选项 key 一律使用英文与 ASCII，中文 Agent 名与描述只作为 state 中的数据出现。
 * 这样输出侧不依赖中文分词，代码可以直接把返回的选项 id 映射回业务标识。
 */

/** 路由 question 的 key。 */
export const ROUTING_AGENT_KEY = 'agent';

/** 记忆门控四个 question 的 key。 */
export const MEMORY_GATE_KEYS = {
  worth: 'worth',
  category: 'category',
  importance: 'importance',
  action: 'action',
} as const;

/**
 * 记忆分类的规范 ASCII slug。
 * 必须与 `memoryService` 的 `CATEGORY_ORDER` 一致，由 `questions.test.ts` 断言锁定。
 */
export const MEMORY_CATEGORIES = [
  'personal',
  'preference',
  'feedback',
  'project',
  'goal',
  'general',
] as const;

/** 记忆写入动作，与 `MemoryOperationAction` 一致。 */
export const MEMORY_ACTION_OPTIONS = ['ADD', 'UPDATE', 'NOOP', 'DELETE'] as const;

/** 路由 state 的字符上限；与 questions 共享 32k token 预算的保守切分。 */
export const ROUTING_STATE_MAX_CHARS = 2_000;

/** 记忆门控 state 的字符上限。 */
export const MEMORY_STATE_MAX_CHARS = 12_000;

const CATEGORY_DESCRIPTIONS: Record<(typeof MEMORY_CATEGORIES)[number], string> = {
  personal: 'Identity, role, location or background of the user',
  preference: 'Likes, dislikes, style, language or answer-format preferences',
  feedback: 'Corrections, dissatisfaction or extra requirements about assistant behaviour',
  project: 'Ongoing work, tech stack or business domain the user is involved in',
  goal: 'Objectives, plans or learning goals the user wants to reach',
  general: 'Other durable facts about the user that fit none of the above',
};

const ACTION_DESCRIPTIONS: Record<(typeof MEMORY_ACTION_OPTIONS)[number], string> = {
  ADD: 'The fact is not stored yet',
  UPDATE: 'The fact corrects or refines an existing memory',
  NOOP: 'The fact is already stored and unchanged',
  DELETE: 'The user explicitly retracts an existing memory',
};

/** 记忆重要度的有序档位，至少两档。 */
const IMPORTANCE_LEGEND = [
  'trivial: not worth storing',
  'minor: mildly useful context',
  'moderate: useful across conversations',
  'important: strongly shapes future answers',
  'critical: core identity or hard constraint',
];

/** 截断文本到指定字符上限，超出时追加省略号标记。 */
function truncate(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}…`;
}

/** 路由选项 id 与 Agent id 的映射结果。 */
export interface AgentRoutingQuestions {
  questions: Record<string, JevQuestion>;
  /** 选项 id → Agent id。用于把 Jev 的 choice 映射回业务标识。 */
  agentIdByOption: Record<string, string>;
}

/**
 * 构造路由 question：在候选 Agent 中选出一个。
 * 选项 key 使用 ASCII 稳定 id（`general` 与 `a1`、`a2`…），中文名与描述放在选项描述中。
 * @param candidates 候选 Agent（已过滤 unavailable 与 general）
 * @returns question 与选项到 Agent 的映射
 */
export function buildAgentRoutingQuestions(candidates: readonly Agent[]): AgentRoutingQuestions {
  const criteria: Record<string, string | null> = {
    general: 'General-purpose assistant with no specialisation',
  };
  const agentIdByOption: Record<string, string> = { general: 'general' };
  candidates.forEach((agent, index) => {
    const optionId = `a${index + 1}`;
    const description = agent.description?.trim();
    criteria[optionId] = truncate(description ? `${agent.name} — ${description}` : agent.name, 120);
    agentIdByOption[optionId] = agent.id;
  });
  return {
    questions: {
      [ROUTING_AGENT_KEY]: {
        type: 'choice',
        instructions:
          'Pick the single agent best suited to answer the user message. ' +
          'Choose "general" when no specialised agent clearly applies.',
        criteria,
      },
    },
    agentIdByOption,
  };
}

/**
 * 构造路由 state：候选 Agent 名册与原始用户消息。
 * @param message 用户消息原文
 * @param candidates 候选 Agent（与 `buildAgentRoutingQuestions` 传入同一数组）
 * @returns 带描述性键的 state 对象
 */
export function buildAgentRoutingState(
  message: string,
  candidates: readonly Agent[],
): Record<string, string> {
  const roster = candidates
    .map((agent, index) => {
      const description = agent.description?.trim() || '(no description)';
      return `a${index + 1} | name: ${agent.name} | description: ${description}`;
    })
    .join('\n');
  return {
    candidate_agents: roster || '(none)',
    user_message: truncate(message, ROUTING_STATE_MAX_CHARS),
  };
}

/**
 * 构造记忆门控的四个 question，一次请求问全。
 * @returns question 表
 */
export function buildMemoryGateQuestions(): Record<string, JevQuestion> {
  return {
    [MEMORY_GATE_KEYS.worth]: {
      type: 'noul',
      instructions:
        'Does this message contain a durable fact about the user that is worth recalling ' +
        'in future conversations?',
      criteria: {
        true: 'States a stable fact, preference, correction or goal about the user',
        false: 'Greeting, small talk, one-off question or nothing stable about the user',
      },
    },
    [MEMORY_GATE_KEYS.category]: {
      type: 'choice',
      instructions: 'Which single category best describes the memorable content?',
      criteria: { ...CATEGORY_DESCRIPTIONS },
    },
    [MEMORY_GATE_KEYS.importance]: {
      type: 'score',
      instructions: 'How important is this fact for future conversations?',
      criteria: IMPORTANCE_LEGEND,
    },
    [MEMORY_GATE_KEYS.action]: {
      type: 'choice',
      instructions:
        'What write action applies to this fact, given the existing memories listed in the state?',
      criteria: { ...ACTION_DESCRIPTIONS },
    },
  };
}

/**
 * 构造记忆门控 state：待判断的用户消息原文。
 * @param userContent 触发本轮提取的用户消息
 * @returns state 文本
 */
export function buildMemoryGateState(userContent: string): string {
  return truncate(userContent, MEMORY_STATE_MAX_CHARS);
}
