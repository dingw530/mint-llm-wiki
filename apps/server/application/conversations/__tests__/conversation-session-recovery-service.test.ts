import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../../migrations/index.js';
import {
  ConversationSessionRepository,
  type ConversationSessionRepositoryError,
} from '../../../infrastructure/persistence/conversation-session-repository.js';
import { repairInterruptedConversation } from '../conversation-session-recovery-service.js';

const now = '2026-10-20T00:00:00.000Z';

describe('repairInterruptedConversation', () => {
  let database: Database.Database;
  let repository: ConversationSessionRepository;

  beforeEach(() => {
    vi.stubEnv('AI_CHAT_ENCRYPTION_KEY', 'conversation-session-recovery-test-key');
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
    database.prepare('INSERT INTO conversations (id) VALUES (?)').run('conversation-1');
    runMigrations(database);
    repository = new ConversationSessionRepository(database);
  });

  afterEach(() => {
    database.close();
    vi.unstubAllEnvs();
  });

  it('repairs an unknown dispatched call without replaying it and is idempotent', () => {
    appendInterruptedToolRun(repository, 'run-1', true, false);
    const invocations = {
      get: vi.fn(() => ({ status: 'succeeded' as const })),
    } as unknown as Parameters<typeof repairInterruptedConversation>[1]['invocations'];

    const first = repairInterruptedConversation('conversation-1', {
      repository,
      invocations,
      now: '2026-10-20T00:00:30.000Z',
    });
    const second = repairInterruptedConversation('conversation-1', {
      repository,
      invocations,
      now: '2026-10-20T00:00:31.000Z',
    });

    expect(first.status).toBe('repaired');
    expect(first.events.map((event) => event.type)).toEqual([
      'recovery_result',
      'turn_interrupted',
    ]);
    expect(first.events[0]).toMatchObject({
      status: 'outcome_unknown',
      ledgerStatus: 'succeeded',
      synthetic: true,
    });
    expect(second).toMatchObject({ status: 'nothing_to_repair', events: [] });
    expect(repository.ensureConversation('conversation-1').tailIncomplete).toBe(true);
    expect(invocations.get).toHaveBeenCalledOnce();
  });

  it('repairs a pre-dispatch approval as not started and expires the old approval', () => {
    appendInterruptedToolRun(repository, 'run-approval', false, true);

    const result = repairInterruptedConversation('conversation-1', {
      repository,
      now: '2026-10-20T00:00:30.000Z',
    });

    expect(result.events.map((event) => event.type)).toEqual([
      'recovery_result',
      'approval',
      'turn_interrupted',
    ]);
    expect(result.events[0]).toMatchObject({ status: 'not_started', ledgerStatus: 'missing' });
    expect(result.events[1]).toMatchObject({ status: 'expired', callId: 'call-1' });
  });

  it('does not repair while another process still owns the conversation lease', () => {
    appendInterruptedToolRun(repository, 'run-1', true, false);
    const owner = repository.claimOwner('conversation-1', 'live-owner', 60_000, now);

    const result = repairInterruptedConversation('conversation-1', {
      repository,
      now: '2026-10-20T00:00:01.000Z',
    });

    expect(result).toMatchObject({ status: 'blocked_active_owner', events: [] });
    expect(repository.readAll('conversation-1')).toHaveLength(4);
    expect(repository.releaseOwner(owner)).toBe(true);
  });
});

function appendInterruptedToolRun(
  repository: ConversationSessionRepository,
  runId: string,
  dispatched: boolean,
  approvalRequested: boolean,
): void {
  const conversationId = 'conversation-1';
  const state = repository.ensureConversation(conversationId, now);
  const lease = repository.claimOwner(conversationId, 'seed-' + runId, 60_000, now);
  const toolCall = {
    id: 'call-1',
    type: 'function',
    function: { name: 'write_file', arguments: '{"path":"note.md"}' },
  };
  const events = [
    {
      ...base(conversationId, runId, 1),
      type: 'turn_started' as const,
    },
    {
      ...base(conversationId, runId, 2),
      type: 'user_message' as const,
      messageId: 'message-' + runId,
      content: 'write a file',
    },
    {
      ...base(conversationId, runId, 3),
      type: 'model_message' as const,
      round: 1,
      messages: [{ role: 'assistant', content: null, tool_calls: [toolCall] }],
    },
    ...(dispatched
      ? [
          {
            ...base(conversationId, runId, 4),
            type: 'tool_dispatch_committed' as const,
            round: 1,
            callId: 'call-1',
            toolName: 'write_file',
            argumentsJson: '{"path":"note.md"}',
            retrySafety: 'never' as const,
          },
        ]
      : []),
    ...(approvalRequested
      ? [
          {
            ...base(conversationId, runId, dispatched ? 5 : 4),
            type: 'approval' as const,
            callId: 'call-1',
            toolName: 'write_file',
            status: 'requested' as const,
            reason: '需要确认',
          },
        ]
      : []),
  ];
  repository.appendBatch(
    conversationId,
    state.lastSequence,
    lease.ownerFence,
    events,
    '2026-10-20T00:00:01.000Z',
  );
  repository.releaseOwner(lease);
}

function base(conversationId: string, runId: string, seq: number) {
  return {
    schemaVersion: 1 as const,
    conversationId,
    eventId: runId + ':' + seq,
    seq,
    runId,
    turnId: 'turn-' + runId,
    createdAt: '2026-10-20T00:00:00.000Z',
  };
}
