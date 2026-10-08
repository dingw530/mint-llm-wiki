import { AUTO_CORE_MEMORY_KEYS } from './memory-policy.js';
import { tokenizeMemoryText } from './memory-query.js';
import type { MemoryScopeSnapshot, MemoryType } from './types.js';

export interface AutomaticCoreCandidate {
  memoryKey: string;
  subject: string;
  memoryType: MemoryType | string;
  confidence: number;
  scope: MemoryScopeSnapshot;
  content: string;
  userSourceText: string | null;
}

/** Return true only for a whitelisted, explicit, high-confidence user fact. */
export function shouldPromoteToCore(candidate: AutomaticCoreCandidate): boolean {
  if (
    candidate.scope.scopeKind !== 'global' ||
    candidate.memoryKey.length === 0 ||
    !AUTO_CORE_MEMORY_KEYS.has(candidate.memoryKey) ||
    candidate.subject !== 'user' ||
    candidate.memoryType !== 'semantic' ||
    candidate.confidence < 0.8 ||
    !candidate.userSourceText
  ) {
    return false;
  }
  const sourceTokens = new Set(tokenizeMemoryText(candidate.userSourceText));
  return tokenizeMemoryText(candidate.content).some((token) => sourceTokens.has(token));
}
