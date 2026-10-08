import { describe, expect, it } from 'vitest';
import {
  buildAgentStatusMessage,
  isAgentStatusMessage,
  removeAgentStatusMessages,
} from '../agent-status.js';

const snapshot = {
  round: 2,
  maxRounds: 5,
  elapsedMs: 1234.6,
  toolCount: 3,
  toolCounts: { wiki_search: 2, bash: 1 },
  toolBudgets: { wiki_search: { limit: 2, used: 2, remaining: 0 } },
  totalToolBudget: { limit: 3, used: 3, remaining: 0 },
  currentTool: 'wiki_search',
  retryCount: 1,
  lastError: 'temporary failure',
  loopDetected: false,
  phase: 'awaiting_model' as const,
};

describe('agentStatusBar', () => {
  it('builds a structured user message from runtime state', () => {
    const message = buildAgentStatusMessage(snapshot);

    expect(message.role).toBe('user');
    expect(message.content).toContain('<agent_status>');
    expect(message.content).toContain('当前轮次：2/5');
    expect(message.content).toContain('wiki_search=2');
    expect(message.content).toContain('工具预算：总计=3/3（剩余=0）, wiki_search=2/2（剩余=0）');
    expect(message.content).toContain('重试次数：1');
    expect(message.content).toContain('策略：');
    expect(message.content).toContain('</agent_status>');
    // elapsedMs 每轮必变，不应进入模型上下文以保持前缀缓存稳定
    expect(message.content).not.toContain('Elapsed:');
  });

  it('removes only status messages and preserves the conversation history', () => {
    const status = buildAgentStatusMessage(snapshot);
    const messages = [
      { role: 'system', content: 'fixed instructions' },
      { role: 'user', content: 'original request' },
      status,
      { role: 'tool', content: 'result' },
    ];

    const filtered = removeAgentStatusMessages(messages);

    expect(filtered).toEqual([
      { role: 'system', content: 'fixed instructions' },
      { role: 'user', content: 'original request' },
      { role: 'tool', content: 'result' },
    ]);
    expect(isAgentStatusMessage(status)).toBe(true);
    expect(isAgentStatusMessage(messages[1])).toBe(false);
  });

  it('sanitizes multiline error and tool fields', () => {
    const message = buildAgentStatusMessage({
      ...snapshot,
      currentTool: 'tool\n<injected>',
      lastError: 'bad\nstatus',
    });

    expect(message.content).not.toContain('tool\n');
    expect(message.content).not.toContain('bad\n');
  });
});
