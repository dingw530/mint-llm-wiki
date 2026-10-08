import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateMessagesTokens } from '../token-estimator.js';
import type { HistoryMessage } from '../../types.js';

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null as any)).toBe(0);
  });

  it('should estimate based on 3 chars/token', () => {
    expect(estimateTokens('abc')).toBe(1); // 3 chars = 1 token
    expect(estimateTokens('abcdef')).toBe(2); // 6 chars = 2 tokens
  });

  it('should round up for non-divisible lengths', () => {
    expect(estimateTokens('ab')).toBe(1); // 2 chars → ceil(2/3) = 1
    expect(estimateTokens('abcd')).toBe(2); // 4 chars → ceil(4/3) = 2
  });

  it('should handle Chinese text', () => {
    // Chinese text is treated the same (3 chars/token)
    expect(estimateTokens('你好世界')).toBe(2); // 4 chars → 2
  });
});

describe('estimateMessagesTokens', () => {
  it('should estimate simple messages with per-message overhead', () => {
    const msgs: HistoryMessage[] = [
      { role: 'user', content: 'hello' }, // 5 chars → 2 tokens + 4 overhead
      { role: 'assistant', content: 'hi' }, // 2 chars → 1 token + 4 overhead
    ];
    const total = estimateMessagesTokens(msgs);
    expect(total).toBe(2 + 4 + 1 + 4); // 11
  });

  it('should include tool_calls in estimation', () => {
    const msgs: HistoryMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'bash', arguments: '{"command":"ls"}' },
          },
        ],
      },
    ];
    const total = estimateMessagesTokens(msgs);
    // bash (4 chars) + {"command":"ls"} (18 chars) = 22 chars → 8 tokens + 4 overhead
    expect(total).toBeGreaterThan(4);
  });

  it('should handle empty content gracefully', () => {
    const msgs: HistoryMessage[] = [
      { role: 'user', content: '' },
      { role: 'assistant', content: undefined as any },
    ];
    const total = estimateMessagesTokens(msgs);
    expect(total).toBe(8); // 2 msgs × 4 overhead
  });
});
