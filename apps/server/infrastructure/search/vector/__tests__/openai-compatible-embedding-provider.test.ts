import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmbeddingServiceError,
  OpenAICompatibleEmbeddingProvider,
} from '../providers/openai-compatible-embedding-provider.js';
import type { OpenAICompatibleEmbeddingConfig } from '../types.js';

function embedTexts(texts: string[], config: OpenAICompatibleEmbeddingConfig): Promise<number[][]> {
  return new OpenAICompatibleEmbeddingProvider(config).embed(texts);
}

function embeddingResponse(vectors: number[][]): {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
} {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: vectors.map((embedding, index) => ({ index, embedding })) }),
  };
}

describe('embeddingService', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('requests the OpenAI-compatible endpoint and preserves input order', async () => {
    const firstVector = Array.from({ length: 1024 }, (_, index) => index);
    const secondVector = Array.from({ length: 1024 }, (_, index) => index + 1);
    const fetchMock = vi.fn().mockResolvedValueOnce(embeddingResponse([firstVector, secondVector]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await embedTexts(['first', 'second'], {
      apiUrl: 'http://127.0.0.1:11434/v1/',
      model: 'bge-m3',
      dimensions: 1024,
    });

    expect(result).toEqual([firstVector, secondVector]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ model: 'bge-m3', input: ['first', 'second'] }),
      }),
    );
  });

  it('rejects invalid dimensions before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      embedTexts(['text'], {
        apiUrl: 'http://127.0.0.1:11434/v1',
        model: 'bge-m3',
        dimensions: 768,
      }),
    ).rejects.toBeInstanceOf(EmbeddingServiceError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed or mismatched responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ index: 0, embedding: [1, 2, 3] }] }),
      }),
    );

    await expect(
      embedTexts(['text'], {
        apiUrl: 'http://127.0.0.1:11434/v1',
        model: 'bge-m3',
        dimensions: 1024,
      }),
    ).rejects.toThrow('Embedding dimension mismatch');
  });
});
