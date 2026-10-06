import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  assignMemoryScope: vi.fn(),
  createMemory: vi.fn(),
  deleteMemory: vi.fn(),
  getMemories: vi.fn(),
  getMemorySpaces: vi.fn(),
  updateMemory: vi.fn(),
  updateMemorySpace: vi.fn(),
  createMemorySpace: vi.fn(),
}));

vi.mock('@/services/api', () => api);

import MemoriesPanel from '../MemoriesPanel';

describe('MemoriesPanel global-only interface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getMemories.mockImplementation(async (_category, scopeKind) =>
      scopeKind === 'global'
        ? [
            {
              id: 'global-memory',
              content: '用户偏好简洁回答',
              category: 'preference',
              scopeKind: 'global',
              contextPolicy: 'retrievable',
              status: 'active',
            },
          ]
        : [
            {
              id: 'legacy-memory',
              content: '历史记忆待归属',
              category: 'general',
              scopeKind: 'unassigned',
              contextPolicy: 'retrievable',
              status: 'active',
            },
          ],
    );
    api.createMemory.mockResolvedValue({ id: 'created-memory' });
    api.assignMemoryScope.mockResolvedValue({ updated: 1 });
    api.deleteMemory.mockResolvedValue({ success: true });
    api.updateMemory.mockResolvedValue({ id: 'global-memory' });
  });

  it('hides knowledge-space controls and loads global plus unassigned entries', async () => {
    const { container, root } = await renderPanel();

    expect(container.textContent).not.toContain('知识空间');
    expect(container.querySelector('[data-testid="memory-scope-filter"]')).toBeNull();
    expect(container.querySelector('[data-testid="memory-scope-selector"]')).toBeNull();
    expect(container.querySelector('[data-testid="memory-card-global-memory"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="memory-card-legacy-memory"]')).not.toBeNull();
    expect(api.getMemorySpaces).not.toHaveBeenCalled();

    cleanup(container, root);
  });

  it('creates a new memory in user-global scope by default', async () => {
    const { container, root } = await renderPanel();
    const addButton = findButton(container, '+ 添加记忆');
    await act(async () => addButton?.click());

    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    await act(async () => setTextareaValue(textarea!, '新建的全局记忆'));

    const saveButton = findButton(container, '保存');
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });

    expect(api.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '新建的全局记忆',
        scopeKind: 'global',
        spaceId: null,
      }),
    );
    cleanup(container, root);
  });

  it('offers only user-global as the historical assignment target', async () => {
    const { container, root } = await renderPanel();
    const legacyCheckbox = container.querySelector<HTMLInputElement>(
      '[data-testid="memory-select-legacy-memory"]',
    );
    await act(async () => legacyCheckbox?.click());

    const expandButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="memory-assign-scope"]',
    );
    await act(async () => expandButton?.click());
    const assignButton = findButton(container, '确认归入用户全局');
    expect(assignButton).toBeDefined();
    expect(container.textContent).not.toContain('知识空间');

    await act(async () => {
      assignButton?.click();
      await Promise.resolve();
    });

    expect(api.assignMemoryScope).toHaveBeenCalledWith({
      ids: ['legacy-memory'],
      scopeKind: 'global',
      spaceId: null,
    });
    cleanup(container, root);
  });
});

async function renderPanel() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MemoriesPanel />);
    await Promise.resolve();
  });
  return { container, root };
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === text,
  );
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function cleanup(container: HTMLElement, root: ReturnType<typeof createRoot>): void {
  act(() => root.unmount());
  container.remove();
}
