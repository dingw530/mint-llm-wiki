import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSessionRepository } from '../../../infrastructure/persistence/conversation-session-repository.js';
import { ConversationSessionRunWriter } from '../session-run-writer.js';

describe('ConversationSessionRunWriter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records approval expiry and closes the interrupted turn', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let sequence = 0;
    const repository = {
      appendBatch: vi.fn((_conversationId, lastSequence, events) => {
        calls.push(...events.map((event) => event.type));
        sequence = lastSequence + events.length;
        return { lastSequence: sequence };
      }),
    } as unknown as ConversationSessionRepository;
    const writer = new ConversationSessionRunWriter(
      repository,
      'conversation-1',
      'run-1',
      'turn-1',
      0,
    );

    writer.recordApproval({
      callId: 'call-1',
      toolName: 'write_file',
      status: 'requested',
      reason: '需要确认',
    });
    writer.pauseForApproval('call-1', 5_000);
    vi.advanceTimersByTime(5_000);

    expect(calls).toEqual(['approval', 'approval', 'turn_interrupted']);
    expect(sequence).toBe(3);
  });

  it('closes idempotently and clears approval expiry timers', () => {
    vi.useFakeTimers();
    const repository = {
      appendBatch: vi.fn((_conversationId, lastSequence, events) => ({
        lastSequence: lastSequence + events.length,
      })),
    } as unknown as ConversationSessionRepository;
    const writer = new ConversationSessionRunWriter(
      repository,
      'conversation-1',
      'run-1',
      'turn-1',
      0,
    );

    writer.recordApproval({ callId: 'call-1', toolName: 'write_file', status: 'requested' });
    writer.pauseForApproval('call-1', 5_000);
    writer.close();
    writer.close();
    vi.advanceTimersByTime(5_000);

    expect(repository.appendBatch).toHaveBeenCalledTimes(1);
  });

  it('closes the turn after every parallel approval has expired', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let sequence = 0;
    const repository = {
      appendBatch: vi.fn((_conversationId, lastSequence, events) => {
        calls.push(...events.map((event) => event.type));
        sequence = lastSequence + events.length;
        return { lastSequence: sequence };
      }),
    } as unknown as ConversationSessionRepository;
    const writer = new ConversationSessionRunWriter(
      repository,
      'conversation-1',
      'run-1',
      'turn-1',
      0,
    );

    for (const callId of ['call-1', 'call-2']) {
      writer.recordApproval({ callId, toolName: 'write_file', status: 'requested' });
      writer.pauseForApproval(callId, 5_000);
    }
    vi.advanceTimersByTime(5_000);

    expect(calls).toEqual(['approval', 'approval', 'approval', 'approval', 'turn_interrupted']);
    expect(sequence).toBe(5);
  });
});
