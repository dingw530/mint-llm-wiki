import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WikiJob } from '../../../domains/wiki/index.js';

const worker = vi.hoisted(() => ({ list: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('../../../application/wiki/wiki-ingestion-job-service.js', () => ({
  wikiIngestionJobService: worker,
}));
import { streamConversationIngestionEvents } from '../ingestion-events.js';

/** Create a chat ingestion job with a stable identity for wire-format assertions. */
function createJob(id: string, conversationId = 'conversation-1'): WikiJob {
  return {
    id,
    conversationId,
    sourceType: 'chat',
    status: 'compiling',
    fileName: 'notes.md',
    fileSize: 10,
    progress: 60,
    step: 'compiling',
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:01.000Z',
  };
}

/** Open the stream with controllable transport close events and captured SSE frames. */
function openStream(jobs: WikiJob[]) {
  const request = new EventEmitter();
  const response = Object.assign(new EventEmitter(), {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn<[string], boolean>(() => true),
    writableEnded: false,
  });
  worker.list.mockReturnValue(jobs);
  worker.subscribe.mockReturnValue(worker.unsubscribe);
  streamConversationIngestionEvents('conversation-1', request as Request, response as Response);
  return { request, response };
}

describe('HTTP ingestion events', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('sends matching snapshot jobs as ordered A2UI v0.9 envelopes', () => {
    const stream = openStream([createJob('job-1'), createJob('foreign', 'other-conversation')]);
    expect(stream.response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    const frames = stream.response.write.mock.calls.map(([frame]) => frame);
    expect(frames[0]).toBe(': connected\n\n');
    const events = frames.slice(1).map((frame) => JSON.parse(frame.slice(6)));
    expect(events).toHaveLength(3);
    expect(events.map((event) => Object.keys(event))).toEqual([
      ['version', 'createSurface'],
      ['version', 'updateComponents'],
      ['version', 'updateDataModel'],
    ]);
    expect(events.every((event) => event.version === 'v0.9')).toBe(true);
    expect(events[0].createSurface.surfaceId).toBe('ingestion-task-job-1');
    expect(events[2].updateDataModel.value.jobId).toBe('job-1');
    stream.request.emit('close');
  });

  it.each(['request', 'response'] as const)(
    'stops heartbeat and releases subscription on %s close',
    (transport) => {
      const stream = openStream([]);
      expect(stream.response.write).toHaveBeenCalledWith(': connected\n\n');
      const listener: (job: WikiJob) => void = worker.subscribe.mock.calls[0][0];
      listener(createJob('job-2'));
      listener(createJob('job-2'));
      listener(createJob('foreign', 'other-conversation'));
      expect(stream.response.write.mock.calls).toHaveLength(5);
      vi.advanceTimersByTime(15_000);
      expect(stream.response.write).toHaveBeenLastCalledWith(': keep-alive\n\n');
      stream[transport].emit('close');
      expect(worker.unsubscribe).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      const writes = stream.response.write.mock.calls.length;
      listener(createJob('after-close'));
      vi.advanceTimersByTime(30_000);
      expect(stream.response.write.mock.calls).toHaveLength(writes);
    },
  );
});
