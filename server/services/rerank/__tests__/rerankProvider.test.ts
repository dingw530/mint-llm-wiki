import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JevSettings } from '../../../types.js';
import { createJevRerankProvider } from '../jevRerankProvider.js';
import { createLegacyRerankProvider } from '../legacyRerankProvider.js';
import { rerankCandidates } from '../rerankPolicy.js';
import type { RerankCandidate, RerankProvider } from '../types.js';

const SETTINGS: JevSettings = {
  apiUrl: 'https://api.typesafe.ai/v1/systemone',
  apiKey: 'test-key',
  model: 'jev-latest',
  timeoutMs: 3_000,
  routingEnabled: false,
  routingMinConfidence: 0,
  routingBypassOnKeyword: false,
  memoryEnabled: false,
  memoryGateThreshold: 0,
  rerankEnabled: true,
};

function candidate(id: string, lexicalRank: number): RerankCandidate {
  return {
    document: {
      id,
      pageId: null,
      sourcePath: `${id}.md`,
      title: id,
      heading: 'Section',
      body: `content for ${id}`,
      documentType: 'chunk',
      contentHash: id,
    },
    lexicalRank,
    vectorRank: null,
    vectorDistance: null,
  };
}

function jevResponse(scores: Record<string, number>): Response {
  return new Response(
    JSON.stringify({
      answers: Object.fromEntries(
        Object.entries(scores).map(([key, score]) => [key, { type: 'noul', noul: score }]),
      ),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('legacyRerankProvider', () => {
  it('keeps candidates in the existing RRF order', async () => {
    const result = await createLegacyRerankProvider().rerank(
      { query: 'query', candidates: [candidate('second', 2), candidate('first', 1)] },
      { jev: SETTINGS },
    );

    expect(result).toMatchObject({ kind: 'ranked', providerId: 'legacy' });
    if (result.kind === 'ranked') {
      expect(result.candidates.map((item) => item.document.id)).toEqual(['first', 'second']);
    }
  });
});

describe('jevRerankProvider', () => {
  it('sorts the selected candidates by Jev semantic score', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jevResponse({ candidate_0: 0.2, candidate_1: 0.9 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await createJevRerankProvider().rerank(
      { query: 'query', candidates: [candidate('first', 1), candidate('second', 2)] },
      { jev: SETTINGS },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      questions: Record<string, unknown>;
    };
    expect(Object.keys(request.questions)).toEqual(['candidate_0', 'candidate_1']);
    expect(result).toMatchObject({ kind: 'ranked', providerId: 'jev' });
    if (result.kind === 'ranked') {
      expect(result.candidates.map((item) => item.document.id)).toEqual(['second', 'first']);
      expect(result.candidates[0]?.semanticScore).toBe(0.9);
    }
  });

  it('returns unavailable when any candidate call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await createJevRerankProvider().rerank(
      { query: 'query', candidates: [candidate('first', 1)] },
      { jev: SETTINGS },
    );

    expect(result).toMatchObject({
      kind: 'unavailable',
      providerId: 'jev',
      reason: 'network_error',
    });
  });
});

describe('rerankCandidates', () => {
  it('falls back to legacy when Jev is unavailable', async () => {
    const unavailable: RerankProvider = {
      id: 'jev',
      rerank: async () => ({
        kind: 'unavailable',
        providerId: 'jev',
        reason: 'timeout',
        message: 'timeout',
      }),
    };
    const result = await rerankCandidates(
      { query: 'query', candidates: [candidate('first', 1)] },
      { jev: SETTINGS },
      [unavailable, createLegacyRerankProvider()],
    );

    expect(result).toMatchObject({ kind: 'ranked', providerId: 'legacy:fallback:timeout' });
  });
});
