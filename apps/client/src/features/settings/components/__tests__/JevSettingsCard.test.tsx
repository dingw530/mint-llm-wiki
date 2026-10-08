import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import JevSettingsCard from '../JevSettingsCard';
import { createEmptyJevFormState } from '../jevForm';

const testJevConnection = vi.hoisted(() => vi.fn());

vi.mock('@/services/api', () => ({ testJevConnection }));

/** 渲染卡片并返回容器与点击"测试连接"的辅助函数。 */
function renderCard(jev = createEmptyJevFormState(), onChange = vi.fn()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<JevSettingsCard jev={jev} onChange={onChange} />);
  });
  const testButton = (): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.getAttribute('aria-label') === '测试 Jev 连接',
    );
  return { container, root, testButton, onChange };
}

/** 关闭卡片并清理 DOM。 */
function cleanup(container: HTMLElement, root: ReturnType<typeof createRoot>): void {
  act(() => root.unmount());
  container.remove();
}

describe('JevSettingsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an in-progress state while the probe is running, then the result', async () => {
    let release: ((value: { success: boolean; message: string }) => void) | undefined;
    testJevConnection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { container, root, testButton } = renderCard();

    await act(async () => {
      testButton()?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('.connection-test-result')?.textContent).toBe('正在测试连接...');
    expect(testButton()?.disabled).toBe(true);

    await act(async () => {
      release?.({ success: true, message: 'Jev 连接成功' });
      await Promise.resolve();
    });

    const result = container.querySelector('.connection-test-result');
    expect(result?.textContent).toBe('Jev 连接成功');
    expect(result?.className).toContain('success');
    expect(testButton()?.disabled).toBe(false);

    cleanup(container, root);
  });

  it('renders a readable failure state', async () => {
    testJevConnection.mockResolvedValueOnce({ success: false, message: 'Jev API Key 无效' });
    const { container, root, testButton } = renderCard();

    await act(async () => {
      testButton()?.click();
      await Promise.resolve();
    });

    const result = container.querySelector('.connection-test-result');
    expect(result?.textContent).toBe('Jev API Key 无效');
    expect(result?.className).toContain('error');

    cleanup(container, root);
  });

  it('sends only the filled fields so the stored key can be reused', async () => {
    testJevConnection.mockResolvedValueOnce({ success: true, message: 'Jev 连接成功' });
    const { container, root, testButton } = renderCard();

    await act(async () => {
      testButton()?.click();
      await Promise.resolve();
    });

    expect(testJevConnection).toHaveBeenCalledWith({
      apiUrl: 'https://api.typesafe.ai/v1/systemone',
      model: 'jev-latest',
    });

    cleanup(container, root);
  });

  it('keeps both sub-switch blocks collapsed until their switch is on', () => {
    const { container, root } = renderCard();
    expect(container.textContent).not.toContain('Jev 路由置信度');
    expect(container.textContent).not.toContain('Jev 记忆置信度');
    cleanup(container, root);
  });

  it('expands the threshold block when the switch is turned on', async () => {
    const onChange = vi.fn();
    const { container, root } = renderCard(createEmptyJevFormState(), onChange);

    const enableRouting = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.getAttribute('aria-label') === '启用 Jev 路由',
    );
    await act(async () => enableRouting?.click());

    expect(onChange).toHaveBeenCalledWith({ routingEnabled: true });
    cleanup(container, root);
  });

  it('keeps the Wiki rerank switch off by default and emits its independent setting', async () => {
    const onChange = vi.fn();
    const { container, root } = renderCard(createEmptyJevFormState(), onChange);
    expect(container.textContent).toContain('Wiki 语义 Rerank');

    const enableRerank = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.getAttribute('aria-label') === '启用 Jev Wiki rerank',
    );
    expect(enableRerank?.className).not.toContain('active');

    await act(async () => enableRerank?.click());

    expect(onChange).toHaveBeenCalledWith({ rerankEnabled: true });
    cleanup(container, root);
  });
});
