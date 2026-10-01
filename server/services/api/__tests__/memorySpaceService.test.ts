import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../db.js';
import * as memoryRepository from '../../../infrastructure/persistence/memoryRepository.js';
import * as memorySpaceService from '../memorySpaceService.js';
import { reserveConversationScope } from '../conversationScopeLock.js';
import { initializeMemorySearchIndex } from '../../../domains/memory/index.js';

const conversationId = 'memory-space-service-conversation';
const createdSpaceIds: string[] = [];
const memoryIds = ['memory-space-service-a', 'memory-space-service-b'];

describe('memory space API service', () => {
  afterEach(() => {
    getDb()
      .prepare(
        `DELETE FROM memory_search_documents_fts WHERE memory_id IN (${memoryIds.map(() => '?').join(', ')})`,
      )
      .run(...memoryIds);
    getDb()
      .prepare(`DELETE FROM memories WHERE id IN (${memoryIds.map(() => '?').join(', ')})`)
      .run(...memoryIds);
    getDb().prepare('DELETE FROM memory_events WHERE conversation_id = ?').run(conversationId);
    getDb()
      .prepare('DELETE FROM memory_processing_jobs WHERE conversation_id = ?')
      .run(conversationId);
    getDb().prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
    for (const spaceId of createdSpaceIds.splice(0)) {
      getDb().prepare('DELETE FROM memory_spaces WHERE id = ?').run(spaceId);
    }
  });

  it('binds with monotonic revisions, blocks active runs, and archive unbinds safely', () => {
    getDb().prepare('INSERT INTO conversations (id) VALUES (?)').run(conversationId);
    const { space } = memorySpaceService.createMemorySpace({ name: 'scope-service-test' });
    createdSpaceIds.push(space.id);

    expect(memorySpaceService.getConversationMemorySpace(conversationId)).toMatchObject({
      scopeKind: 'global',
      memorySpaceId: null,
      memoryBindingRevision: 1,
    });
    const release = reserveConversationScope(conversationId);
    expect(() =>
      memorySpaceService.setConversationMemorySpace(conversationId, { spaceId: space.id }),
    ).toThrow('Conversation has an active run');
    release();

    expect(
      memorySpaceService.setConversationMemorySpace(conversationId, { spaceId: space.id }),
    ).toMatchObject({ changed: true, memorySpaceId: space.id, memoryBindingRevision: 2 });
    expect(
      memorySpaceService.setConversationMemorySpace(conversationId, { spaceId: space.id }),
    ).toMatchObject({ changed: false, memoryBindingRevision: 2 });
    expect(memorySpaceService.archiveMemorySpace(space.id).space.archivedAt).toBeTruthy();
    expect(memorySpaceService.getConversationMemorySpace(conversationId)).toMatchObject({
      scopeKind: 'global',
      memorySpaceId: null,
      memoryBindingRevision: 3,
    });
  });

  it('rejects conflicting batch assignment and indexes a successful user choice atomically', () => {
    initializeMemorySearchIndex();
    const space = memorySpaceService.createMemorySpace({ name: 'scope-conflict-test' }).space;
    createdSpaceIds.push(space.id);
    memoryRepository.create({
      id: memoryIds[0],
      content: 'Prefers brief replies',
      memoryKey: 'preference.response_style',
      scopeKind: 'unassigned',
    });
    memoryRepository.create({
      id: memoryIds[1],
      content: 'Prefers detailed replies',
      memoryKey: 'preference.response_style',
      scopeKind: 'unassigned',
    });

    expect(() =>
      memorySpaceService.assignMemoryScope({
        ids: memoryIds,
        scopeKind: 'global',
        spaceId: null,
      }),
    ).toThrow('Memory scope assignment conflicts with an existing single-value fact');
    expect(
      getDb()
        .prepare('SELECT scope_kind FROM memories WHERE id IN (?, ?) ORDER BY id')
        .all(...memoryIds),
    ).toEqual([{ scope_kind: 'unassigned' }, { scope_kind: 'unassigned' }]);

    expect(
      memorySpaceService.assignMemoryScope({
        ids: [memoryIds[0]],
        scopeKind: 'space',
        spaceId: space.id,
      }),
    ).toEqual({ updated: 1 });
    expect(
      getDb().prepare('SELECT scope_kind, space_id FROM memories WHERE id = ?').get(memoryIds[0]),
    ).toEqual({ scope_kind: 'space', space_id: space.id });
    expect(
      getDb()
        .prepare('SELECT count(*) AS count FROM memory_search_documents_fts WHERE memory_id = ?')
        .get(memoryIds[0]),
    ).toEqual({ count: 1 });
  });
});
