import { describe, expect, it } from 'vitest';
import {
  analyzeMemoryQuery,
  buildMemoryFtsExpression,
  rankMemoryCandidates,
  tokenizeMemoryText,
} from '../memoryQuery.js';
import type { MemorySearchCandidate } from '../memoryQuery.js';

function candidate(
  id: string,
  content: string,
  searchRank = 0,
  importance = 0.5,
): MemorySearchCandidate {
  return {
    id,
    content,
    category: 'general',
    memoryKey: 'general',
    value: content,
    memoryType: 'semantic',
    subject: 'user',
    relationship: null,
    confidence: 0.9,
    importance,
    validFrom: null,
    validTo: null,
    status: 'active',
    supersedesId: null,
    sourceMessageId: null,
    lastAccessedAt: null,
    accessCount: 0,
    sourceConversationId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    contextPolicy: 'retrievable',
    policySource: 'auto',
    scopeKind: 'global',
    spaceId: null,
    searchRank,
  };
}

describe('memory lexical query', () => {
  it('normalizes Unicode and preserves technical identifiers', () => {
    expect(tokenizeMemoryText('ＡＰＩ React 18 reactMaxIterations')).toEqual([
      'api',
      'react',
      '18',
      'reactmaxiterations',
    ]);
  });

  it('creates Chinese unigrams and adjacent bigrams while removing common question terms', () => {
    const tokens = tokenizeMemoryText('请问如何设置响应语言');
    expect(tokens).toContain('响应');
    expect(tokens).toContain('语言');
    expect(tokens).not.toContain('如何');
    expect(tokens).not.toContain('请');
  });

  it('quotes each FTS term and escapes embedded quotes', () => {
    expect(buildMemoryFtsExpression(['memory', 'say"hello'])).toBe('"memory" OR "say""hello"');
  });

  it('requires lexical overlap and deterministically ranks matching facts', () => {
    const query = analyzeMemoryQuery('TypeScript 项目');
    const results = rankMemoryCandidates(query, [
      candidate('weak', '项目使用 Python'),
      candidate('second', 'TypeScript 项目使用 Vite', 0.3),
      candidate('first', 'Mint 的 TypeScript 项目', 0.1),
    ]);
    expect(results.map(({ id }) => id)).toEqual(['first', 'second']);
  });

  it('accepts a single-character CJK query only when that character matches', () => {
    const query = analyzeMemoryQuery('猫');
    expect(
      rankMemoryCandidates(query, [candidate('match', '养猫'), candidate('miss', '养狗')]),
    ).toHaveLength(1);
    expect(
      rankMemoryCandidates(analyzeMemoryQuery('什么 请'), [candidate('x', '任何事情')]),
    ).toEqual([]);
  });

  it('rejects matches below the minimum query token coverage', () => {
    const query = analyzeMemoryQuery('alpha beta gamma delta epsilon');
    expect(rankMemoryCandidates(query, [candidate('partial', 'alpha')])).toEqual([]);
  });
});
