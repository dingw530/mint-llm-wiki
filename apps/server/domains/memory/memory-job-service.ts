import type { AiSettings } from '../../types.js';
import type { MemoryExtractionMessage, MemoryJob, MemoryScopeSnapshot } from './types.js';
import type { MemorySemanticClassifier } from './memory-semantic-policy.js';
import type { MemoryExtractionClient } from './ports.js';
import * as memoryService from './memory-service.js';

export interface MemoryJobRepositoryPort {
  enqueue(
    conversationId: string,
    throughMessageId: string | null,
    snapshot?: MemoryScopeSnapshot,
  ): MemoryJob;
  recoverProcessing(): number;
  claimNext(): MemoryJob | undefined;
  complete(id: string, processedThroughMessageId: string | null): void;
  fail(id: string, errorMessage: string, maxAttempts?: number): void;
}

export interface MemoryJobServiceDependencies {
  jobs: MemoryJobRepositoryPort;
  getTranscript(
    conversationId: string,
    snapshot: MemoryScopeSnapshot,
    throughMessageId: string | null,
  ): MemoryExtractionMessage[];
  getAiSettings(): AiSettings;
  extractionClient: MemoryExtractionClient;
  semanticClassifier?: MemorySemanticClassifier;
}

interface MemoryWorkerState {
  scheduled: boolean;
  running: boolean;
  stopping: boolean;
  abortController: AbortController;
  drainPromise?: Promise<void>;
  scheduledPromise?: Promise<void>;
  activeMemoryGates: Set<Promise<void>>;
}

function createMemoryWorkerState(): MemoryWorkerState {
  return {
    scheduled: false,
    running: false,
    stopping: false,
    abortController: new AbortController(),
    activeMemoryGates: new Set(),
  };
}

/** Create a memory worker with explicit transcript, persistence and extraction dependencies. */
export function createMemoryJobService(dependencies: MemoryJobServiceDependencies) {
  const state = createMemoryWorkerState();

  function enqueueMemoryProcessing(
    conversationId: string,
    throughMessageId: string | null = null,
    snapshot?: MemoryScopeSnapshot,
  ): void {
    if (state.stopping) return;
    dependencies.jobs.enqueue(conversationId, throughMessageId, snapshot);
    scheduleDrain();
  }

  function trackMemoryGate(work: () => Promise<void>): Promise<void> | undefined {
    if (state.stopping) return undefined;
    const gate = Promise.resolve().then(work);
    state.activeMemoryGates.add(gate);
    void gate.finally(() => state.activeMemoryGates.delete(gate)).catch(() => undefined);
    return gate;
  }

  function startMemoryProcessing(): void {
    state.stopping = false;
    if (state.abortController.signal.aborted) state.abortController = new AbortController();
    dependencies.jobs.recoverProcessing();
    scheduleDrain();
  }

  function stopMemoryProcessing(): Promise<void> {
    state.stopping = true;
    state.scheduled = false;
    state.abortController.abort();
    return Promise.all([
      Promise.all([...state.activeMemoryGates]),
      state.drainPromise,
      state.scheduledPromise,
    ]).then(() => undefined);
  }

  function scheduleDrain(): void {
    if (state.stopping || state.scheduled || state.running) return;
    state.scheduled = true;
    state.scheduledPromise = new Promise<void>((resolve) => {
      setImmediate(() => {
        state.scheduled = false;
        state.scheduledPromise = undefined;
        if (state.stopping) {
          resolve();
          return;
        }
        state.drainPromise = drain();
        void state.drainPromise.then(resolve, resolve).finally(() => {
          state.drainPromise = undefined;
        });
      });
    });
  }

  async function drain(): Promise<void> {
    if (state.running) return;
    state.running = true;
    try {
      let job = dependencies.jobs.claimNext();
      while (job && !state.stopping) {
        await processJob(job);
        job = state.stopping ? undefined : dependencies.jobs.claimNext();
      }
    } finally {
      state.running = false;
    }
  }

  async function processJob(job: MemoryJob): Promise<void> {
    try {
      const scope: MemoryScopeSnapshot = {
        scopeKind: job.scopeKind,
        spaceId: job.spaceId,
        bindingRevision: job.bindingRevision,
      };
      const transcript = selectSnapshot(
        dependencies.getTranscript(job.conversationId, scope, job.requestedThroughMessageId),
        job.requestedThroughMessageId,
      );
      if (job.scopeKind === 'unassigned' || !transcript.length) {
        memoryService.recordMemoryProcessingFailure(
          job.conversationId,
          job.id,
          'memory_scope_snapshot_missing',
          scope,
        );
        dependencies.jobs.complete(job.id, job.requestedThroughMessageId);
        return;
      }
      if (hasExtractionRoles(transcript)) {
        const succeeded = await memoryService.performExtractionWithClient(
          dependencies.getAiSettings(),
          transcript,
          job.conversationId,
          dependencies.extractionClient,
          job.id,
          scope,
          state.abortController.signal,
          dependencies.semanticClassifier,
        );
        if (!succeeded) throw new Error('memory_extraction_failed');
      }
      dependencies.jobs.complete(job.id, job.requestedThroughMessageId);
    } catch (error) {
      const errorCode =
        error instanceof Error && error.message === 'memory_extraction_failed'
          ? 'extraction_failed'
          : 'memory_processing_failed';
      memoryService.recordMemoryProcessingFailure(job.conversationId, job.id, errorCode);
      dependencies.jobs.fail(job.id, 'memory_processing_failed');
    }
  }

  return { enqueueMemoryProcessing, startMemoryProcessing, stopMemoryProcessing, trackMemoryGate };
}

function selectSnapshot(
  messages: MemoryExtractionMessage[],
  throughMessageId: string | null,
): MemoryExtractionMessage[] {
  if (!throughMessageId) return messages;
  const snapshotIndex = messages.findIndex((message) => message.id === throughMessageId);
  return snapshotIndex >= 0 ? messages.slice(0, snapshotIndex + 1) : messages;
}

function hasExtractionRoles(messages: MemoryExtractionMessage[]): boolean {
  return (
    messages.some((message) => message.role === 'user') &&
    messages.some((message) => message.role === 'assistant')
  );
}
