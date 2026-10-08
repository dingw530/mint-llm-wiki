import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useChatConversationData from '../useChatConversationData';

const api = vi.hoisted(() => ({ fetchAgents: vi.fn(), getMessages: vi.fn(), getSettings: vi.fn() }));
vi.mock('@/services/api', () => api);

interface HookHarness<T> { result: { current: T }; unmount: () => void }

function renderHook<T>(hook: () => T): HookHarness<T> {
  const result = { current: undefined as T };
  let root: Root;
  const container = document.createElement('div');
  document.body.appendChild(container);
  function Harness() { result.current = hook(); return null; }
  act(() => { root = createRoot(container); root.render(<Harness />); });
  return { result, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

describe('useChatConversationData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchAgents.mockResolvedValue({ agents: [] });
    api.getMessages.mockResolvedValue({ messages: [{ id: 'message-1', role: 'user', content: 'hello' }] });
    api.getSettings.mockResolvedValue({ showReactSteps: false });
  });

  it('loads agents, settings and messages for an active conversation', async () => {
    const hook = renderHook(() => useChatConversationData({ activeConversation: 'conversation-1' }));
    await act(async () => {});

    expect(api.fetchAgents).toHaveBeenCalledOnce();
    expect(api.getSettings).toHaveBeenCalledOnce();
    expect(api.getMessages).toHaveBeenCalledWith('conversation-1');
    expect(hook.result.current.messages).toHaveLength(1);
    expect(hook.result.current.showReactSteps).toBe(false);
    hook.unmount();
  });

  it('clears messages when the conversation is absent or an initial message is pending', async () => {
    const hook = renderHook(() => useChatConversationData({ activeConversation: null }));
    await act(async () => {});
    expect(hook.result.current.messages).toEqual([]);
    expect(api.getMessages).not.toHaveBeenCalled();
    hook.unmount();

    const initialHook = renderHook(() => useChatConversationData({
      activeConversation: 'conversation-1', initialMessage: 'start now',
    }));
    await act(async () => {});
    expect(initialHook.result.current.messages).toEqual([]);
    expect(api.getMessages).not.toHaveBeenCalledWith('conversation-1');
    initialHook.unmount();
  });
});
