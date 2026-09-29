import { describe, it, expect, vi } from 'vitest';
import {
  buildFallbackContextSummary,
  prepareContext,
  splitContextUnits,
  trimContext,
} from '../contextWindow.js';
import type { HistoryMessage } from '../../../types.js';

function user(content: string): HistoryMessage {
  return { role: 'user', content };
}

function assistant(content: string, toolCalls?: any[]): HistoryMessage {
  const msg: HistoryMessage = { role: 'assistant', content };
  if (toolCalls) msg.tool_calls = toolCalls;
  return msg;
}

function toolMsg(toolCallId: string, content: string): HistoryMessage {
  return { role: 'tool', content, tool_call_id: toolCallId } as HistoryMessage;
}

function system(content: string): HistoryMessage {
  return { role: 'system', content };
}

describe('trimContext', () => {
  it('should preserve all system messages', () => {
    const msgs = [system('sys1'), system('sys2'), user('hi'), assistant('hello')];
    const result = trimContext(msgs, { maxRounds: 10 });
    expect(result.filter((m) => m.role === 'system')).toHaveLength(2);
  });

  it('should return all messages when within maxRounds', () => {
    const msgs = [system('s'), user('a'), assistant('b'), user('c'), assistant('d')];
    const result = trimContext(msgs, { maxRounds: 10 });
    expect(result).toHaveLength(5);
  });

  it('should trim keeping last N user/assistant messages', () => {
    // Each user or assistant counts as 1 round (not pairs)
    const msgs = [
      system('s'),
      user('1'),
      assistant('a1'),
      user('2'),
      assistant('a2'),
      user('3'),
      assistant('a3'),
    ];
    const result = trimContext(msgs, { maxRounds: 2 });
    // maxRounds=2 keeps last 2 non-tool messages: user3, a3
    const nonSystem = result.filter((m) => m.role !== 'system');
    expect(nonSystem).toHaveLength(2);
    expect((nonSystem[0] as any).content).toBe('3');
  });

  it('should keep tool messages attached to their assistant', () => {
    const msgs = [
      system('s'),
      user('1'),
      assistant('a1', [
        { id: 'tc1', type: 'function', function: { name: 'bash', arguments: '{}' } },
      ]),
      toolMsg('tc1', 'result1'),
      user('2'),
      assistant('a2'),
    ];
    const result = trimContext(msgs, { maxRounds: 3 });
    const nonSystem = result.filter((m) => m.role !== 'system');
    // With maxRounds=3: a2(round1), user2(round2), a1+tc1(round3) → all kept
    expect(nonSystem.some((m) => m.role === 'tool')).toBe(true);
  });

  it('should handle empty non-system messages', () => {
    const msgs = [system('s')];
    const result = trimContext(msgs, { maxRounds: 5 });
    expect(result).toHaveLength(1);
  });

  it('should handle single round', () => {
    const msgs = [system('s'), user('hi'), assistant('hello')];
    const result = trimContext(msgs, { maxRounds: 1 });
    // maxRounds=1: a(round1), user(round2) → user is cut, a is kept?
    // Actually: a3(i=2) rounds=1, user(i=1) rounds=2 > 1 → cutIndex=2
    // Result: [system, a(hello)]
    const nonSystem = result.filter((m) => m.role !== 'system');
    expect(nonSystem.length).toBeGreaterThanOrEqual(1);
  });

  it('should not cut in the middle of tool messages', () => {
    const msgs = [
      system('s'),
      user('1'),
      assistant('a1'),
      user('2'),
      assistant('a2', [
        { id: 'tc2', type: 'function', function: { name: 'bash', arguments: '{}' } },
      ]),
      toolMsg('tc2', 'result2'),
      user('3'),
      assistant('a3'),
    ];
    const result = trimContext(msgs, { maxRounds: 3 });
    const nonSystem = result.filter((m) => m.role !== 'system');
    // Should not have a bare tool message without its assistant
    const toolIdx = nonSystem.findIndex((m) => m.role === 'tool');
    if (toolIdx >= 0) {
      expect(nonSystem[toolIdx - 1]?.role).toBe('assistant');
    }
  });

  it('should handle maxRounds of 0 by returning original', () => {
    const msgs = [user('a'), assistant('b')];
    const result = trimContext(msgs, { maxRounds: 0 });
    expect(result).toBe(msgs);
  });
});

describe('prepareContext', () => {
  it('keeps complete latest task unit and compresses older units', async () => {
    const msgs = [
      system('s'),
      user('old task ' + 'x'.repeat(180)),
      assistant('old result ' + 'y'.repeat(180)),
      user('current task'),
      assistant('planning'),
      toolMsg('tc', 'current tool result'),
    ];
    const summarize = vi.fn(async () => 'old decision: pass; file: src/a.ts');

    const result = await prepareContext(msgs, { maxTokens: 60, summarize });

    expect(summarize).toHaveBeenCalledOnce();
    expect(result[0]).toEqual(system('s'));
    expect(result.some((message) => message.content?.includes('old decision'))).toBe(true);
    const summaryMessage = result.find((message) => message.content?.includes('old decision'));
    expect(summaryMessage?.role).toBe('user');
    expect(summaryMessage?.content).toMatch(/^\[压缩后的历史摘要\]\n/);
    expect(result.at(-1)?.role).toBe('tool');
  });

  it('falls back when summarization fails', async () => {
    const msgs = [
      system('s'),
      user('old ' + 'x'.repeat(180)),
      assistant('old result'),
      user('new'),
      assistant('new'),
    ];
    const result = await prepareContext(msgs, {
      maxTokens: 85,
      summarize: async () => {
        throw new Error('summary unavailable');
      },
    });

    expect(result.some((message) => message.content?.includes('[CONTEXT_SUMMARY]'))).toBe(true);
    expect(result.at(-1)?.content).toBe('new');
  });

  it('splits tool results into the same unit as their assistant call', () => {
    const units = splitContextUnits([
      user('task'),
      assistant('call', [
        { id: 'tc', type: 'function', function: { name: 'bash', arguments: '{}' } },
      ]),
      toolMsg('tc', 'result'),
    ]);
    expect(units).toHaveLength(1);
    expect(units[0].map((message) => message.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('provides deterministic fallback summary with tool names', () => {
    const summary = buildFallbackContextSummary([
      assistant('done', [
        { id: 'tc', type: 'function', function: { name: 'wiki_search', arguments: '{}' } },
      ]),
    ]);
    expect(summary).toContain('[CONTEXT_SUMMARY]');
    expect(summary).toContain('wiki_search');
  });
});
