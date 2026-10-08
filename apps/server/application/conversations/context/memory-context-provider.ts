import {
  prepareMemoryContext as defaultPrepareMemoryContext,
  MEMORY_CONTEXT_PREFIX,
  MEMORY_CONTEXT_SUFFIX,
} from '../../../domains/memory/index.js';
import type { MemoryContextPackingResult } from '../../../domains/memory/index.js';
import type { MemoryScopeSnapshot, MemoryPackingBudget } from '../../../domains/memory/index.js';
import type { ContextProvider } from './context-provider.js';
import { createLogger } from '../../../infrastructure/observability/logger.js';

const MEMORY_PROVIDER_ORDER = 200;
const log = createLogger('memory-context');
type MemoryContextBuilder = (
  query: string,
  scope?: MemoryScopeSnapshot,
  budget?: MemoryPackingBudget,
) => string | MemoryContextPackingResult;

/** Create a memory source while allowing unit tests to control memory retrieval. */
export function createMemoryContextProvider(
  buildMemoryContext: MemoryContextBuilder = defaultPrepareMemoryContext,
): ContextProvider {
  return {
    id: 'memory',
    order: MEMORY_PROVIDER_ORDER,
    provide: (input) => {
      const { settings, userContent } = input;
      if (!settings.memoryEnabled) return undefined;
      const hasMemoryMetadata = input.memoryScope !== undefined || input.memoryBudget !== undefined;
      const memoryBudget = {
        ...(input.memoryBudget || {}),
        ...(input.remainingInputTokens === undefined
          ? {}
          : { remainingInputTokens: input.remainingInputTokens }),
      };
      const result = hasMemoryMetadata
        ? buildMemoryContext(userContent, input.memoryScope, memoryBudget)
        : buildMemoryContext(userContent);
      const memoryContext = typeof result === 'string' ? result : result.text;
      if (typeof result !== 'string') logObservation(result);
      if (!memoryContext) return undefined;
      return {
        id: 'memory',
        placement: 'before-latest-user',
        content: [MEMORY_CONTEXT_PREFIX, memoryContext, MEMORY_CONTEXT_SUFFIX].join('\n'),
      };
    },
  };
}

function logObservation(result: MemoryContextPackingResult): void {
  const { observation } = result;
  log.debug('memory context prepared', {
    injectedMemoryBlockCount: result.text ? 1 : 0,
    totalBudget: observation.totalBudget,
    coreBudget: observation.coreBudget,
    estimatedTokens: observation.estimatedTokens,
    coreCandidateCount: observation.coreCandidateCount,
    retrievalCandidateCount: observation.retrievalCandidateCount,
    selectedCoreCount: observation.selectedCoreIds.length,
    selectedRetrievalCount: observation.selectedRetrievalIds.length,
    skipped: observation.skipped,
  });
}
