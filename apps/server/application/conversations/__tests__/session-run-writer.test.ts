import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ConversationSessionLease,
  ConversationSessionRepository,
} from '../../../infrastructure/persistence/conversation-session-repository.js';
import { ConversationSessionRunWriter } from '../session-run-writer.js';

describe('ConversationSessionRunWriter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a live approval lease, then records expiry and releases ownership', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let sequence = 0;
    const repository = {
      appendBatch: vi.fn((_conversationId, lastSequence, _fence, events) => {
        calls.push(...events.map((event) => event.type));
        sequence = lastSequence + events.length;
        return { lastSequence: sequence };
      }),
      renewOwner: vi.fn(),
      releaseOwner: vi.fn(() => true),
    } as unknown as ConversationSessionRepository;
    const lease: ConversationSessionLease = {
      conversationId: 'conversation-1',
      ownerId: 'run-1',
      ownerFence: 1,
      expiresAt: '2026-10-21T00:05:00.000Z',
    };
    const writer = new ConversationSessionRunWriter(
      repository,
      'conversation-1',
      'run-1',
      'turn-1',
      lease,
      0,
    );

    writer.startHeartbeat();
    writer.recordApproval({
      callId: 'call-1',
      toolName: 'write_file',
      status: 'requested',
      reason: '需要确认',
    });
    writer.pauseForApproval('call-1', 5_000);
    vi.advanceTimersByTime(5_000);

    expect(calls).toEqual(['approval', 'approval', 'turn_interrupted']);
    expect(repository.releaseOwner).toHaveBeenCalledWith(lease);
    expect(repository.renewOwner).not.toHaveBeenCalled();
    expect(sequence).toBe(3);
  });

  it('renews the active lease and closes it once', () => {
    vi.useFakeTimers();
    const repository = {
      appendBatch: vi.fn((_conversationId, lastSequence, _fence, events) => ({
        lastSequence: lastSequence + events.length,
      })),
      renewOwner: vi.fn(),
      releaseOwner: vi.fn(() => true),
    } as unknown as ConversationSessionRepository;
    const lease: ConversationSessionLease = {
      conversationId: 'conversation-1',
      ownerId: 'run-1',
      ownerFence: 1,
      expiresAt: '2026-10-21T00:05:00.000Z',
    };
    const writer = new ConversationSessionRunWriter(
      repository,
      'conversation-1',
      'run-1',
      'turn-1',
      lease,
      0,
    );

    writer.startHeartbeat();
    vi.advanceTimersByTime(60_000);
    writer.close();
    writer.close();

    expect(repository.renewOwner).toHaveBeenCalledTimes(1);
    expect(repository.releaseOwner).toHaveBeenCalledOnce();
  });

  it('keeps ownership until every parallel approval has expired or resolved', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let sequence = 0;
    const repository = {
      appendBatch: vi.fn((_conversationId, lastSequence, _fence, events) => {
        calls.push(...events.map((event) => event.type));
        sequence = lastSequence + events.length;
        return { lastSequence: sequence };
      }),
      renewOwner: vi.fn(),
      releaseOwner: vi.fn(() => true),
    } as unknown as ConversationSessionRepository;
    const lease: ConversationSessionLease = {
      conversationId: 'conversation-1',
      ownerId: 'run-1',
      ownerFence: 1,
      expiresAt: '2026-10-21T00:05:00.000Z',
    };
    const writer = new ConversationSessionRunWriter(
      repository,
      'conversation-1',
      'run-1',
      'turn-1',
      lease,
      0,
    );

    writer.startHeartbeat();
    for (const callId of ['call-1', 'call-2']) {
      writer.recordApproval({ callId, toolName: 'write_file', status: 'requested' });
      writer.pauseForApproval(callId, 5_000);
    }
    vi.advanceTimersByTime(5_000);

    expect(calls).toEqual(['approval', 'approval', 'approval', 'approval', 'turn_interrupted']);
    expect(repository.releaseOwner).toHaveBeenCalledOnce();
    expect(sequence).toBe(5);
  });
});
