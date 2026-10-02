export type {
  CreateMemoryParams,
  Memory,
  MemoryCoreCandidate,
  MemoryContextPolicy,
  MemoryExtractionMessage,
  MemoryEventInput,
  MemoryEventRecord,
  MemoryJob,
  MemoryJobRow,
  MemoryListFilters,
  MemoryOperation,
  MemoryOperationAction,
  MemoryPolicySource,
  MemoryMessageScope,
  MemoryScopeSnapshot,
  MemorySpace,
  MemoryScopeKind,
  MemoryStatus,
  MemoryType,
  UpdateMemoryParams,
} from './types.js';
export { createMemorySpaceService } from './memory-space-service.js';
export {
  analyzeMemoryQuery,
  buildMemoryFtsExpression,
  MEMORY_QUERY_TOKEN_LIMIT,
  MEMORY_TOKENIZER_VERSION,
  rankMemoryCandidates,
  tokenizeMemoryText,
  toMemorySearchDocument,
} from './memory-query.js';
export type {
  MemoryQueryAnalysis,
  MemorySearchCandidate,
  MemorySearchDocument,
} from './memory-query.js';
export { packMemoryContext } from './memory-context-packing.js';
export type {
  MemoryContextObservation,
  MemoryContextPackingResult,
  MemoryPackingBudget,
  MemorySkipReason,
} from './memory-context-packing.js';
export { createMemoryJobService } from './memory-job-service.js';
export {
  DEFAULT_MEMORY_GATE_PROVIDERS,
  evaluateMemoryGate,
  createLegacyMemoryGateProvider,
  describeLegacySkipReason,
  isConversationValuable,
} from './gates/index.js';
export {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  MEMORY_CONTEXT_PREFIX,
  MEMORY_CONTEXT_SUFFIX,
} from './memory-policy.js';
export {
  applyMemoryOperations,
  buildMemoryContext,
  createMemory,
  deleteMemory,
  extractMemoriesFromResponse,
  initializeMemorySearchIndex,
  extractMemoryOperations,
  listMemories,
  listManagedMemories,
  recordMemoryGateOutcome,
  recordMemoryProcessingFailure,
  performExtractionWithClient,
  prepareMemoryContext,
  updateMemory,
} from './memory-service.js';
export type { MemoryExtractionClient } from './ports.js';
export type {
  JevFailureReason,
  JevMemoryGateSettings,
  MemoryGateAttempt,
  MemoryGateConfig,
  MemoryGateHint,
  MemoryGateInput,
  MemoryGateOutcome,
  MemoryGateProvider,
  MemoryGateResolution,
  MemoryGateSkipReason,
} from './gates/index.js';

export type {
  MemorySemanticClassifier,
  MemorySemanticInput,
  MemorySemanticDecision,
  MemorySemanticKind,
} from './memory-semantic-policy.js';
