import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../db.js';
import * as memoryJobRepo from '../memoryJobRepository.js';
import * as memoryRepo from '../memoryRepository.js';
import * as memoryService from '../../../domains/memory/index.js';
import * as memoryScopeRepository from '../memoryScopeRepository.js';

const conversationId = 'memory-p0-conversation';

describe('memory P0 persistence', () => {
  beforeEach(() => {
    getDb().prepare('INSERT OR IGNORE INTO conversations (id) VALUES (?)').run(conversationId);
    getDb().prepare('DELETE FROM memory_events WHERE conversation_id = ?').run(conversationId);
    getDb().prepare('DELETE FROM memories WHERE source_conversation_id = ?').run(conversationId);
    getDb()
      .prepare('DELETE FROM memory_processing_jobs WHERE conversation_id = ?')
      .run(conversationId);
    getDb()
      .prepare(
        "INSERT OR IGNORE INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', 'snapshot', datetime('now'))",
      )
      .run('memory-p0-message-1', conversationId);
    getDb()
      .prepare(
        "INSERT OR IGNORE INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', 'snapshot', datetime('now', '+1 second'))",
      )
      .run('memory-p0-message-2', conversationId);
    const scope = memoryScopeRepository.findConversationScope(conversationId)!;
    memoryScopeRepository.captureMessageScope('memory-p0-message-1', conversationId, scope);
    memoryScopeRepository.captureMessageScope('memory-p0-message-2', conversationId, scope);
  });

  afterEach(() => {
    getDb().prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
  });

  it('applies the migration for snapshot columns and audit events', () => {
    const columns = getDb().prepare('PRAGMA table_info(memory_processing_jobs)').all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['requested_through_message_id', 'processed_through_message_id']),
    );
    expect(
      getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_events'")
        .get(),
    ).toBeTruthy();
  });

  it('requeues when a newer message snapshot arrives and stays idempotent for the same snapshot', () => {
    const first = memoryJobRepo.enqueue(conversationId, 'memory-p0-message-1');
    memoryJobRepo.complete(first.id, 'memory-p0-message-1');

    const sameSnapshot = memoryJobRepo.enqueue(conversationId, 'memory-p0-message-1');
    expect(sameSnapshot.id).toBe(first.id);
    expect(sameSnapshot.status).toBe('completed');

    const newerSnapshot = memoryJobRepo.enqueue(conversationId, 'memory-p0-message-2');
    expect(newerSnapshot.id).toBe(first.id);
    expect(newerSnapshot.status).toBe('pending');
    expect(newerSnapshot.requestedThroughMessageId).toBe('memory-p0-message-2');

    memoryJobRepo.complete(first.id, 'memory-p0-message-1');
    const requeued = memoryJobRepo.enqueue(conversationId, 'memory-p0-message-2');
    expect(requeued.status).toBe('pending');
    expect(requeued.processedThroughMessageId).toBe('memory-p0-message-1');
  });

  it('records an auditable summary without memory content', () => {
    const eventId = 'memory-p0-event';
    memoryRepo.createEvent({
      id: eventId,
      jobId: 'memory-p0-job',
      conversationId,
      sourceMessageId: 'memory-p0-message-1',
      action: 'ADD',
      memoryKey: 'personal.name',
      subject: 'user',
      candidateIds: ['old-memory-id'],
      resultMemoryId: 'new-memory-id',
      status: 'applied',
    });

    const event = memoryRepo
      .findEventsByConversationId(conversationId)
      .find((item) => item.id === eventId);
    expect(event).toMatchObject({
      jobId: 'memory-p0-job',
      action: 'ADD',
      memoryKey: 'personal.name',
      resultMemoryId: 'new-memory-id',
    });
    expect(JSON.stringify(event)).not.toContain('secret-memory-content');
  });

  it('rolls back memory and audit writes as one transaction', () => {
    expect(() =>
      memoryRepo.withTransaction(() => {
        memoryRepo.create({
          id: 'memory-p0-rollback',
          content: 'secret-memory-content',
          category: 'personal',
          sourceConversationId: conversationId,
        });
        memoryRepo.createEvent({
          id: 'memory-p0-rollback-event',
          conversationId,
          action: 'ADD',
          memoryKey: 'personal.name',
          subject: 'user',
          resultMemoryId: 'memory-p0-rollback',
          status: 'applied',
        });
        throw new Error('rollback');
      }),
    ).toThrow('rollback');

    expect(
      getDb()
        .prepare("SELECT COUNT(*) AS count FROM memories WHERE id = 'memory-p0-rollback'")
        .get(),
    ).toMatchObject({ count: 0 });
    expect(
      getDb()
        .prepare(
          "SELECT COUNT(*) AS count FROM memory_events WHERE id = 'memory-p0-rollback-event'",
        )
        .get(),
    ).toMatchObject({ count: 0 });
  });

  it('keeps one active version when updating a single-value fact', () => {
    memoryRepo.create({
      id: 'memory-p0-old',
      content: '用户住在北京',
      category: 'personal',
      memoryKey: 'personal.location',
      contextPolicy: 'retrievable',
      policySource: 'auto',
      sourceConversationId: conversationId,
      sourceMessageId: 'message-1',
    });
    memoryService.applyMemoryOperations(
      [
        {
          action: 'UPDATE',
          memoryKey: 'personal.location',
          subject: 'user',
          content: '用户住在上海',
          sourceMessageId: 'message-2',
        },
      ],
      conversationId,
      'memory-p0-job',
    );

    const active = memoryRepo.findActiveByKey('personal.location', 'user');
    expect(active).toHaveLength(1);
    expect(active[0].content).toBe('用户住在上海');
    expect(
      getDb().prepare("SELECT status FROM memories WHERE id = 'memory-p0-old'").get(),
    ).toMatchObject({ status: 'superseded' });
  });
});
