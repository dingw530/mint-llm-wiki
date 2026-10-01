import { createMemorySemanticClassifier } from '../infrastructure/ai/memorySemanticClassifier.js';
import * as memoryJobRepository from '../infrastructure/persistence/memoryJobRepository.js';
import * as memoryScopeRepository from '../infrastructure/persistence/memoryScopeRepository.js';
import * as settingsService from '../services/api/settingsService.js';
import { memoryExtractionClient } from '../infrastructure/ai/memoryExtractionClient.js';
import {
  createMemoryJobService,
  evaluateMemoryGate as evaluateDomainMemoryGate,
  performExtractionWithClient,
} from '../domains/memory/index.js';
import * as memoryDomain from '../domains/memory/index.js';
import type { MemoryExtractionMessage } from '../domains/memory/index.js';
import { createJevMemoryGateProvider } from '../infrastructure/ai/jevMemoryGateProvider.js';
import type { MemoryGateConfig, MemoryGateInput } from '../domains/memory/index.js';
import type { AiSettings } from '../types.js';

/** Compose Memory with persistence, settings, transcript and model adapters. Importing this module does not start work. */
const semanticClassifier = createMemorySemanticClassifier({
  getAiSettings: () => settingsService.getAiSettings(),
  getJevSettings: () => settingsService.getJevSettings(),
  extractionClient: memoryExtractionClient,
});
const memoryJobService = createMemoryJobService({
  jobs: memoryJobRepository,
  getTranscript: memoryScopeRepository.findTranscriptForJob,
  getAiSettings: settingsService.getAiSettings,
  extractionClient: memoryExtractionClient,
  semanticClassifier,
});
const jevMemoryGateProvider = createJevMemoryGateProvider();

export const { enqueueMemoryProcessing, startMemoryProcessing, stopMemoryProcessing } =
  memoryJobService;
export const { trackMemoryGate } = memoryJobService;

/** Initialize the versioned local index without blocking server startup on FTS degradation. */
export function initializeMemorySearchIndex(): boolean {
  try {
    memoryDomain.initializeMemorySearchIndex();
    return true;
  } catch {
    console.warn('[memory] search index initialization failed; retrieval is disabled');
    return false;
  }
}

/** Run the configured Jev gate with the domain-owned legacy fallback. */
export function evaluateMemoryGate(input: MemoryGateInput, config: MemoryGateConfig) {
  return evaluateDomainMemoryGate(input, config, [jevMemoryGateProvider]);
}

/** Bind the configured AI adapter for the temporary Electron/API compatibility surface. */
export function performMemoryExtraction(
  settings: AiSettings,
  messages: MemoryExtractionMessage[],
  conversationId: string,
  jobId: string | null = null,
): Promise<boolean> {
  return performExtractionWithClient(
    settings,
    messages,
    conversationId,
    memoryExtractionClient,
    jobId,
    undefined,
    undefined,
    createMemorySemanticClassifier({
      getAiSettings: () => settings,
      getJevSettings: () => settingsService.getJevSettings(),
      extractionClient: memoryExtractionClient,
    }),
  );
}

/** Preserve the Electron bundle's service namespace while using the Memory domain API. */
export const memoryService = Object.freeze({
  ...memoryDomain,
  performExtraction: performMemoryExtraction,
});
