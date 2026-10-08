import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  streamChat: vi.fn(),
  reactChat: vi.fn(),
  getToolDefinitions: vi.fn(),
  enqueueMemoryProcessing: vi.fn(),
  trackMemoryGate: vi.fn(() => Promise.resolve()),
  evaluateMemoryGate: vi.fn(async () => ({
    memorize: false,
    providerId: 'legacy',
    attempts: [],
  })),
}));

vi.mock('../../../application/conversations/ai-proxy.js', () => ({
  streamChat: mocks.streamChat,
}));
vi.mock('../../../bootstrap/agent-runtime.js', () => ({
  runAgentChat: mocks.reactChat,
  getToolDefinitions: mocks.getToolDefinitions,
}));
vi.mock('../../../bootstrap/memory.js', () => ({
  enqueueMemoryProcessing: mocks.enqueueMemoryProcessing,
  evaluateMemoryGate: mocks.evaluateMemoryGate,
  trackMemoryGate: mocks.trackMemoryGate,
}));

import { getDb } from '../../../db.js';
import * as memoryService from '../index.js';
import * as memoryScopeRepository from '../../../infrastructure/persistence/memory-scope-repository.js';
import * as memoryRepository from '../../../infrastructure/persistence/memory-repository.js';
import * as settingsRepository from '../../../infrastructure/config/settings-repository.js';
import * as conversationRepository from '../../../infrastructure/persistence/conversation-repository.js';
import { agentRunRegistry } from '../../../agent-runtime/agent-run.js';
import type { AiSettings, HistoryMessage, StreamResult } from '../../../types.js';
import type { Sink } from '../../../agent-runtime/output-sink.js';
import { sendMessage } from '../../../application/conversations/message-service.js';
import { prepareContext } from '../../../agent-runtime/context-window.js';

const conversationIds = ['memory-entry-stream', 'memory-entry-react'];
const disabledConversationId = 'memory-entry-disabled';
const memoryIds = [
  'memory-entry-global-core',
  'memory-entry-space-a',
  'memory-entry-space-b',
  'memory-entry-unassigned',
];
const spaceAId = 'memory-entry-space-a-id';
const spaceBId = 'memory-entry-space-b-id';

function result(): StreamResult {
  return { content: 'The project uses TypeScript.', reasoning: '', toolCalls: null };
}

function createSink(): Sink {
  return {
    write: vi.fn(),
    end: vi.fn(),
    writableEnded: false,
    headersSent: false,
  };
}

function memoryBlock(messages: HistoryMessage[]): string {
  const blocks = messages.filter(
    (message) => message.role === 'user' && message.content.includes('<user_memory>'),
  );
  expect(blocks).toHaveLength(1);
  return blocks[0].content;
}

describe('memory request entry integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentRunRegistry.clear();
    settingsRepository.upsertAll({
      memoryEnabled: 'true',
      apiUrl: '',
      apiKey: '',
      modelId: 'memory-entry-fixture',
      routingMode: 'manual',
      reactMaxIterations: '2',
      toolMaxRetries: '0',
      showReactSteps: 'false',
    });
    getDb()
      .prepare('INSERT INTO memory_spaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(spaceAId, 'Entry space A', new Date().toISOString(), new Date().toISOString());
    getDb()
      .prepare('INSERT INTO memory_spaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(spaceBId, 'Entry space B', new Date().toISOString(), new Date().toISOString());
    getDb().prepare('DELETE FROM conversations WHERE id = ?').run(disabledConversationId);
    for (const id of conversationIds) {
      conversationRepository.create({ id, title: id, routingMode: 'manual' });
    }
    memoryService.createMemory({
      id: memoryIds[0],
      content: 'The user prefers concise and structured answers',
      category: 'preference',
      memoryKey: 'preference.response_style',
      contextPolicy: 'core',
    });
    memoryService.createMemory({
      id: memoryIds[1],
      content: 'Project alpha uses TypeScript and SQLite',
      category: 'project',
      memoryKey: 'project.alpha.stack',
      scopeKind: 'space',
      spaceId: spaceAId,
    });
    memoryService.createMemory({
      id: memoryIds[2],
      content: 'Project beta uses Python and Redis',
      category: 'project',
      memoryKey: 'project.beta.stack',
      scopeKind: 'space',
      spaceId: spaceBId,
    });
    memoryRepository.create({
      id: memoryIds[3],
      content: 'Legacy memory must never be recalled',
      memoryKey: 'legacy.unassigned',
      scopeKind: 'unassigned',
    });
    for (const id of [...conversationIds, disabledConversationId]) {
      memoryScopeRepository.bindConversation(id, spaceAId);
    }
    mocks.getToolDefinitions.mockImplementation(async (agent: string) =>
      agent === 'react-fixture'
        ? [
            {
              type: 'function',
              function: { name: 'fixture', description: 'fixture', parameters: {} },
            },
          ]
        : [],
    );
    mocks.streamChat.mockImplementation(
      async (messages: HistoryMessage[], aiSettings: AiSettings, sink: Sink) => {
        if (aiSettings.memoryEnabled) {
          memoryBlock(messages);
        } else {
          expect(messages.some((message) => message.content.includes('<user_memory>'))).toBe(false);
        }
        sink.write('stream-finished');
        sink.end();
        return result();
      },
    );
    mocks.reactChat.mockImplementation(
      async (messages: HistoryMessage[], _settings: unknown, sink: Sink) => {
        memoryBlock(messages);
        sink.end();
        return result();
      },
    );
  });

  afterEach(() => {
    agentRunRegistry.clear();
    getDb()
      .prepare(
        `DELETE FROM memory_search_documents_fts WHERE memory_id IN (${memoryIds.map(() => '?').join(', ')})`,
      )
      .run(...memoryIds);
    getDb()
      .prepare(`DELETE FROM memories WHERE id IN (${memoryIds.map(() => '?').join(', ')})`)
      .run(...memoryIds);
    for (const id of [...conversationIds, disabledConversationId]) {
      getDb().prepare('DELETE FROM memory_events WHERE conversation_id = ?').run(id);
      getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id);
    }
    getDb().prepare('DELETE FROM memory_spaces WHERE id IN (?, ?)').run(spaceAId, spaceBId);
  });

  it('uses one immutable scope-aware memory block in ordinary and ReAct requests', async () => {
    const streamSink = createSink();
    const reactSink = createSink();
    await sendMessage(conversationIds[0], 'alpha TypeScript SQLite', streamSink, 'general');
    await sendMessage(conversationIds[1], 'alpha TypeScript SQLite', reactSink, 'react-fixture');

    const streamBlock = memoryBlock(mocks.streamChat.mock.calls[0][0] as HistoryMessage[]);
    const reactBlock = memoryBlock(mocks.reactChat.mock.calls[0][0] as HistoryMessage[]);
    for (const block of [streamBlock, reactBlock]) {
      expect(block).toContain('The user prefers concise');
      expect(block).toContain('Project alpha uses TypeScript');
      expect(block).not.toContain('Project beta');
      expect(block).not.toContain('Legacy memory');
    }
    expect(streamSink.write).toHaveBeenCalledWith('stream-finished');
    expect(reactSink.end).toHaveBeenCalled();

    const reactMessages = mocks.reactChat.mock.calls[0][0] as HistoryMessage[];
    const latestMessage = reactMessages[reactMessages.length - 1];
    const expandedHistory = [
      ...reactMessages.slice(0, -1),
      ...Array.from({ length: 8 }, (_, index) => [
        { role: 'user' as const, content: `Older request ${index} ${'history '.repeat(90)}` },
        { role: 'assistant' as const, content: `Older answer ${index} ${'result '.repeat(90)}` },
      ]).flat(),
      latestMessage,
    ];
    const compacted = await prepareContext(expandedHistory, {
      maxTokens: 350,
      summarize: async (olderMessages) => olderMessages.map(({ content }) => content).join('\n'),
    });
    const compactedText = compacted.map(({ content }) => content || '').join('\n');
    expect(compactedText.match(/<user_memory>/g)).toHaveLength(1);

    for (const conversationId of conversationIds) {
      expect(
        getDb()
          .prepare(
            `SELECT count(*) AS count FROM memory_message_scopes
             WHERE conversation_id = ? AND scope_kind = 'space' AND space_id = ? AND binding_revision = 2`,
          )
          .get(conversationId, spaceAId),
      ).toEqual({ count: 2 });
    }
    expect(memoryRepository.findById(memoryIds[0])?.accessCount).toBe(2);
    expect(memoryRepository.findById(memoryIds[1])?.accessCount).toBe(2);
    expect(memoryRepository.findById(memoryIds[2])?.accessCount).toBe(0);
    expect(memoryRepository.findById(memoryIds[3])?.accessCount).toBe(0);
  });

  it('does no memory read, snapshot, gate, or enqueue when memory is disabled', async () => {
    conversationRepository.create({
      id: disabledConversationId,
      title: disabledConversationId,
      routingMode: 'manual',
    });
    settingsRepository.upsertAll({ memoryEnabled: 'false' });
    mocks.streamChat.mockClear();
    mocks.trackMemoryGate.mockClear();

    await sendMessage(disabledConversationId, 'alpha TypeScript SQLite', createSink(), 'general');

    expect(
      mocks.streamChat.mock.calls[0][0].some((message: HistoryMessage) =>
        message.content.includes('<user_memory>'),
      ),
    ).toBe(false);
    expect(mocks.trackMemoryGate).not.toHaveBeenCalled();
    expect(mocks.enqueueMemoryProcessing).not.toHaveBeenCalled();
    expect(
      getDb()
        .prepare('SELECT count(*) AS count FROM memory_message_scopes WHERE conversation_id = ?')
        .get(disabledConversationId),
    ).toEqual({ count: 0 });
    expect(
      getDb()
        .prepare('SELECT count(*) AS count FROM memory_processing_jobs WHERE conversation_id = ?')
        .get(disabledConversationId),
    ).toEqual({ count: 0 });
  });
});
