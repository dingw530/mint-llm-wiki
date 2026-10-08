import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiAdapter } from '../adapters/api-adapter.js';
import { createModelConnectionVerifier } from '../model-connection-verification.js';

const adapter = { call: vi.fn() } as unknown as ApiAdapter;
const { listModels, testConnection } = createModelConnectionVerifier(() => adapter);

describe('modelConnectionService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns model IDs when an OpenAI-compatible model list is available', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ id: 'gpt-test' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      listModels({ apiUrl: 'https://api.test.com', apiKey: 'secret', modelId: '' }),
    ).resolves.toEqual({
      models: ['gpt-test'],
      available: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test.com/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer secret', 'x-api-key': 'secret' },
      }),
    );
  });

  it('does not send authorization headers for an empty API key', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      listModels({ apiUrl: 'http://localhost:11434', apiKey: '', modelId: '' }),
    ).resolves.toEqual({
      models: [],
      available: false,
    });
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ headers: {} }));
  });

  it('treats a non-empty response from the real adapter call as a successful test', async () => {
    vi.mocked(adapter.call).mockResolvedValue('OK');

    await expect(
      testConnection({
        apiUrl: 'http://localhost:11434',
        apiKey: '',
        modelId: 'local-model',
        apiType: 'openai-chat',
      }),
    ).resolves.toEqual({ success: true });
    expect(adapter.call).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Reply with the single word: OK' }],
      { modelId: 'local-model' },
      'http://localhost:11434',
      '',
      expect.objectContaining({ maxTokens: 16 }),
    );
  });

  it('classifies authentication failures as configuration errors', async () => {
    const error = Object.assign(new Error('unauthorized'), { status: 401 });
    vi.mocked(adapter.call).mockRejectedValue(error);

    await expect(
      testConnection({
        apiUrl: 'https://api.test.com',
        apiKey: 'secret',
        modelId: 'missing-model',
      }),
    ).resolves.toEqual({
      success: false,
      errorCategory: 'configuration',
      errorMessage: '模型连接配置无效，请检查 API URL、API Key、API 类型和模型。',
    });
  });
});
