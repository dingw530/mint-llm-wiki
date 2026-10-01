import { estimateTokens } from '../../services/utils/tokenEstimator.js';
import {
  AUTO_CORE_MEMORY_KEYS,
  DEFAULT_MEMORY_CORE_TOKEN_BUDGET,
  DEFAULT_MEMORY_TOKEN_BUDGET,
  CATEGORY_LABELS,
  MEMORY_CONTEXT_PREFIX,
  MEMORY_CONTEXT_SUFFIX,
} from './memoryPolicy.js';
import type { Memory, MemoryScopeSnapshot } from './types.js';

export type MemorySkipReason =
  | 'core_budget'
  | 'total_budget'
  | 'duplicate'
  | 'scope_override'
  | 'retrieval_filtered'
  | 'fts_unavailable'
  | 'invalid_query'
  | 'unassigned_scope'
  | 'core_read_failed'
  | 'access_update_failed';

export interface MemoryPackingBudget {
  totalTokens?: number;
  coreTokens?: number;
  inputBudget?: number;
  remainingInputTokens?: number;
}

export interface MemoryContextObservation {
  totalBudget: number;
  coreBudget: number;
  estimatedTokens: number;
  coreCandidateCount: number;
  retrievalCandidateCount: number;
  selectedCoreIds: string[];
  selectedRetrievalIds: string[];
  skipped: Partial<Record<MemorySkipReason, number>>;
}

export interface MemoryContextPackingResult {
  text: string;
  observation: MemoryContextObservation;
}

/** Pack whole facts in deterministic order while respecting overall and core token budgets. */
export function packMemoryContext(
  coreCandidates: Memory[],
  retrievalCandidates: Memory[],
  scope: MemoryScopeSnapshot,
  budget: MemoryPackingBudget = {},
): MemoryContextPackingResult {
  const totalBudget = resolveTotalBudget(budget);
  const coreBudget = Math.min(
    totalBudget,
    resolveIntegerBudget(budget.coreTokens, DEFAULT_MEMORY_CORE_TOKEN_BUDGET),
  );
  const skipped: MemoryContextObservation['skipped'] = {};
  const overrides = collectSpaceOverrides(scope, [...coreCandidates, ...retrievalCandidates]);
  const core = orderCoreCandidates(coreCandidates).filter((memory) => {
    if (isSuppressedBySpaceOverride(memory, scope, overrides)) {
      incrementSkip(skipped, 'scope_override');
      return false;
    }
    return true;
  });
  const retrieval = retrievalCandidates.filter((memory) => {
    if (isSuppressedBySpaceOverride(memory, scope, overrides)) {
      incrementSkip(skipped, 'scope_override');
      return false;
    }
    return true;
  });
  const selectedCore: Memory[] = [];
  const selectedRetrieval: Memory[] = [];
  const selectedIds = new Set<string>();
  const innerLines: string[] = [];

  for (const memory of core) {
    if (selectedIds.has(memory.id)) {
      incrementSkip(skipped, 'duplicate');
      continue;
    }
    const line = formatMemoryFact(memory);
    if (estimateEnvelopeTokens([...innerLines, line]) > coreBudget) {
      incrementSkip(skipped, 'core_budget');
      continue;
    }
    selectedIds.add(memory.id);
    selectedCore.push(memory);
    innerLines.push(line);
  }

  for (const memory of retrieval) {
    if (selectedIds.has(memory.id)) {
      incrementSkip(skipped, 'duplicate');
      continue;
    }
    const line = formatMemoryFact(memory);
    if (estimateEnvelopeTokens([...innerLines, line]) > totalBudget) {
      incrementSkip(skipped, 'total_budget');
      continue;
    }
    selectedIds.add(memory.id);
    selectedRetrieval.push(memory);
    innerLines.push(line);
  }

  const text = innerLines.join('\n');
  return {
    text,
    observation: {
      totalBudget,
      coreBudget,
      estimatedTokens: estimateEnvelopeTokens(innerLines),
      coreCandidateCount: coreCandidates.length,
      retrievalCandidateCount: retrievalCandidates.length,
      selectedCoreIds: selectedCore.map(({ id }) => id),
      selectedRetrievalIds: selectedRetrieval.map(({ id }) => id),
      skipped,
    },
  };
}

function resolveTotalBudget(budget: MemoryPackingBudget): number {
  const totalTokens = resolveIntegerBudget(budget.totalTokens, DEFAULT_MEMORY_TOKEN_BUDGET);
  const inputBudget = resolveIntegerBudget(budget.inputBudget, totalTokens * 10);
  const remainingInputTokens = resolveIntegerBudget(budget.remainingInputTokens, totalTokens);
  return Math.min(totalTokens, Math.floor(inputBudget * 0.1), remainingInputTokens);
}

function resolveIntegerBudget(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Memory token budgets must be non-negative integers');
  }
  return value;
}

function estimateEnvelopeTokens(lines: string[]): number {
  if (lines.length === 0) return 0;
  const content = `${MEMORY_CONTEXT_PREFIX}\n${lines.join('\n')}\n${MEMORY_CONTEXT_SUFFIX}`;
  return estimateTokens(content);
}

function formatMemoryFact(memory: Memory): string {
  const date = (memory.sourceCreatedAt || memory.createdAt || '').slice(0, 10);
  const category = escapeXml(CATEGORY_LABELS[memory.category] || memory.category || 'general');
  const subject =
    memory.subject && memory.subject !== 'user' ? `（主体：${escapeXml(memory.subject)}）` : '';
  return `- [${date}] [${category}] ${escapeXml(memory.content)}${subject}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function orderCoreCandidates(memories: Memory[]): Memory[] {
  return [...memories].sort(
    (left, right) =>
      right.importance - left.importance ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.id.localeCompare(right.id),
  );
}

function collectSpaceOverrides(scope: MemoryScopeSnapshot, memories: Memory[]): Set<string> {
  if (scope.scopeKind !== 'space' || !scope.spaceId) return new Set();
  return new Set(
    memories
      .filter(
        (memory) =>
          memory.scopeKind === 'space' &&
          memory.spaceId === scope.spaceId &&
          (memory.policySource === 'user' || memory.contextPolicy === 'core') &&
          AUTO_CORE_MEMORY_KEYS.has(memory.memoryKey),
      )
      .map((memory) => memory.memoryKey),
  );
}

function isSuppressedBySpaceOverride(
  memory: Memory,
  scope: MemoryScopeSnapshot,
  overrides: Set<string>,
): boolean {
  return (
    scope.scopeKind === 'space' &&
    memory.scopeKind === 'global' &&
    AUTO_CORE_MEMORY_KEYS.has(memory.memoryKey) &&
    overrides.has(memory.memoryKey)
  );
}

function incrementSkip(
  skipped: MemoryContextObservation['skipped'],
  reason: MemorySkipReason,
): void {
  skipped[reason] = (skipped[reason] ?? 0) + 1;
}
