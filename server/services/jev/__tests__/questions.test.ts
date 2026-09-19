import { describe, expect, it } from 'vitest';
import { CATEGORY_ORDER } from '../../api/memoryService.js';
import type { Agent } from '../../../types.js';
import {
  MEMORY_ACTION_OPTIONS,
  MEMORY_CATEGORIES,
  MEMORY_GATE_KEYS,
  MEMORY_STATE_MAX_CHARS,
  ROUTING_AGENT_KEY,
  ROUTING_STATE_MAX_CHARS,
  buildAgentRoutingQuestions,
  buildAgentRoutingState,
  buildMemoryGateQuestions,
  buildMemoryGateState,
} from '../questions.js';

/** 构造一个最小可用的候选 Agent。 */
function agent(id: string, name: string, description = ''): Agent {
  return {
    id,
    name,
    description,
    type: 'chat',
    systemPrompt: null,
    mcpServerIds: [],
    available: true,
    errorMessage: null,
    triggerKeywords: [],
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
  };
}

/** 读取路由 state 对象上的字段；state 类型是可选的，这里收窄后取用。 */
function readStateField(state: Record<string, string>, key: string): string {
  const value = state[key];
  if (value === undefined) throw new Error(`missing state field: ${key}`);
  return value;
}

describe('MEMORY_CATEGORIES', () => {
  it('stays in sync with the memory extraction category order', () => {
    expect([...MEMORY_CATEGORIES]).toEqual(CATEGORY_ORDER);
  });

  it('uses ASCII slugs so answers never need text parsing', () => {
    for (const category of MEMORY_CATEGORIES) {
      expect(category).toMatch(/^[a-z]+$/);
    }
  });
});

describe('buildAgentRoutingQuestions', () => {
  const candidates = [agent('research', '研究助手', '查资料'), agent('coder', '编程助手')];

  it('offers general plus one ASCII option per candidate', () => {
    const { questions } = buildAgentRoutingQuestions(candidates);
    const question = questions[ROUTING_AGENT_KEY];
    expect(question?.type).toBe('choice');
    if (question?.type !== 'choice') throw new Error('unexpected question type');
    expect(Object.keys(question.criteria)).toEqual(['general', 'a1', 'a2']);
  });

  it('maps every option id back to an agent id, including general', () => {
    const { agentIdByOption } = buildAgentRoutingQuestions(candidates);
    expect(agentIdByOption).toEqual({
      general: 'general',
      a1: 'research',
      a2: 'coder',
    });
  });

  it('offers only general when there are no candidates', () => {
    const { questions, agentIdByOption } = buildAgentRoutingQuestions([]);
    expect(agentIdByOption).toEqual({ general: 'general' });
    const question = questions[ROUTING_AGENT_KEY];
    if (question?.type !== 'choice') throw new Error('unexpected question type');
    expect(Object.keys(question.criteria)).toEqual(['general']);
  });
});

describe('buildAgentRoutingState', () => {
  it('lists candidates under their ASCII option ids', () => {
    const state = buildAgentRoutingState('帮我查点资料', [agent('research', '研究助手', '查资料')]);
    expect(readStateField(state, 'candidate_agents')).toContain('a1 | name: 研究助手');
    expect(readStateField(state, 'user_message')).toBe('帮我查点资料');
  });

  it('truncates an oversized message to the routing budget', () => {
    const state = buildAgentRoutingState('x'.repeat(5_000), []);
    expect(readStateField(state, 'user_message').length).toBeLessThanOrEqual(
      ROUTING_STATE_MAX_CHARS + 1,
    );
  });
});

describe('buildMemoryGateQuestions', () => {
  it('asks the four gate questions under stable ASCII keys', () => {
    const questions = buildMemoryGateQuestions();
    expect(Object.keys(questions)).toEqual([
      MEMORY_GATE_KEYS.worth,
      MEMORY_GATE_KEYS.category,
      MEMORY_GATE_KEYS.importance,
      MEMORY_GATE_KEYS.action,
    ]);
  });

  it('describes the noul question with both outcomes', () => {
    const question = buildMemoryGateQuestions()[MEMORY_GATE_KEYS.worth];
    if (question?.type !== 'noul') throw new Error('unexpected question type');
    expect(question.criteria?.true).toBeTruthy();
    expect(question.criteria?.false).toBeTruthy();
  });

  it('offers every memory category as a choice option', () => {
    const question = buildMemoryGateQuestions()[MEMORY_GATE_KEYS.category];
    if (question?.type !== 'choice') throw new Error('unexpected question type');
    expect(Object.keys(question.criteria)).toEqual([...MEMORY_CATEGORIES]);
  });

  it('offers the four write actions as a choice question', () => {
    const question = buildMemoryGateQuestions()[MEMORY_GATE_KEYS.action];
    if (question?.type !== 'choice') throw new Error('unexpected question type');
    expect(Object.keys(question.criteria)).toEqual([...MEMORY_ACTION_OPTIONS]);
  });

  it('provides an ordered importance legend with at least two levels', () => {
    const question = buildMemoryGateQuestions()[MEMORY_GATE_KEYS.importance];
    if (question?.type !== 'score') throw new Error('unexpected question type');
    expect(Array.isArray(question.criteria)).toBe(true);
    expect(question.criteria.length).toBeGreaterThanOrEqual(2);
  });
});

describe('buildMemoryGateState', () => {
  it('passes the user message through', () => {
    expect(buildMemoryGateState(' 我住在杭州 ')).toBe('我住在杭州');
  });

  it('truncates an oversized message to the memory budget', () => {
    expect(buildMemoryGateState('y'.repeat(20_000)).length).toBeLessThanOrEqual(
      MEMORY_STATE_MAX_CHARS + 1,
    );
  });
});
