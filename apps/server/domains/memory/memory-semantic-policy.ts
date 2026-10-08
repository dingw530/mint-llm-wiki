import type { MemoryExtractionMessage, MemoryOperation } from './types.js';

export type MemorySemanticKind =
  'response_language' | 'response_style' | 'occupation' | 'timezone' | 'other' | 'uncertain';

export interface MemorySemanticInput {
  memoryKey: string;
  subject: string;
  content: string;
  userSourceText: string | null;
}

export interface MemorySemanticDecision {
  kind: MemorySemanticKind;
  confidence: number;
  provider: 'jev' | 'llm' | 'unavailable';
}

export interface MemorySemanticClassifier {
  classify(input: MemorySemanticInput, signal: AbortSignal): Promise<MemorySemanticDecision>;
}

export const MEMORY_SEMANTIC_MIN_CONFIDENCE = 0.8;
const CANONICAL_KEYS = {
  response_language: 'preference.response_language',
  response_style: 'preference.response_style',
  occupation: 'personal.occupation',
  timezone: 'personal.timezone',
} as const;

/** Resolve a semantic decision to a canonical key; abstention must never authorize core. */
export function canonicalMemoryKey(decision: MemorySemanticDecision): string | null {
  if (
    !Number.isFinite(decision.confidence) ||
    decision.confidence < MEMORY_SEMANTIC_MIN_CONFIDENCE ||
    decision.confidence > 1 ||
    decision.provider === 'unavailable' ||
    decision.kind === 'other' ||
    decision.kind === 'uncertain'
  )
    return null;
  return CANONICAL_KEYS[decision.kind] ?? null;
}

/** Classify before key-based matching, retaining original keys on conservative abstention. */
export async function normalizeMemoryOperations(
  operations: MemoryOperation[],
  messages: MemoryExtractionMessage[],
  classifier: MemorySemanticClassifier,
  signal: AbortSignal,
): Promise<MemoryOperation[]> {
  const normalized: MemoryOperation[] = [];
  for (const operation of operations) {
    normalized.push(await normalizeSingleOperation(operation, messages, classifier, signal));
  }
  return normalized;
}

/** Resolve one semantic key without exposing mutable extraction metadata to the provider. */
async function normalizeSingleOperation(
  operation: MemoryOperation,
  messages: MemoryExtractionMessage[],
  classifier: MemorySemanticClassifier,
  signal: AbortSignal,
): Promise<MemoryOperation> {
  signal.throwIfAborted();
  const source = messages.find(
    (message) => message.id === operation.sourceMessageId && message.role === 'user',
  );
  let decision: MemorySemanticDecision;
  try {
    decision = await classifier.classify(
      {
        memoryKey: operation.memoryKey || 'general',
        subject: operation.subject || 'user',
        content: operation.content || (typeof operation.value === 'string' ? operation.value : ''),
        userSourceText: source?.content ?? null,
      },
      signal,
    );
  } catch {
    signal.throwIfAborted();
    decision = { kind: 'uncertain', confidence: 0, provider: 'unavailable' };
  }
  signal.throwIfAborted();
  return {
    ...operation,
    memoryKey: canonicalMemoryKey(decision) ?? operation.memoryKey,
    semanticDecision: { ...decision },
  };
}
