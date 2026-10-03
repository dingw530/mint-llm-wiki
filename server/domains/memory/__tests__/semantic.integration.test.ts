import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('../../../infrastructure/ai/memory-extraction-client.js', () => ({
  memoryExtractionClient: { complete: transport.complete },
}));

import { getDb } from '../../../db.js';
import * as conversationRepository from '../../../infrastructure/persistence/conversation-repository.js';
import * as messageRepository from '../../../repositories/messageRepository.js';
import * as memoryRepository from '../../../infrastructure/persistence/memory-repository.js';
import * as memoryJobRepository from '../../../infrastructure/persistence/memory-job-repository.js';
import * as memoryScopeRepository from '../../../infrastructure/persistence/memory-scope-repository.js';
import * as settingsService from '../../../services/api/settingsService.js';
import { DISABLED_JEV_SETTINGS } from '../../../services/jev/config.js';
import { createMemorySemanticClassifier } from '../../../infrastructure/ai/memory-semantic-classifier.js';
import { performMemoryExtraction } from '../../../bootstrap/memory.js';
import { createMemoryJobService } from '../memory-job-service.js';
import { performExtractionWithClient, prepareMemoryContext } from '../memory-service.js';
import type { MemoryOperation, MemoryScopeSnapshot } from '../types.js';
import type { MemorySemanticDecision } from '../memory-semantic-policy.js';
import type { MemoryCompletionMessage, MemoryCompletionOptions } from '../ports.js';

const conversationId = 'semantic-integration-conversation';
const userId = 'semantic-integration-user';
const assistantId = 'semantic-integration-assistant';
const spaceId = 'semantic-integration-space';
const scope: MemoryScopeSnapshot = { scopeKind: 'global', spaceId: null, bindingRevision: 0 };
const transcript = [
  {
    id: userId,
    role: 'user',
    content: '请用中文回答，以后改为英文回答。我是程序员，我正在学习中文。',
    createdAt: new Date().toISOString(),
  },
  { id: assistantId, role: 'assistant', content: '好的', createdAt: new Date().toISOString() },
];
const state: { operation: MemoryOperation; decision: MemorySemanticDecision } = {
  operation: { action: 'ADD' },
  decision: { kind: 'response_language', confidence: 0.95, provider: 'llm' },
};

function settings() {
  return {
    ...settingsService.getAiSettings(),
    memoryEnabled: true,
    apiUrl: 'https://provider.invalid',
    apiKey: 'fixture',
  };
}

function classifier() {
  return createMemorySemanticClassifier({
    getAiSettings: settings,
    getJevSettings: () => DISABLED_JEV_SETTINGS,
    extractionClient: { complete: transport.complete },
  });
}

async function extract(overrides: Partial<MemoryOperation> = {}, nextScope = scope) {
  state.operation = {
    action: 'ADD',
    memoryKey: 'user.preferred_language',
    subject: 'user',
    content: '偏好中文回答',
    sourceMessageId: userId,
    confidence: 0.95,
    ...overrides,
  };
  return performExtractionWithClient(
    settings(),
    transcript,
    conversationId,
    { complete: transport.complete },
    null,
    nextScope,
    undefined,
    classifier(),
  );
}

function facts() {
  return memoryRepository.findAll().filter((fact) => fact.sourceConversationId === conversationId);
}

beforeEach(() => {
  conversationRepository.create({ id: conversationId, title: 'semantic fixture' });
  messageRepository.create({
    id: userId,
    conversationId,
    role: 'user',
    content: transcript[0].content,
    createdAt: transcript[0].createdAt,
  });
  messageRepository.create({
    id: assistantId,
    conversationId,
    role: 'assistant',
    content: '好的',
    createdAt: transcript[1].createdAt,
  });
  getDb()
    .prepare('INSERT INTO memory_spaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(spaceId, 'semantic fixture', transcript[0].createdAt, transcript[0].createdAt);
  state.decision = { kind: 'response_language', confidence: 0.95, provider: 'llm' };
  transport.complete.mockReset();
  transport.complete.mockImplementation(async (messages: MemoryCompletionMessage[]) =>
    messages[0].content.includes('Allowed types:')
      ? JSON.stringify(state.decision)
      : JSON.stringify({ operations: [state.operation] }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const fact of facts()) {
    getDb().prepare('DELETE FROM memory_search_documents_fts WHERE memory_id = ?').run(fact.id);
    getDb().prepare('DELETE FROM memories WHERE id = ?').run(fact.id);
  }
  getDb().prepare('DELETE FROM memory_events WHERE conversation_id = ?').run(conversationId);
  getDb()
    .prepare('DELETE FROM memory_processing_jobs WHERE conversation_id = ?')
    .run(conversationId);
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
  getDb().prepare('DELETE FROM memory_spaces WHERE id = ?').run(spaceId);
});

describe('semantic extraction → SQLite → recall integration', () => {
  it('normalizes aliases before duplicate matching, update and deletion, retaining history', async () => {
    expect(await extract()).toBe(true);
    const first = facts()[0];
    expect(first).toMatchObject({
      memoryKey: 'preference.response_language',
      contextPolicy: 'core',
      confidence: 0.95,
    });
    expect(prepareMemoryContext('无关问题', scope).text).toContain('偏好中文回答');
    await extract({ memoryKey: 'communication.language' });
    expect(facts()).toHaveLength(1);
    await extract({ action: 'UPDATE', memoryKey: 'preference.language', content: '偏好英文回答' });
    expect(facts()).toHaveLength(2);
    expect(memoryRepository.findById(first.id)).toMatchObject({ status: 'superseded' });
    expect(memoryRepository.findById(first.id)?.validTo).not.toBeNull();
    const recalled = prepareMemoryContext('无关问题', scope).text;
    expect(recalled).toContain('偏好英文回答');
    expect(recalled).not.toContain('偏好中文回答');
    await extract({ action: 'NOOP', content: '偏好英文回答' });
    expect(facts()).toHaveLength(2);
    await extract({ action: 'DELETE', content: '撤销回答语言偏好' });
    expect(facts().filter((fact) => fact.status === 'active')).toHaveLength(0);
    expect(prepareMemoryContext('回答语言', scope).text).toBe('');
  });

  it.each(['other', 'uncertain'] as const)(
    'keeps canonical-looking keys retrievable when semantic result is %s',
    async (kind) => {
      state.decision.kind = kind;
      await extract({ memoryKey: 'preference.response_language', content: '我正在学习中文' });
      expect(facts()[0].contextPolicy).toBe('retrievable');
      expect(prepareMemoryContext('无关问题', scope).text).toBe('');
      expect(prepareMemoryContext('学习中文', scope).text).toContain('学习中文');
    },
  );

  it.each([
    { sourceMessageId: null },
    { sourceMessageId: assistantId },
    { confidence: 0.4 },
    { subject: 'project.mint' },
    { memoryType: 'episodic' },
  ])('does not bypass original core checks with %j', async (override) => {
    await extract(override);
    expect(facts()[0]).toMatchObject({
      memoryKey: 'preference.response_language',
      contextPolicy: 'retrievable',
    });
  });

  it('does not promote low semantic confidence despite high fact confidence', async () => {
    state.decision.confidence = 0.3;
    await extract();
    expect(facts()[0]).toMatchObject({
      memoryKey: 'user.preferred_language',
      contextPolicy: 'retrievable',
      confidence: 0.95,
    });
  });

  it('normalizes within scope without replacing global facts or changing subject', async () => {
    await extract();
    await extract(
      { action: 'UPDATE', content: '偏好英文回答' },
      { scopeKind: 'space', spaceId, bindingRevision: 1 },
    );
    const global = facts().find((fact) => fact.scopeKind === 'global');
    const local = facts().find((fact) => fact.scopeKind === 'space');
    expect(global).toMatchObject({ status: 'active', contextPolicy: 'core' });
    expect(local).toMatchObject({ status: 'active', contextPolicy: 'retrievable', spaceId });
  });

  it('protects user-managed canonical facts from alias updates and deletions', async () => {
    await extract();
    const fact = facts()[0];
    memoryRepository.update(fact.id, { policySource: 'user' });
    await extract({ action: 'UPDATE', content: '偏好英文回答' });
    await extract({ action: 'DELETE', content: '撤销语言偏好' });
    expect(facts()).toHaveLength(1);
    expect(facts()[0].status).toBe('active');
  });

  it('the compatibility bootstrap entry uses the same semantic classifier', async () => {
    const ai = settings();
    vi.spyOn(settingsService, 'getAiSettings').mockReturnValue(ai);
    vi.spyOn(settingsService, 'getJevSettings').mockReturnValue(DISABLED_JEV_SETTINGS);
    state.operation = {
      action: 'ADD',
      memoryKey: 'language.alias',
      content: '偏好中文回答',
      sourceMessageId: userId,
    };
    expect(await performMemoryExtraction(ai, transcript, conversationId)).toBe(true);
    expect(facts()[0]).toMatchObject({
      memoryKey: 'preference.response_language',
      contextPolicy: 'core',
    });
  });

  it('the worker injects semantic normalization and drains after real queued processing', async () => {
    const snapshot = memoryScopeRepository.findConversationScope(conversationId)!;
    memoryScopeRepository.captureMessageScope(userId, conversationId, snapshot);
    memoryScopeRepository.captureMessageScope(assistantId, conversationId, snapshot);
    state.operation = {
      action: 'ADD',
      memoryKey: 'language.alias',
      content: '偏好中文回答',
      sourceMessageId: userId,
    };
    const worker = createMemoryJobService({
      jobs: memoryJobRepository,
      getTranscript: memoryScopeRepository.findTranscriptForJob,
      getAiSettings: settings,
      extractionClient: { complete: transport.complete },
      semanticClassifier: classifier(),
    });
    try {
      worker.enqueueMemoryProcessing(conversationId, assistantId, snapshot);
      await vi.waitFor(() => expect(facts()).toHaveLength(1));
      expect(facts()[0].memoryKey).toBe('preference.response_language');
    } finally {
      await worker.stopMemoryProcessing();
    }
  });

  it('cancellation during semantic recognition prevents writes and LLM follow-up', async () => {
    const controller = new AbortController();
    state.operation = { action: 'ADD', memoryKey: 'language', content: '偏好中文回答' };
    const classify = vi.fn(async () => {
      controller.abort();
      return state.decision;
    });
    expect(
      await performExtractionWithClient(
        settings(),
        transcript,
        conversationId,
        { complete: transport.complete },
        null,
        scope,
        controller.signal,
        { classify },
      ),
    ).toBe(false);
    expect(facts()).toHaveLength(0);
  });

  it('drains a worker stopped during semantic LLM classification without storing facts', async () => {
    const snapshot = memoryScopeRepository.findConversationScope(conversationId)!;
    memoryScopeRepository.captureMessageScope(userId, conversationId, snapshot);
    memoryScopeRepository.captureMessageScope(assistantId, conversationId, snapshot);
    state.operation = {
      action: 'ADD',
      memoryKey: 'language',
      content: '偏好中文回答',
      sourceMessageId: userId,
    };
    let notifyStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    transport.complete.mockImplementation(
      (
        messages: MemoryCompletionMessage[],
        _settings: unknown,
        _url: string,
        _key: string,
        options: MemoryCompletionOptions,
      ) => {
        if (!messages[0].content.includes('Allowed types:'))
          return Promise.resolve(JSON.stringify({ operations: [state.operation] }));
        notifyStarted();
        return new Promise<string>((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      },
    );
    const worker = createMemoryJobService({
      jobs: memoryJobRepository,
      getTranscript: memoryScopeRepository.findTranscriptForJob,
      getAiSettings: settings,
      extractionClient: { complete: transport.complete },
      semanticClassifier: classifier(),
    });
    worker.enqueueMemoryProcessing(conversationId, assistantId, snapshot);
    await started;
    await worker.stopMemoryProcessing();
    worker.enqueueMemoryProcessing(conversationId, assistantId, snapshot);
    expect(facts()).toHaveLength(0);
    expect(transport.complete).toHaveBeenCalledTimes(2);
  });

  it('ignores semantic metadata invented by the extraction model', async () => {
    state.decision.kind = 'other';
    await extract({
      memoryKey: 'preference.response_language',
      semanticDecision: { kind: 'response_language', confidence: 1, provider: 'jev' },
    });
    expect(facts()[0].contextPolicy).toBe('retrievable');
  });
});
