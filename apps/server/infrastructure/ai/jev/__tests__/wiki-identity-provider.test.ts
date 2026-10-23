import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JevSettings } from '../../../../types.js';
import { resolveWikiIdentityWithJev } from '../wiki-identity-provider.js';
import type {
  WikiIdentityCandidate,
  WikiIdentityInput,
  WikiIdentityResolverOptions,
} from '../../../../domains/wiki/index.js';

const callJev = vi.hoisted(() => vi.fn());

vi.mock('../jev-client.js', () => ({ callJev }));

const input: WikiIdentityInput = {
  title: 'RAG',
  category: 'AI',
  aliases: [],
  tags: [],
  summary: 'Retrieval-augmented generation.',
  content: 'Combines retrieval with generation.',
};

const candidate: WikiIdentityCandidate = {
  filename: 'pages/AI/retrieval-augmented-generation.md',
  title: 'Retrieval-Augmented Generation',
  category: 'AI',
  aliases: ['RAG'],
  tags: ['retrieval'],
  summary: 'Uses retrieved evidence to ground generation.',
};

const settings: WikiIdentityResolverOptions = {
  jevEnabled: true,
  aiSettings: {} as never,
  jevSettings: {
    apiUrl: 'https://typesafe.example/v1/systemone',
    apiKey: 'secret',
    model: 'jev-test',
    timeoutMs: 1000,
  } as JevSettings,
};

describe('resolveWikiIdentityWithJev', () => {
  beforeEach(() => callJev.mockReset());

  it('maps one high-confidence same-identity candidate', async () => {
    callJev.mockResolvedValue({
      ok: true,
      latencyMs: 20,
      answers: {
        identity_0: { type: 'score', score: 1.9, confidence: 0.95 },
        name_match_0: { type: 'noul', noul: 0.96 },
        scope_conflict_0: { type: 'noul', noul: 0.02 },
      },
    });

    await expect(resolveWikiIdentityWithJev(input, [candidate], settings)).resolves.toEqual({
      kind: 'match',
      targetPath: candidate.filename,
      provider: 'jev',
    });
    expect(callJev).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'secret' }),
      expect.objectContaining({
        model: 'jev-test',
        questions: expect.objectContaining({
          identity_0: expect.objectContaining({ type: 'score' }),
        }),
      }),
      { operation: 'wiki_identity_resolution' },
    );
  });

  it('does not merge a low-confidence same-identity judgment', async () => {
    callJev.mockResolvedValue({
      ok: true,
      latencyMs: 20,
      answers: {
        identity_0: { type: 'score', score: 1.9, confidence: 0.61 },
        name_match_0: { type: 'noul', noul: 0.96 },
        scope_conflict_0: { type: 'noul', noul: 0.02 },
      },
    });

    await expect(resolveWikiIdentityWithJev(input, [candidate], settings)).resolves.toMatchObject({
      kind: 'uncertain',
      provider: 'jev',
    });
  });

  it('treats incomplete typed answers as Jev unavailable so the coordinator can fall back', async () => {
    callJev.mockResolvedValue({
      ok: true,
      latencyMs: 20,
      answers: { identity_0: { type: 'score', score: 2, confidence: 1 } },
    });

    await expect(resolveWikiIdentityWithJev(input, [candidate], settings)).resolves.toEqual({
      kind: 'unavailable',
      reason: 'malformed_response',
    });
  });

  it('treats multiple high-confidence matches as uncertain', async () => {
    const secondCandidate = { ...candidate, filename: 'pages/AI/rag.md', title: 'RAG' };
    callJev.mockResolvedValue({
      ok: true,
      latencyMs: 20,
      answers: {
        identity_0: { type: 'score', score: 1.9, confidence: 0.95 },
        name_match_0: { type: 'noul', noul: 0.96 },
        scope_conflict_0: { type: 'noul', noul: 0.02 },
        identity_1: { type: 'score', score: 1.9, confidence: 0.95 },
        name_match_1: { type: 'noul', noul: 0.96 },
        scope_conflict_1: { type: 'noul', noul: 0.02 },
      },
    });

    await expect(
      resolveWikiIdentityWithJev(input, [candidate, secondCandidate], settings),
    ).resolves.toMatchObject({ kind: 'uncertain', reason: 'multiple_candidates_matched' });
  });
});
