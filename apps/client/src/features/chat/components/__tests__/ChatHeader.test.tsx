import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import ChatHeader from '../ChatHeader';

describe('ChatHeader', () => {
  it('does not expose a memory-space selector', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => root.render(<ChatHeader title="测试对话" />));

    expect(container.textContent).toContain('测试对话');
    expect(container.textContent).not.toContain('记忆范围');
    expect(container.querySelector('[data-testid="conversation-memory-space"]')).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it('exposes keyboard-focusable conversation and trajectory tabs', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onTabChange = vi.fn();

    act(() =>
      root.render(
        <ChatHeader title="测试对话" activeTab="conversation" onTabChange={onTabChange} />,
      ),
    );
    const trajectoryTab = container.querySelector<HTMLButtonElement>('[role="tab"]:last-child');
    expect(trajectoryTab?.textContent).toContain('轨迹');
    expect(trajectoryTab?.getAttribute('aria-selected')).toBe('false');

    act(() => trajectoryTab?.click());
    expect(onTabChange).toHaveBeenCalledWith('trajectory');

    act(() => root.unmount());
    container.remove();
  });
});
