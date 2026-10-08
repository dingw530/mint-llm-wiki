import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../db.js';
import * as memoryScopeRepository from '../memory-scope-repository.js';
import * as memoryJobRepository from '../memory-job-repository.js';
import * as memoryRepository from '../memory-repository.js';

const conversationId = 'memory-scope-conversation-test';
const messageId = 'memory-scope-message-test';

describe('memory scope persistence', () => {
  afterEach(() => {
    getDb()
      .prepare('DELETE FROM memory_message_scopes WHERE conversation_id = ?')
      .run(conversationId);
    getDb()
      .prepare('DELETE FROM memory_processing_jobs WHERE conversation_id = ?')
      .run(conversationId);
    getDb().prepare("DELETE FROM memories WHERE id LIKE 'memory-scope-assign-%'").run();
    getDb().prepare('DELETE FROM messages WHERE id = ?').run(messageId);
    getDb().prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
    getDb().prepare("DELETE FROM memory_spaces WHERE name LIKE 'scope-test-%'").run();
  });

  it('increments binding revisions only when the selected scope changes', () => {
    getDb().prepare('INSERT INTO conversations (id) VALUES (?)').run(conversationId);
    const space = memoryScopeRepository.createSpace('scope-test-project');

    expect(memoryScopeRepository.findConversationScope(conversationId)).toEqual({
      scopeKind: 'global',
      spaceId: null,
      bindingRevision: 1,
    });
    expect(memoryScopeRepository.bindConversation(conversationId, space.id)).toEqual({
      changed: true,
      scope: { scopeKind: 'space', spaceId: space.id, bindingRevision: 2 },
    });
    expect(memoryScopeRepository.bindConversation(conversationId, space.id)).toEqual({
      changed: false,
      scope: { scopeKind: 'space', spaceId: space.id, bindingRevision: 2 },
    });
    expect(memoryScopeRepository.bindConversation(conversationId, null)).toEqual({
      changed: true,
      scope: { scopeKind: 'global', spaceId: null, bindingRevision: 3 },
    });
  });

  it('archives spaces by unbinding conversations and preserves message scope snapshots', () => {
    getDb().prepare('INSERT INTO conversations (id) VALUES (?)').run(conversationId);
    getDb()
      .prepare(
        "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', 'hello')",
      )
      .run(messageId, conversationId);
    const space = memoryScopeRepository.createSpace('scope-test-archive');
    const bound = memoryScopeRepository.bindConversation(conversationId, space.id)!;
    memoryScopeRepository.captureMessageScope(messageId, conversationId, bound.scope);
    memoryScopeRepository.captureMessageScope(messageId, conversationId, {
      scopeKind: 'global',
      spaceId: null,
      bindingRevision: 99,
    });

    expect(memoryScopeRepository.archiveSpace(space.id)?.archivedAt).toBeTruthy();
    expect(memoryScopeRepository.findConversationScope(conversationId)).toMatchObject({
      scopeKind: 'global',
      spaceId: null,
      bindingRevision: 3,
    });
    expect(memoryScopeRepository.findMessageScope(messageId)).toMatchObject({
      scopeKind: 'space',
      spaceId: space.id,
      bindingRevision: 2,
    });
  });

  it('keeps A to B to A jobs and transcripts isolated by binding revision', () => {
    getDb().prepare('INSERT INTO conversations (id) VALUES (?)').run(conversationId);
    const globalA = memoryScopeRepository.findConversationScope(conversationId)!;
    const space = memoryScopeRepository.createSpace('scope-test-revisions');
    const spaceB = memoryScopeRepository.bindConversation(conversationId, space.id)!.scope;
    const globalAAgain = memoryScopeRepository.bindConversation(conversationId, null)!.scope;

    const messages = [
      { id: 'memory-scope-revision-1', scope: globalA, createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'memory-scope-revision-2', scope: spaceB, createdAt: '2026-09-02T00:00:00.000Z' },
      {
        id: 'memory-scope-revision-3',
        scope: globalAAgain,
        createdAt: '2026-09-03T00:00:00.000Z',
      },
    ];
    for (const message of messages) {
      getDb()
        .prepare(
          "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)",
        )
        .run(message.id, conversationId, message.id, message.createdAt);
      memoryScopeRepository.captureMessageScope(message.id, conversationId, message.scope);
    }

    const jobs = messages.map((message) =>
      memoryJobRepository.enqueue(conversationId, message.id, message.scope),
    );
    expect(new Set(jobs.map((job) => job.id)).size).toBe(3);
    expect(jobs.map((job) => job.bindingRevision)).toEqual([1, 2, 3]);
    expect(
      memoryScopeRepository
        .findTranscriptForJob(conversationId, jobs[1], messages[1].id)
        .map(({ id }) => id),
    ).toEqual([messages[1].id]);
    memoryScopeRepository.archiveSpace(space.id);
    expect(
      memoryScopeRepository.findTranscriptForJob(conversationId, jobs[1], messages[1].id),
    ).toEqual([]);
    expect(() => memoryJobRepository.enqueue(conversationId, messages[1].id, spaceB)).toThrow(
      'Memory space is unavailable',
    );
  });

  it('rejects conflicting batch assignment atomically', () => {
    const first = memoryRepository.create({
      id: 'memory-scope-assign-1',
      content: 'prefers concise answers',
      memoryKey: 'preference.response_style',
      scopeKind: 'unassigned',
    });
    memoryRepository.create({
      id: 'memory-scope-assign-2',
      content: 'prefers detailed answers',
      memoryKey: 'preference.response_style',
      scopeKind: 'unassigned',
    });

    expect(() =>
      memoryScopeRepository.assignMemoryScope([first.id, 'memory-scope-assign-2'], 'global', null),
    ).toThrow('Memory scope assignment has conflicting single-value facts');
    expect(
      getDb()
        .prepare("SELECT scope_kind FROM memories WHERE id LIKE 'memory-scope-assign-%'")
        .all(),
    ).toEqual([{ scope_kind: 'unassigned' }, { scope_kind: 'unassigned' }]);
  });
});
