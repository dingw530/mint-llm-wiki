import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@/types';
import {
  dispatchReactEvent,
  getRuntime,
  setMessages,
  setRuntime,
  subscribe,
} from '../chatRuntimeStore';

const message = (id: string): Message => ({
  id,
  conversationId: 'conversation-a',
  role: 'assistant',
  content: id,
  createdAt: '2026-08-12T00:00:00.000Z',
});

describe('chatRuntimeStore', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('keeps runtime state isolated per conversation', () => {
    setMessages('conversation-a', [message('a')]);
    setRuntime('conversation-a', { sending: true, streamingId: 'run-a' });
    setMessages('conversation-b', [message('b')]);

    expect(getRuntime('conversation-a')).toMatchObject({
      messages: [message('a')], sending: true, streamingId: 'run-a',
    });
    expect(getRuntime('conversation-b')).toMatchObject({
      messages: [message('b')], sending: false, streamingId: null,
    });
  });

  it('notifies only subscribers of the changed conversation', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const unsubscribeA = subscribe('conversation-a', listenerA);
    const unsubscribeB = subscribe('conversation-b', listenerB);

    dispatchReactEvent('conversation-a', { type: 'run_started', runId: 'run-a' });

    expect(listenerA).toHaveBeenCalledOnce();
    expect(listenerB).not.toHaveBeenCalled();
    unsubscribeA();
    unsubscribeB();
  });
});
