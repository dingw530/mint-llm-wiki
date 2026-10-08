import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useChatAgentActions from '../useChatAgentActions';
import type { Conversation } from '@/types';

const api = vi.hoisted(() => ({ lockAgent: vi.fn(), unlockAgent: vi.fn() }));
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

const conversation = (id: string): Conversation => ({
  id, title: id, createdAt: '2026-01-01', updatedAt: '2026-01-01', type: 'chat',
  lockedAgent: null, routingMode: 'auto',
});

describe('useChatAgentActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.lockAgent.mockResolvedValue({ conversation: conversation('conversation-1') });
    api.unlockAgent.mockResolvedValue({ conversation: conversation('conversation-1') });
  });

  it('locks an agent in auto routing mode and updates the conversation', async () => {
    const onUpdateConversation = vi.fn();
    const setActiveAgent = vi.fn();
    const hook = renderHook(() => useChatAgentActions({
      activeConversation: 'conversation-1', routingMode: 'auto', onUpdateConversation, setActiveAgent,
    }));

    await act(async () => { hook.result.current.handleSelectAgent('research'); });

    expect(api.lockAgent).toHaveBeenCalledWith('conversation-1', 'research');
    expect(onUpdateConversation).toHaveBeenCalledWith('conversation-1', expect.any(Object));
    expect(setActiveAgent).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('selects an agent locally in manual routing mode', () => {
    const setActiveAgent = vi.fn();
    const hook = renderHook(() => useChatAgentActions({
      activeConversation: 'conversation-1', routingMode: 'manual', setActiveAgent,
    }));

    act(() => { hook.result.current.handleSelectAgent('research'); });

    expect(setActiveAgent).toHaveBeenCalledWith('research');
    expect(api.lockAgent).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('unlocks the active conversation', async () => {
    const onUpdateConversation = vi.fn();
    const hook = renderHook(() => useChatAgentActions({
      activeConversation: 'conversation-1', routingMode: 'auto', onUpdateConversation, setActiveAgent: vi.fn(),
    }));

    await act(async () => { hook.result.current.handleUnlock(); });

    expect(api.unlockAgent).toHaveBeenCalledWith('conversation-1');
    expect(onUpdateConversation).toHaveBeenCalledWith('conversation-1', expect.any(Object));
    hook.unmount();
  });
});
