import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAdapter, registerAdapter } from '../../../../infrastructure/ai/adapters/api-adapter.js';
import type { ApiAdapter } from '../../../../infrastructure/ai/adapters/api-adapter.js';
import type { AiSettings, JevSettings } from '../../../../types.js';
import { resolveWikiIdentityWithLlm } from '../llm-provider.js';
import type {
  WikiIdentityCandidate,
  WikiIdentityInput,
  WikiIdentityResolverOptions,
} from '../types.js';

const API_TYPE = 'wiki-identity-test-adapter';
const adapter = { call: vi.fn() } as unknown as ApiAdapter;

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
  jevEnabled: false,
  jevSettings: {} as JevSettings,
  aiSettings: {
    apiUrl: 'https://llm.example/v1',
    apiKey: 'secret',
    modelId: 'test-model',
    apiType: API_TYPE,
  } as AiSettings,
};

describe('resolveWikiIdentityWithLlm', () => {
  afterEach(() => adapter.call.mockReset());

  it('accepts a match only when the target path is a listed candidate', async () => {
    registerAdapter(API_TYPE, adapter);
    adapter.call.mockResolvedValue(
      JSON.stringify({ decision: 'match', targetPath: candidate.filename }),
    );

    await expect(resolveWikiIdentityWithLlm(input, [candidate], settings)).resolves.toEqual({
      kind: 'match',
      provider: 'llm',
      targetPath: candidate.filename,
    });
  });

  it('rejects a model-generated path outside the candidate set', async () => {
    registerAdapter(API_TYPE, adapter);
    adapter.call.mockResolvedValue(
      JSON.stringify({ decision: 'match', targetPath: 'pages/../../secrets.md' }),
    );

    await expect(resolveWikiIdentityWithLlm(input, [candidate], settings)).resolves.toEqual({
      kind: 'unavailable',
      reason: 'target_outside_candidate_set',
    });
  });

  it('returns uncertain for malformed output or a failed provider call', async () => {
    registerAdapter(API_TYPE, adapter);
    adapter.call.mockResolvedValue('not json');
    await expect(resolveWikiIdentityWithLlm(input, [candidate], settings)).resolves.toEqual({
      kind: 'unavailable',
      reason: 'malformed_response',
    });

    adapter.call.mockRejectedValue(new Error('provider unavailable'));
    await expect(resolveWikiIdentityWithLlm(input, [candidate], settings)).resolves.toEqual({
      kind: 'unavailable',
      reason: 'llm_request_failed',
    });
    expect(getAdapter(API_TYPE)).toBe(adapter);
  });
});
