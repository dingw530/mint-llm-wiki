import { beforeEach, describe, expect, it, vi } from 'vitest';

const heartbeat = vi.fn();

vi.mock('chromadb', () => ({
  ChromaClient: vi.fn(() => ({ heartbeat })),
}));

import {
  testChromaConnection,
  testEmbeddingConnection,
} from '../vector-connection-verification.js';

describe('vectorConnectionService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    heartbeat.mockReset();
  });

  it('tests an embedding endpoint and validates dimensions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: new Array(1024).fill(0) }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      testEmbeddingConnection({
        apiUrl: 'http://127.0.0.1:11434/v1',
        model: 'bge-m3',
        dimensions: 1024,
      }),
    ).resolves.toMatchObject({ success: true, dimensions: 1024 });
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/v1/embeddings',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reports an embedding dimension mismatch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0, 1] }] }), { status: 200 }),
    );

    await expect(
      testEmbeddingConnection({
        apiUrl: 'http://embedding.test/v1',
        model: 'bge-m3',
        dimensions: 1024,
      }),
    ).resolves.toMatchObject({ success: false, message: expect.stringContaining('维度不匹配') });
  });

  it('tests Chroma with heartbeat without creating a collection', async () => {
    heartbeat.mockResolvedValue(123);

    await expect(testChromaConnection('http://127.0.0.1:8000', 'secret')).resolves.toEqual({
      success: true,
      message: 'Chroma Server 连接成功',
    });
    expect(heartbeat).toHaveBeenCalledOnce();
  });

  it('reports Chroma heartbeat failures', async () => {
    heartbeat.mockRejectedValue(new Error('connection refused'));

    await expect(testChromaConnection('http://127.0.0.1:8000')).resolves.toEqual({
      success: false,
      message: 'connection refused',
    });
  });
});
