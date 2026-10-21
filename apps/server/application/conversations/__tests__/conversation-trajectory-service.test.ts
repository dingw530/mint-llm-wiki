import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  exists: true,
  readEventFails: false,
  highWatermark: 4,
  events: [1, 2, 3, 4].map((seq) => ({ eventId: `event-${seq}`, seq })),
  entries: [1, 2, 3, 4].map((seq) => ({
    id: `event-${seq}`,
    eventIds: [`event-${seq}`],
    seq,
    runId: 'run-1',
    turnId: 'turn-1',
    lane: 'model' as const,
    kind: 'message' as const,
    label: `模型输出 ${seq}`,
    createdAt: '2026-10-21T00:00:00.000Z',
    detailEventIds: [`event-${seq}`],
    synthetic: false,
  })),
}));

vi.mock('../../../domains/conversations/index.js', () => ({
  findById: vi.fn(() => (state.exists ? { id: 'conversation-1' } : null)),
}));

vi.mock('../../../infrastructure/persistence/conversation-session-repository.js', () => ({
  ConversationSessionRepository: vi.fn().mockImplementation(() => ({
    ensureConversation: vi.fn(() => ({
      generation: 'generation-1',
      lastSequence: state.highWatermark,
      historyCompleteness: 'legacy_partial',
      tailIncomplete: true,
    })),
    readAll: vi.fn(() => state.events),
    readPage: vi.fn(
      (_conversationId: string, afterSeq: number, pageSize: number, throughSeq?: number) => {
        const highWatermark = Math.min(throughSeq ?? state.highWatermark, state.highWatermark);
        const candidates = state.events.filter(
          (event) => event.seq > afterSeq && event.seq <= highWatermark,
        );
        const events = candidates.slice(0, pageSize);
        return {
          state: {
            generation: 'generation-1',
            historyCompleteness: 'legacy_partial',
            tailIncomplete: true,
          },
          highWatermark,
          nextAfterSequence: events.at(-1)?.seq ?? afterSeq,
          hasMore: candidates.length > pageSize,
          events,
        };
      },
    ),
    readEvent: vi.fn((_conversationId: string, eventId: string) => {
      if (state.readEventFails) throw new Error('invalid session event JSON');
      return state.events.find((event) => event.eventId === eventId);
    }),
  })),
}));

vi.mock('../conversation-session-recovery-service.js', () => ({
  repairInterruptedConversation: vi.fn(() => ({
    status: 'nothing_to_repair',
    lastSequence: state.highWatermark,
    events: [],
  })),
}));

vi.mock('@mint/session/trace', () => ({
  projectTrace: vi.fn(() => ({
    entries: state.entries,
    events: state.entries.map((entry) => ({
      eventId: entry.id,
      seq: entry.seq,
      runId: entry.runId,
      turnId: entry.turnId,
      type: 'model_message',
      lane: entry.lane,
      kind: entry.kind,
      label: entry.label,
      createdAt: entry.createdAt,
      detailAvailable: true,
      synthetic: false,
      relatedIds: [],
    })),
    runs: [
      {
        runId: 'run-1',
        status: 'running',
        originRunId: null,
        turnId: 'turn-1',
        startedAt: '2026-10-21T00:00:00.000Z',
        endedAt: null,
      },
    ],
    toolStatuses: [],
  })),
}));

import {
  getConversationTrajectory,
  getConversationTrajectoryEvent,
  streamConversationTrajectory,
} from '../conversation-trajectory-service.js';
import { repairInterruptedConversation } from '../conversation-session-recovery-service.js';

describe('conversation trajectory service', () => {
  beforeEach(() => {
    state.exists = true;
    state.readEventFails = false;
    state.highWatermark = 4;
  });

  it('pages entries against a fixed watermark and reports history gaps', () => {
    const first = getConversationTrajectory('conversation-1', 0, 2, 3);
    const second = getConversationTrajectory(
      'conversation-1',
      first.nextAfterSeq,
      2,
      first.highWatermark,
    );

    expect(first).toMatchObject({
      generation: 'generation-1',
      highWatermark: 3,
      nextAfterSeq: 2,
      hasMore: true,
      historyCompleteness: 'legacy_partial',
      tailIncomplete: true,
      events: expect.any(Array),
      runs: expect.any(Array),
    });
    expect(first.entries.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(second.entries.map((entry) => entry.seq)).toEqual([3]);
    expect(repairInterruptedConversation).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({ repository: expect.any(Object) }),
    );
  });

  it('returns a detail envelope and reports missing or unreadable event payloads', () => {
    expect(getConversationTrajectoryEvent('conversation-1', 'event-2')).toMatchObject({
      eventId: 'event-2',
      availability: 'available',
      payload: { eventId: 'event-2' },
    });
    expect(getConversationTrajectoryEvent('conversation-1', 'missing')).toMatchObject({
      availability: 'missing',
      errorCode: 'EVENT_NOT_FOUND',
    });
    state.readEventFails = true;
    expect(getConversationTrajectoryEvent('conversation-1', 'event-1')).toMatchObject({
      availability: 'unavailable',
      errorCode: 'PAYLOAD_UNAVAILABLE',
    });
    state.exists = false;
    expect(() => getConversationTrajectory('missing')).toThrow('Conversation not found');
  });

  it('streams changed rows after the cursor and closes its polling timer', async () => {
    vi.useFakeTimers();
    const response = {
      status: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };
    const request = { header: vi.fn(() => undefined) };

    streamConversationTrajectory(
      'conversation-1',
      { afterSeq: '2' },
      request as never,
      response as never,
    );
    await vi.advanceTimersByTimeAsync(750);

    expect(response.write).toHaveBeenCalledWith(': ready 2\n\n');
    expect(response.write).toHaveBeenCalledWith(expect.stringContaining('"cursor":4'));
    const closeHandler = response.on.mock.calls.find(([eventName]) => eventName === 'close')?.[1];
    expect(closeHandler).toBeTypeOf('function');
    closeHandler?.();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
