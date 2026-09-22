import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import EndpointsPanel from '../EndpointsPanel';

const getEndpoints = vi.hoisted(() => vi.fn());
const createEndpoint = vi.hoisted(() => vi.fn());
const updateEndpoint = vi.hoisted(() => vi.fn());
const deleteEndpoint = vi.hoisted(() => vi.fn());
const activateEndpoint = vi.hoisted(() => vi.fn());

vi.mock('@/services/api', () => ({
  getEndpoints,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  activateEndpoint,
}));

const endpoint = {
  id: 'endpoint-1',
  name: 'OpenAI',
  apiUrl: 'https://api.openai.com/v1',
  apiKeyMasked: 'sk-***',
  modelId: 'gpt-4o-mini',
  apiType: 'openai-chat',
  isActive: true,
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
};

describe('EndpointsPanel', () => {
  it('keeps the edit form open when the backdrop is clicked', async () => {
    getEndpoints.mockResolvedValue({ endpoints: [endpoint] });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<EndpointsPanel />);
      await Promise.resolve();
    });

    const editButton = container.querySelector<HTMLButtonElement>('button[title="编辑"]');
    expect(editButton).not.toBeNull();
    await act(async () => editButton?.click());

    const overlay = container.querySelector<HTMLElement>('.modal-overlay');
    expect(overlay).not.toBeNull();
    await act(async () => overlay?.click());
    expect(container.querySelector('.tool-modal')).not.toBeNull();

    const cancelButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '取消',
    );
    expect(cancelButton).not.toBeUndefined();
    await act(async () => cancelButton?.click());
    expect(container.querySelector('.tool-modal')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });
});
