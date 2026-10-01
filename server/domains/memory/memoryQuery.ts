import type { Memory } from './types.js';
import { MEMORY_MINIMUM_QUERY_COVERAGE } from './memoryPolicy.js';

export const MEMORY_TOKENIZER_VERSION = 1;
export const MEMORY_QUERY_TOKEN_LIMIT = 32;

const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:[._/#:-][\p{L}\p{N}]+)*/gu;
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'for',
  'from',
  'how',
  'is',
  'it',
  'of',
  'the',
  'to',
  'your',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  '一下',
  '什么',
  '为什么',
  '之前',
  '以前',
  '可以',
  '告诉',
  '如何',
  '怎么',
  '帮',
  '我',
  '你',
  '吗',
  '呢',
  '的',
  '是',
  '什',
  '么',
  '如',
  '何',
  '怎',
  '为',
  '告',
  '诉',
  '之',
  '前',
  '以',
  '请',
]);

export interface MemoryQueryAnalysis {
  tokens: string[];
  englishTokens: string[];
  cjkBigrams: string[];
  hasSingleCjkCharacter: boolean;
}

export interface MemorySearchDocument {
  id: string;
  contentTokens: string;
  keyTokens: string;
  subjectTokens: string;
}

export interface MemorySearchCandidate extends Memory {
  searchRank: number;
}

/** Normalize text and return bounded English identifiers plus CJK unigrams/bigrams. */
export function tokenizeMemoryText(input: string): string[] {
  const normalized = input.normalize('NFKC').toLocaleLowerCase('en-US');
  const tokens = new Set<string>();
  for (const segment of normalized.match(CJK_PATTERN) ?? []) {
    const chars = Array.from(segment);
    for (const char of chars) {
      if (!STOP_WORDS.has(char)) tokens.add(char);
    }
    for (let index = 0; index < chars.length - 1; index += 1) {
      const bigram = chars[index] + chars[index + 1];
      if (!STOP_WORDS.has(bigram)) tokens.add(bigram);
    }
  }
  for (const word of normalized.match(WORD_PATTERN) ?? []) {
    if (!containsCjk(word) && !STOP_WORDS.has(word)) tokens.add(word);
  }
  return [...tokens].slice(0, MEMORY_QUERY_TOKEN_LIMIT);
}

/** Analyze a query and prepare an escaped, parameter-safe FTS5 OR expression. */
export function analyzeMemoryQuery(input: string): MemoryQueryAnalysis {
  const normalized = input.normalize('NFKC').toLocaleLowerCase('en-US');
  const tokens = tokenizeMemoryText(normalized);
  const cjkSegments = normalized.match(CJK_PATTERN) ?? [];
  const cjkBigrams = new Set<string>();
  for (const segment of cjkSegments) {
    const chars = Array.from(segment);
    for (let index = 0; index < chars.length - 1; index += 1) {
      const bigram = chars[index] + chars[index + 1];
      if (!STOP_WORDS.has(bigram)) cjkBigrams.add(bigram);
    }
  }
  return {
    tokens,
    englishTokens: tokens.filter((token) => !containsCjk(token) && /[a-z0-9]/i.test(token)),
    cjkBigrams: [...cjkBigrams],
    hasSingleCjkCharacter: cjkSegments.some((segment) => Array.from(segment).length === 1),
  };
}

/** Convert analyzed terms to quoted FTS syntax, escaping embedded double quotes. */
export function buildMemoryFtsExpression(tokens: string[]): string {
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ');
}

/** Filter by lexical overlap, enforce minimum coverage, and order candidates deterministically. */
export function rankMemoryCandidates(
  query: MemoryQueryAnalysis,
  candidates: MemorySearchCandidate[],
): MemorySearchCandidate[] {
  if (query.tokens.length === 0) return [];
  return candidates
    .filter((candidate) => isRelevantCandidate(query, candidate))
    .sort(
      (left, right) =>
        left.searchRank - right.searchRank ||
        right.importance - left.importance ||
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.id.localeCompare(right.id),
    );
}

function isRelevantCandidate(query: MemoryQueryAnalysis, candidate: Memory): boolean {
  const candidateTokens = new Set(
    tokenizeMemoryText(`${candidate.content} ${candidate.memoryKey} ${candidate.subject}`),
  );
  const matched = query.tokens.filter((token) => candidateTokens.has(token));
  const coverage = matched.length / query.tokens.length;
  if (coverage < MEMORY_MINIMUM_QUERY_COVERAGE) return false;
  if (
    query.englishTokens.length > 0 &&
    !query.englishTokens.some((token) => candidateTokens.has(token))
  ) {
    return false;
  }
  if (
    query.cjkBigrams.length > 0 &&
    !query.cjkBigrams.some((token) => candidateTokens.has(token))
  ) {
    return false;
  }
  if (
    query.cjkBigrams.length === 0 &&
    query.hasSingleCjkCharacter &&
    !matched.some((token) => containsCjk(token))
  ) {
    return false;
  }
  return true;
}

function containsCjk(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);
}

/** Build the term projection shared by FTS writes and index rebuilds. */
export function toMemorySearchDocument(memory: Memory): MemorySearchDocument {
  return {
    id: memory.id,
    contentTokens: tokenizeMemoryText(memory.content || '').join(' '),
    keyTokens: tokenizeMemoryText(memory.memoryKey || '').join(' '),
    subjectTokens: tokenizeMemoryText(memory.subject || '').join(' '),
  };
}
