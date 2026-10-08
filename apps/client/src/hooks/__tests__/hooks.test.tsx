import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversations } from '../useConversations';
import useSSE from '../useSSE';
import { useSidebarResize } from '../useSidebarResize';
import type { Conversation, SendCallbacks } from '@/types';

const api = vi.hoisted(() => ({
  getConversations: vi.fn(),
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  clearAllConversations: vi.fn(),
  renameConversation: vi.fn(),
  sendMessageStream: vi.fn(),
}));

vi.mock('@/services/api', () => api);

interface HookHarness<T> {
  result: { current: T };
  unmount: () => void;
}

function renderHook<T>(hook: () => T): HookHarness<T> {
  const result = { current: undefined as T };
  let root: Root;
  const container = document.createElement('div');
  document.body.appendChild(container);
  function Harness() {
    result.current = hook();
    return null;
  }
  act(() => {
    root = createRoot(container);
    root.render(<Harness />);
  });
  return {
    result,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const conversation = (id: string, title = id): Conversation => ({
  id,
  title,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  type: 'chat',
  lockedAgent: null,
  routingMode: 'auto',
});

describe('useConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getConversations.mockResolvedValue({ conversations: [conversation('one')] });
  });

  it('loads conversations and selects the first conversation', async () => {
    const hook = renderHook(() => useConversations('chat'));
    await act(async () => {});
    expect(api.getConversations).toHaveBeenCalledWith('chat');
    expect(hook.result.current.conversations).toHaveLength(1);
    expect(hook.result.current.activeId).toBe('one');
    expect(hook.result.current.loading).toBe(false);
    hook.unmount();
  });

  it('creates, renames, updates, deletes and clears conversations', async () => {
    api.createConversation.mockResolvedValue({ conversation: conversation('two') });
    api.renameConversation.mockResolvedValue({ conversation: conversation('one', 'renamed') });
    api.deleteConversation.mockResolvedValue({ success: true });
    api.clearAllConversations.mockResolvedValue({ changes: 2 });
    const hook = renderHook(() => useConversations());
    await act(async () => {});
    await act(async () => {
      await hook.result.current.create();
      await hook.result.current.rename('one', 'renamed');
      hook.result.current.updateTitle('two', 'updated');
      hook.result.current.updateConversation('two', { type: 'text' });
    });
    expect(api.createConversation).toHaveBeenCalledWith('New Conversation', undefined);
    expect(hook.result.current.conversations).toEqual([
      expect.objectContaining({ id: 'two', title: 'updated', type: 'text' }),
      expect.objectContaining({ id: 'one', title: 'renamed' }),
    ]);
    await act(async () => {
      await hook.result.current.delete('two');
      await hook.result.current.clearAll();
    });
    expect(api.deleteConversation).toHaveBeenCalledWith('two');
    expect(api.clearAllConversations).toHaveBeenCalledOnce();
    expect(hook.result.current.conversations).toEqual([]);
    expect(hook.result.current.activeId).toBeNull();
    hook.unmount();
  });

  it('keeps state usable when the initial API operation fails', async () => {
    api.getConversations.mockRejectedValue(new Error('offline'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hook = renderHook(() => useConversations());
    await act(async () => {});
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.conversations).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    hook.unmount();
  });
});

describe('useSSE', () => {
  it('aborts the previous stream before sending a new one and exposes abort', () => {
    const firstAbort = vi.fn();
    const secondAbort = vi.fn();
    api.sendMessageStream
      .mockReturnValueOnce({ abort: firstAbort })
      .mockReturnValueOnce({ abort: secondAbort });
    const hook = renderHook(() => useSSE());
    const callbacks: SendCallbacks = {};
    act(() =>
      hook.result.current.send('conversation', 'hello', callbacks, 'general', { regenerate: true }),
    );
    act(() => hook.result.current.send('conversation', 'again', callbacks));
    expect(firstAbort).toHaveBeenCalledOnce();
    expect(api.sendMessageStream).toHaveBeenNthCalledWith(
      2,
      'conversation',
      'again',
      callbacks,
      undefined,
      {},
    );
    act(() => hook.result.current.abort());
    expect(secondAbort).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it('keeps streams for different conversations independent', () => {
    const firstAbort = vi.fn();
    const secondAbort = vi.fn();
    api.sendMessageStream
      .mockReturnValueOnce({ abort: firstAbort })
      .mockReturnValueOnce({ abort: secondAbort });
    const hook = renderHook(() => useSSE());
    const callbacks: SendCallbacks = {};
    act(() => hook.result.current.send('conversation-a', 'hello', callbacks));
    act(() => hook.result.current.send('conversation-b', 'hello', callbacks));
    expect(firstAbort).not.toHaveBeenCalled();
    expect(secondAbort).not.toHaveBeenCalled();
    act(() => hook.result.current.abort('conversation-a'));
    expect(firstAbort).toHaveBeenCalledOnce();
    expect(secondAbort).not.toHaveBeenCalled();
    hook.unmount();
  });
});

describe('useSidebarResize', () => {
  beforeEach(() => localStorage.clear());

  it('restores valid persisted width and clamps drag results', () => {
    localStorage.setItem('mint-sidebar-width', '300');
    const hook = renderHook(() => useSidebarResize());
    expect(hook.result.current.width).toBe(300);
    act(() =>
      hook.result.current.onMouseDown({
        preventDefault: vi.fn(),
        clientX: 100,
      } as unknown as React.MouseEvent),
    );
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 })));
    expect(hook.result.current.width).toBe(480);
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
    expect(localStorage.getItem('mint-sidebar-width')).toBe('480');
    hook.unmount();
  });

  it('uses the default width for invalid persisted values', () => {
    localStorage.setItem('mint-sidebar-width', '999');
    const hook = renderHook(() => useSidebarResize());
    expect(hook.result.current.width).toBe(260);
    hook.unmount();
  });
});
