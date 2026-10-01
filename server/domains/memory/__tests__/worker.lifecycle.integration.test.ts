import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../../../db.js';
import * as memoryJobRepository from '../../../infrastructure/persistence/memoryJobRepository.js';
import * as memoryScopeRepository from '../../../infrastructure/persistence/memoryScopeRepository.js';
import * as messageRepository from '../../../repositories/messageRepository.js';
import type { AiSettings } from '../../../types.js';
import type { MemoryExtractionMessage } from '../types.js';
import type { MemoryExtractionClient } from '../ports.js';
import { createMemoryJobService } from '../memoryJobService.js';

const conversationId = 'memory-lifecycle-integration-conversation';
const userMessageId = 'memory-lifecycle-integration-user';
const assistantMessageId = 'memory-lifecycle-integration-assistant';

function settings(): AiSettings {
  return {
    apiUrl: 'http://provider.invalid/v1',
    apiKey: 'isolated-test-key',
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
    wikiMaxFileSize: 1024,
    wikiSearchMode: 'keyword',
    embeddingApiUrl: '',
    embeddingModel: '',
    embeddingDimensions: 1,
    vectorStore: 'sqlite',
    chromaUrl: '',
    chromaApiKey: '',
  };
}

function createBlockedExtractionClient(onStarted: () => void): MemoryExtractionClient {
  return {
    complete: (_messages, _settings, _apiUrl, _apiKey, options) =>
      new Promise<string>((_resolve, reject) => {
        onStarted();
        options.signal.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          { once: true },
        );
      }),
  };
}

afterEach(() => {
  try {
    closeDb();
  } catch {
    // A failed connection setup has no handle to close.
  }
  const db = getDb();
  db.prepare('DELETE FROM memory_message_scopes WHERE conversation_id = ?').run(conversationId);
  db.prepare('DELETE FROM memory_events WHERE conversation_id = ?').run(conversationId);
  db.prepare('DELETE FROM memory_processing_jobs WHERE conversation_id = ?').run(conversationId);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
  closeDb();
});

describe('memory worker lifecycle integration', () => {
  it('aborts in-flight extraction, drains before SQLite close, and does not write after close', async () => {
    const db = getDb();
    db.prepare('INSERT INTO conversations (id) VALUES (?)').run(conversationId);
    const scope = memoryScopeRepository.findConversationScope(conversationId)!;
    const createdAt = new Date().toISOString();
    const messages: MemoryExtractionMessage[] = [
      {
        id: userMessageId,
        role: 'user',
        content: 'I prefer concise answers',
        createdAt,
      },
      {
        id: assistantMessageId,
        role: 'assistant',
        content: 'Understood',
        createdAt: new Date(Date.now() + 1).toISOString(),
      },
    ];
    messageRepository.createWithMemoryScope(
      {
        id: userMessageId,
        conversationId,
        role: 'user',
        content: messages[0].content,
        createdAt: messages[0].createdAt,
      },
      scope,
    );
    messageRepository.createWithMemoryScope(
      {
        id: assistantMessageId,
        conversationId,
        role: 'assistant',
        content: messages[1].content,
        createdAt: messages[1].createdAt,
      },
      scope,
    );

    let signalExtractionStarted: (() => void) | undefined;
    const extractionStarted = new Promise<void>((resolve) => {
      signalExtractionStarted = resolve;
    });
    const extractionClient = createBlockedExtractionClient(() => signalExtractionStarted?.());
    let extractionCalls = 0;
    const instrumentedClient: MemoryExtractionClient = {
      complete: (...args) => {
        extractionCalls += 1;
        return extractionClient.complete(...args);
      },
    };
    const service = createMemoryJobService({
      jobs: memoryJobRepository,
      getTranscript: memoryScopeRepository.findTranscriptForJob,
      getAiSettings: settings,
      extractionClient: instrumentedClient,
    });
    service.startMemoryProcessing();
    service.enqueueMemoryProcessing(conversationId, assistantMessageId, scope);
    await extractionStarted;

    await service.stopMemoryProcessing();
    const job = db
      .prepare(
        'SELECT id, status, updated_at FROM memory_processing_jobs WHERE conversation_id = ?',
      )
      .get(conversationId) as { id: string; status: string; updated_at: string };
    expect(job.status).toBe('pending');
    expect(extractionCalls).toBe(1);

    const databasePath = process.env.AI_CHAT_DB_PATH;
    if (!databasePath) throw new Error('AI_CHAT_DB_PATH is required for lifecycle assertions');
    closeDb();
    const observer = new Database(databasePath, { readonly: true, fileMustExist: true });
    const before = observer
      .prepare(
        'SELECT id, status, updated_at FROM memory_processing_jobs WHERE conversation_id = ?',
      )
      .get(conversationId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = observer
      .prepare(
        'SELECT id, status, updated_at FROM memory_processing_jobs WHERE conversation_id = ?',
      )
      .get(conversationId);
    observer.close();
    expect(after).toEqual(before);

    const restartedDb = getDb();
    const existing = memoryJobRepository.enqueue(conversationId, assistantMessageId, scope);
    expect(existing.id).toBe(job.id);
    expect(
      restartedDb
        .prepare('SELECT count(*) AS count FROM memory_processing_jobs WHERE conversation_id = ?')
        .get(conversationId),
    ).toEqual({ count: 1 });
    await service.stopMemoryProcessing();
  });
});
