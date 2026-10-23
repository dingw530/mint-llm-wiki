import { describe, expect, it, vi } from 'vitest';
import type { AiSettings, JevSettings } from '../../../../types.js';
import { resolveWikiPageIdentity } from '../wiki-identity-resolver.js';
import type {
  WikiIdentityCandidate,
  WikiIdentityInput,
  WikiIdentityResolverOptions,
} from '../types.js';

const input: WikiIdentityInput = {
  title: '检索增强生成',
  category: 'AI',
  aliases: ['RAG'],
  tags: ['retrieval'],
  summary: '一种结合检索与生成的技术。',
  content: '新资料中的定义和说明。',
};

const candidates: WikiIdentityCandidate[] = [
  {
    filename: 'pages/AI/RAG.md',
    title: 'Retrieval-Augmented Generation',
    category: 'AI',
    aliases: ['RAG'],
    tags: ['retrieval'],
    summary: 'Grounds generation in retrieved evidence.',
  },
];

const aiSettings = {
  apiUrl: 'https://llm.example/v1',
  apiKey: 'secret',
  modelId: 'test-model',
  apiType: 'openai-chat',
} as AiSettings;

const jevSettings = {
  apiUrl: 'https://typesafe.example/v1/systemone',
  apiKey: 'secret',
  model: 'jev-test',
  timeoutMs: 1000,
} as JevSettings;

const settings: WikiIdentityResolverOptions = {
  jevEnabled: true,
  jevSettings,
  aiSettings,
};

describe('resolveWikiPageIdentity', () => {
  it('uses Jev when enabled and does not invoke LLM for a valid uncertain judgment', async () => {
    const jev = vi.fn().mockResolvedValue({
      kind: 'uncertain',
      provider: 'jev',
      reason: 'confidence_below_merge_gate',
    });
    const llm = vi.fn();

    const result = await resolveWikiPageIdentity(input, candidates, settings, { jev, llm });

    expect(result).toMatchObject({ kind: 'uncertain', provider: 'jev' });
    expect(jev).toHaveBeenCalledOnce();
    expect(llm).not.toHaveBeenCalled();
  });

  it('uses LLM when Jev is disabled', async () => {
    const jev = vi.fn();
    const llm = vi.fn().mockResolvedValue({
      kind: 'match',
      targetPath: candidates[0].filename,
      provider: 'llm',
    });

    const result = await resolveWikiPageIdentity(
      input,
      candidates,
      { ...settings, jevEnabled: false },
      { jev, llm },
    );

    expect(result).toMatchObject({
      kind: 'match',
      provider: 'llm',
      targetPath: candidates[0].filename,
      fallbackReason: 'jev_disabled',
    });
    expect(jev).not.toHaveBeenCalled();
    expect(llm).toHaveBeenCalledOnce();
  });

  it('falls back to LLM when Jev is unavailable', async () => {
    const jev = vi.fn().mockResolvedValue({ kind: 'unavailable', reason: 'timeout' });
    const llm = vi.fn().mockResolvedValue({ kind: 'different', provider: 'llm' });

    const result = await resolveWikiPageIdentity(input, candidates, settings, { jev, llm });

    expect(result).toMatchObject({
      kind: 'different',
      provider: 'llm',
      fallbackReason: 'timeout',
    });
    expect(jev).toHaveBeenCalledOnce();
    expect(llm).toHaveBeenCalledOnce();
  });

  it('returns uncertain when Jev and LLM are both unavailable', async () => {
    const jev = vi.fn().mockResolvedValue({ kind: 'unavailable', reason: 'network_error' });
    const llm = vi.fn().mockResolvedValue({ kind: 'unavailable', reason: 'llm_request_failed' });

    const result = await resolveWikiPageIdentity(input, candidates, settings, { jev, llm });

    expect(result).toMatchObject({
      kind: 'uncertain',
      provider: 'llm',
      reason: 'llm_request_failed',
      fallbackReason: 'network_error',
    });
  });

  it('does not invoke providers without candidates', async () => {
    const jev = vi.fn();
    const llm = vi.fn();

    const result = await resolveWikiPageIdentity(input, [], settings, { jev, llm });

    expect(result).toEqual({ kind: 'different', provider: 'deterministic' });
    expect(jev).not.toHaveBeenCalled();
    expect(llm).not.toHaveBeenCalled();
  });
});
