import { describe, expect, it, vi } from 'vitest';
import { createChatStreamCallbacks } from '../chatStreamCallbacks';

function createOptions() {
  return {
    tempId: 'assistant-1',
    isAutoRoute: true,
    streamBufferRef: { current: { id: 'assistant-1', content: '' } },
    flushStream: vi.fn(),
    scheduleFlush: vi.fn(),
    finishStream: vi.fn(),
    updateTempMessage: vi.fn(),
    setActiveAgent: vi.fn(),
    setAutoRoutedAgent: vi.fn(),
    setAgentRunStatus: vi.fn(),
    dispatchReactEvent: vi.fn(),
  };
}

describe('createChatStreamCallbacks', () => {
  it('runs completion work after the stream is finished', () => {
    const options = createOptions();
    const onCompleted = vi.fn();
    const callbacks = createChatStreamCallbacks({ ...options, onCompleted });

    callbacks.onDone?.();

    expect(options.finishStream).toHaveBeenCalledWith('assistant-1');
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(options.finishStream.mock.invocationCallOrder[0])
      .toBeLessThan(onCompleted.mock.invocationCallOrder[0]);
  });

  it('associates the current run with the temporary assistant message', () => {
    const options = createOptions();
    const callbacks = createChatStreamCallbacks(options);

    callbacks.onRunStarted?.({ type: 'run_started', runId: 'run-1' });

    expect(options.updateTempMessage).toHaveBeenCalledWith('assistant-1', expect.any(Function));
    const update = options.updateTempMessage.mock.calls[0][1] as (message: { content: string }) => { runId?: string };
    expect(update({ content: '' })).toEqual({ content: '', runId: 'run-1' });
  });

  it('flushes text before inserting an A2UI segment', () => {
    const options = createOptions();
    const callbacks = createChatStreamCallbacks(options);
    callbacks.onChunk?.('before');
    callbacks.onA2ui?.({
      type: 'a2ui',
      segmentId: 'segment-1',
      message: { version: 'v0.9', createSurface: { surfaceId: 'surface-1', catalogId: 'mint' } },
    });

    expect(options.flushStream).toHaveBeenCalledOnce();
    expect(options.updateTempMessage).toHaveBeenCalledOnce();
  });
});
