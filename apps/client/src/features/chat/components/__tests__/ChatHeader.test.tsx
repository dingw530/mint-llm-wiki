import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
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
});
