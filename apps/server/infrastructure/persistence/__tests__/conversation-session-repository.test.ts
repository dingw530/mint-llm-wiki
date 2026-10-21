import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@mint/session';
import { deriveModelHistory } from '@mint/session';
import { projectTrace } from '@mint/session/trace';
import { runMigrations } from '../../../migrations/index.js';
import {
  ConversationSessionRepository,
  ConversationSessionRepositoryError,
} from '../conversation-session-repository.js';

const now = '2026-10-20T00:00:00.000Z';
const conversationId = 'conversation-session-test';

describe('ConversationSessionRepository', () => {
  let database: Database.Database;
  let repository: ConversationSessionRepository;

  beforeEach(() => {
    vi.stubEnv('AI_CHAT_ENCRYPTION_KEY', 'session-repository-test-key');
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(
      [
        "CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));",
        "CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'New Chat');",
        'CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, reasoning TEXT, created_at TEXT NOT NULL, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);',
      ].join(' '),
    );
    const addMigration = database.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)');
    for (let id = 1; id <= 34; id += 1) addMigration.run(id, 'existing');
    database.prepare('INSERT INTO conversations (id) VALUES (?)').run(conversationId);
    runMigrations(database);
    repository = new ConversationSessionRepository(database);
  });

  afterEach(() => {
    database.close();
    vi.unstubAllEnvs();
  });

  it('imports only legacy messages once and stores their full JSON payload', () => {
    const insert = database.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, reasoning, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insert.run('user-1', conversationId, 'user', 'old request', null, '2026-10-19T10:00:00.000Z');
    insert.run(
      'assistant-1',
      conversationId,
      'assistant',
      'old answer',
      'summary',
      '2026-10-19T10:00:01.000Z',
    );

    const first = repository.ensureConversation(conversationId, now);
    const events = repository.readAll(conversationId);
    const second = repository.ensureConversation(conversationId, now);
    const payloadRows = database
      .prepare('SELECT payload_json FROM conversation_session_events ORDER BY seq ASC')
      .all() as Array<{ payload_json: string }>;

    expect(first).toMatchObject({
      historyCompleteness: 'legacy_partial',
      lastSequence: 2,
      ownerFence: 0,
    });
    expect(second.generation).toBe(first.generation);
    expect(events.map((event) => event.eventId)).toEqual([
      'legacy-message:user-1',
      'legacy-message:assistant-1',
    ]);
    expect(deriveModelHistory(events)).toEqual([
      { role: 'user', content: 'old request' },
      { role: 'assistant', content: 'old answer', reasoning: 'summary' },
    ]);
    expect(JSON.parse(payloadRows[0]?.payload_json ?? '{}')).toMatchObject({
      content: 'old request',
    });
    expect(JSON.parse(payloadRows[1]?.payload_json ?? '{}')).toMatchObject({
      messages: [{ content: 'old answer' }],
    });
    expect(
      database.prepare('SELECT count(*) AS count FROM conversation_session_events').get(),
    ).toEqual({ count: 2 });
  });

  it('claims and renews an exclusive lease, then fences an expired owner', () => {
    const first = repository.claimOwner(conversationId, 'process-a', 10_000, now);
    expect(first.ownerFence).toBe(1);
    expect(() => repository.claimOwner(conversationId, 'process-b', 10_000, now)).toThrow(
      ConversationSessionRepositoryError,
    );

    const renewed = repository.renewOwner(first, 10_000, '2026-10-20T00:00:02.000Z');
    expect(renewed.ownerFence).toBe(first.ownerFence);
    const second = repository.claimOwner(
      conversationId,
      'process-b',
      10_000,
      '2026-10-20T00:00:13.000Z',
    );
    expect(second.ownerFence).toBe(2);
    expect(() => repository.renewOwner(renewed, 10_000, '2026-10-20T00:00:14.000Z')).toThrow(
      'lease expired or was fenced',
    );
    expect(repository.releaseOwner(renewed, '2026-10-20T00:00:14.000Z')).toBe(false);
  });

  it('appends a fenced JSON event batch and rejects stale cursors', () => {
    const state = repository.ensureConversation(conversationId, now);
    const lease = repository.claimOwner(conversationId, 'process-a', 10_000, now);
    const events = [userEvent('event-1', 1, 'private request')];

    const updated = repository.appendBatch(
      conversationId,
      state.lastSequence,
      lease.ownerFence,
      events,
      '2026-10-20T00:00:01.000Z',
    );

    expect(updated.lastSequence).toBe(1);
    expect(repository.readAll(conversationId)).toEqual(events);
    expect(() =>
      repository.appendBatch(
        conversationId,
        0,
        lease.ownerFence,
        [userEvent('event-2', 1, 'stale append')],
        '2026-10-20T00:00:02.000Z',
      ),
    ).toThrow('Session event sequence changed before append');
    const stored = database
      .prepare('SELECT payload_json FROM conversation_session_events WHERE event_id = ?')
      .get('event-1') as { payload_json: string };
    expect(JSON.parse(stored.payload_json)).toMatchObject({ content: 'private request' });
  });

  it('folds exact legacy duplicate model tool responses across full reads and pages', () => {
    let state = repository.ensureConversation(conversationId, now);
    const lease = repository.claimOwner(conversationId, 'process-duplicate', 10_000, now);
    const toolCall = {
      id: 'duplicate-call',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"/tmp/a.txt"}' },
    };
    const events: SessionEvent[] = [
      {
        ...eventBase('turn-started', 1),
        type: 'turn_started',
      },
      {
        ...eventBase('model-response-1', 2),
        type: 'model_message',
        round: 1,
        messages: [{ role: 'assistant', content: null, tool_calls: [toolCall] }],
      },
      {
        ...eventBase('model-response-2', 3),
        type: 'model_message',
        round: 1,
        messages: [{ role: 'assistant', content: null, tool_calls: [toolCall] }],
      },
      {
        ...eventBase('tool-dispatch', 4),
        type: 'tool_dispatch_committed',
        round: 1,
        callId: 'duplicate-call',
        toolName: 'read_file',
        argumentsJson: '{"path":"/tmp/a.txt"}',
        retrySafety: 'never',
      },
      {
        ...eventBase('tool-result', 5),
        type: 'tool_result',
        round: 1,
        callId: 'duplicate-call',
        toolName: 'read_file',
        dispatchCommitted: true,
        status: 'success',
        message: { role: 'tool', tool_call_id: 'duplicate-call', content: 'file content' },
      },
    ];

    for (const event of events) {
      state = repository.appendBatch(
        conversationId,
        state.lastSequence,
        lease.ownerFence,
        [event],
        now,
      );
    }

    const allEvents = repository.readAll(conversationId);
    const history = deriveModelHistory(allEvents);
    const modelToolCalls = history.flatMap((message) =>
      message.role === 'assistant' && Array.isArray(message.tool_calls) ? message.tool_calls : [],
    );
    const duplicateTraceEntry = projectTrace(allEvents).entries.find(
      (entry) => entry.id === 'model-response-2',
    );
    const secondPage = repository.readPage(conversationId, 2, 1);
    const duplicateDetail = repository.readEvent(conversationId, 'model-response-2');

    expect(allEvents[2]).toMatchObject({ type: 'model_message', messages: [] });
    expect(modelToolCalls).toHaveLength(1);
    expect(duplicateTraceEntry).toMatchObject({
      label: '重复模型响应（已忽略）',
      synthetic: true,
    });
    expect(secondPage.events[0]).toMatchObject({ type: 'model_message', messages: [] });
    expect(duplicateDetail).toMatchObject({ type: 'model_message', messages: [] });
  });

  it('still rejects a repeated tool id when the model response differs', () => {
    let state = repository.ensureConversation(conversationId, now);
    const lease = repository.claimOwner(conversationId, 'process-conflict', 10_000, now);
    const first = modelToolCallEvent('model-response-1', 1, '/tmp/a.txt');
    const conflict = modelToolCallEvent('model-response-2', 2, '/tmp/b.txt');
    for (const event of [first, conflict]) {
      state = repository.appendBatch(
        conversationId,
        state.lastSequence,
        lease.ownerFence,
        [event],
        now,
      );
    }

    expect(() => repository.readAll(conversationId)).toThrow(
      'Duplicate model tool call in batch: run-test:duplicate-call',
    );
  });

  it('rolls back the full batch and cursor when an event identity conflicts', () => {
    const state = repository.ensureConversation(conversationId, now);
    const lease = repository.claimOwner(conversationId, 'process-a', 10_000, now);
    repository.appendBatch(
      conversationId,
      state.lastSequence,
      lease.ownerFence,
      [userEvent('stable-event', 1, 'first')],
      now,
    );

    expect(() =>
      repository.appendBatch(
        conversationId,
        1,
        lease.ownerFence,
        [userEvent('stable-event', 2, 'duplicate')],
        '2026-10-20T00:00:01.000Z',
      ),
    ).toThrow();
    expect(repository.ensureConversation(conversationId).lastSequence).toBe(1);
    expect(repository.readAll(conversationId)).toHaveLength(1);
  });

  it('rolls back a message row and its session event as one composed transaction', () => {
    const state = repository.ensureConversation(conversationId, now);
    const lease = repository.claimOwner(conversationId, 'process-atomic', 10_000, now);

    expect(() =>
      repository.withTransaction(() => {
        database
          .prepare(
            'INSERT INTO messages (id, conversation_id, role, content, reasoning, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run('message-atomic', conversationId, 'user', 'atomic prompt', null, now);
        repository.appendBatch(
          conversationId,
          state.lastSequence,
          lease.ownerFence,
          [userEvent('atomic-event', 1, 'atomic prompt')],
          '2026-10-20T00:00:01.000Z',
        );
        throw new Error('force composed transaction rollback');
      }),
    ).toThrow('force composed transaction rollback');

    expect(database.prepare('SELECT id FROM messages').all()).toEqual([]);
    expect(repository.ensureConversation(conversationId, now).lastSequence).toBe(0);
    expect(repository.readAll(conversationId)).toEqual([]);
  });

  it('keeps the session tail marked incomplete after an interrupted turn is appended', () => {
    const state = repository.ensureConversation(conversationId, now);
    const lease = repository.claimOwner(conversationId, 'process-a', 10_000, now);
    const event: SessionEvent = {
      schemaVersion: 1,
      conversationId,
      eventId: 'turn-interrupted',
      seq: 1,
      runId: 'run-test',
      turnId: 'turn-test',
      createdAt: '2026-10-20T00:00:01.000Z',
      type: 'turn_interrupted',
      reason: 'process_exit',
    };
    const updated = repository.appendBatch(
      conversationId,
      state.lastSequence,
      lease.ownerFence,
      [event],
      '2026-10-20T00:00:01.000Z',
    );
    expect(updated.tailIncomplete).toBe(true);
  });

  it('pages on one snapshot watermark and returns only events in the conversation', () => {
    const state = repository.ensureConversation(conversationId, now);
    const lease = repository.claimOwner(conversationId, 'process-a', 10_000, now);
    repository.appendBatch(
      conversationId,
      state.lastSequence,
      lease.ownerFence,
      [userEvent('page-1', 1, 'one'), userEvent('page-2', 2, 'two')],
      '2026-10-20T00:00:01.000Z',
    );

    const first = repository.readPage(conversationId, 0, 1);
    const second = repository.readPage(
      conversationId,
      first.nextAfterSequence,
      1,
      first.highWatermark,
    );

    expect(first).toMatchObject({ highWatermark: 2, nextAfterSequence: 1, hasMore: true });
    expect(second).toMatchObject({ highWatermark: 2, nextAfterSequence: 2, hasMore: false });
    expect(first.events[0]?.eventId).toBe('page-1');
    expect(second.events[0]?.eventId).toBe('page-2');
  });

  it('cascades session state and JSON events with the conversation', () => {
    repository.ensureConversation(conversationId, now);
    database.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
    expect(database.prepare('SELECT * FROM conversation_session_state').all()).toEqual([]);
    expect(database.prepare('SELECT * FROM conversation_session_events').all()).toEqual([]);
  });

  it('reads session JSON without requiring the encryption key', () => {
    database
      .prepare(
        'INSERT INTO messages (id, conversation_id, role, content, reasoning, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('user-1', conversationId, 'user', 'private message', null, '2026-10-19T10:00:00.000Z');
    repository.ensureConversation(conversationId, now);
    vi.stubEnv('AI_CHAT_ENCRYPTION_KEY', '');
    expect(repository.readAll(conversationId)).toHaveLength(1);
  });
});

function userEvent(eventId: string, seq: number, content: string): SessionEvent {
  return {
    schemaVersion: 1,
    conversationId,
    eventId,
    seq,
    runId: 'run-test',
    turnId: 'turn-test',
    createdAt: '2026-10-20T00:00:00.000Z',
    type: 'user_message',
    messageId: 'message-' + eventId,
    content,
  };
}

function eventBase(eventId: string, seq: number) {
  return {
    schemaVersion: 1 as const,
    conversationId,
    eventId,
    seq,
    runId: 'run-test',
    turnId: 'turn-test',
    createdAt: now,
  };
}

function modelToolCallEvent(eventId: string, seq: number, path: string): SessionEvent {
  return {
    ...eventBase(eventId, seq),
    type: 'model_message',
    round: 1,
    messages: [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'duplicate-call',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path }) },
          },
        ],
      },
    ],
  };
}
