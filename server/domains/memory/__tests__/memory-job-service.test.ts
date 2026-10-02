import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiSettings } from '../../../types.js';
import type { MemoryExtractionMessage, MemoryJob } from '../types.js';
import type { MemoryExtractionClient } from '../ports.js';
import { createMemoryJobService, type MemoryJobRepositoryPort } from '../memory-job-service.js';

const mocks = vi.hoisted(() => ({
  performExtraction: vi.fn(),
  recordFailure: vi.fn(),
}));

vi.mock('../memory-service.js', () => ({
  performExtractionWithClient: mocks.performExtraction,
  recordMemoryProcessingFailure: mocks.recordFailure,
}));

function createJob(): MemoryJob {
  return {
    id: 'job-1',
    conversationId: 'conversation-1',
    scopeKind: 'global',
    spaceId: null,
    bindingRevision: 1,
    status: 'pending',
    attempts: 1,
    availableAt: new Date(0).toISOString(),
    lockedAt: null,
    requestedThroughMessageId: 'assistant-1',
    processedThroughMessageId: null,
    errorMessage: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function createSettings(): AiSettings {
  return {
    apiUrl: 'http://provider.invalid',
    apiKey: 'test-key',
    modelId: 'test-model',
    apiType: 'openai-chat',
    systemPrompt: '',
    thinkingMode: false,
    memoryEnabled: true,
    reactMaxIterations: 0,
    toolMaxRetries: 0,
    showReactSteps: false,
    maxContextRounds: 10,
    wikiPath: '',
    wikiMaxFileSize: 1,
    wikiSearchMode: 'keyword',
    embeddingApiUrl: '',
    embeddingModel: '',
    embeddingDimensions: 1,
    vectorStore: 'sqlite',
    chromaUrl: '',
    chromaApiKey: '',
  };
}

function createWorker(dependencies?: { transcript?: MemoryExtractionMessage[] }) {
  const currentJob = createJob();
  const jobs: MemoryJobRepositoryPort = {
    enqueue: vi.fn(() => currentJob),
    recoverProcessing: vi.fn(() => 0),
    claimNext: vi.fn(() => undefined),
    complete: vi.fn(),
    fail: vi.fn(),
  };
  const extractionClient: MemoryExtractionClient = {
    complete: vi.fn(async () => null),
  };
  const service = createMemoryJobService({
    jobs,
    getTranscript: () => dependencies?.transcript ?? [],
    getAiSettings: createSettings,
    extractionClient,
  });
  return { jobs, extractionClient, service, currentJob };
}

describe('Memory job service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.performExtraction.mockResolvedValue(true);
  });

  it('does not start a queued setImmediate drain after shutdown', async () => {
    const { jobs, service } = createWorker();
    service.startMemoryProcessing();
    service.enqueueMemoryProcessing('conversation-1');

    await service.stopMemoryProcessing();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(jobs.claimNext).not.toHaveBeenCalled();
  });

  it('drains registered memory gates before shutdown and refuses new gate or job work', async () => {
    const { jobs, service } = createWorker();
    let finishGate: (() => void) | undefined;
    const gate = service.trackMemoryGate(
      () =>
        new Promise<void>((resolve) => {
          finishGate = resolve;
        }),
    );
    expect(gate).toBeDefined();
    const stopped = service.stopMemoryProcessing();
    expect(service.trackMemoryGate(async () => undefined)).toBeUndefined();
    service.enqueueMemoryProcessing('conversation-1');
    expect(jobs.enqueue).not.toHaveBeenCalled();
    let settled = false;
    void stopped.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finishGate?.();
    await stopped;
    expect(settled).toBe(true);
  });

  it('waits for an in-flight extraction and completes only the captured message snapshot', async () => {
    const transcript: MemoryExtractionMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'I prefer concise answers',
        createdAt: '2026-09-30T00:00:00.000Z',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Understood',
        createdAt: '2026-09-30T00:00:01.000Z',
      },
      {
        id: 'user-2',
        role: 'user',
        content: 'I use TypeScript',
        createdAt: '2026-09-30T00:00:02.000Z',
      },
    ];
    let finishExtraction: ((value: boolean) => void) | undefined;
    let extractionStarted: (() => void) | undefined;
    mocks.performExtraction.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishExtraction = resolve;
          extractionStarted?.();
        }),
    );
    const { jobs, service, extractionClient, currentJob } = createWorker({ transcript });
    jobs.claimNext = vi.fn().mockReturnValueOnce(currentJob);
    const started = new Promise<void>((resolve) => {
      extractionStarted = resolve;
    });

    service.startMemoryProcessing();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await started;
    const stopped = service.stopMemoryProcessing();
    expect(jobs.complete).not.toHaveBeenCalled();
    finishExtraction?.(true);
    await stopped;

    expect(mocks.performExtraction).toHaveBeenCalledWith(
      createSettings(),
      transcript.slice(0, 2),
      'conversation-1',
      extractionClient,
      'job-1',
      { scopeKind: 'global', spaceId: null, bindingRevision: 1 },
      expect.any(AbortSignal),
      undefined,
    );
    expect(jobs.complete).toHaveBeenCalledWith('job-1', 'assistant-1');
  });
});
