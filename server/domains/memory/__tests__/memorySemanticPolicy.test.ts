import { describe, expect, it, vi } from 'vitest';
import { canonicalMemoryKey, normalizeMemoryOperations } from '../memorySemanticPolicy.js';
import type { MemorySemanticDecision, MemorySemanticInput } from '../memorySemanticPolicy.js';

const messages = [{ id: 'u1', role: 'user', content: '请用中文回答', createdAt: '' }];

describe('memory semantic policy', () => {
  it.each([
    ['response_language', 'preference.response_language'],
    ['response_style', 'preference.response_style'],
    ['occupation', 'personal.occupation'],
    ['timezone', 'personal.timezone'],
  ] as const)('maps semantic type %s to a standard key', (kind, key) => {
    expect(canonicalMemoryKey({ kind, confidence: 0.8, provider: 'jev' })).toBe(key);
  });

  it.each(['other', 'uncertain'] as const)('does not authorize %s', (kind) => {
    expect(canonicalMemoryKey({ kind, confidence: 1, provider: 'llm' })).toBeNull();
  });

  it.each([0.79, NaN, Infinity, 1.1])('rejects unsafe confidence %s', (confidence) => {
    expect(
      canonicalMemoryKey({ kind: 'response_language', confidence, provider: 'jev' }),
    ).toBeNull();
  });

  it('normalizes an alias without changing subject, source, scope or the original operation', async () => {
    const operation = {
      action: 'UPDATE' as const,
      memoryKey: 'user.preferred_language',
      subject: 'user',
      content: '偏好中文回答',
      sourceMessageId: 'u1',
    };
    const classify = vi.fn(
      async (_input: MemorySemanticInput): Promise<MemorySemanticDecision> => ({
        kind: 'response_language',
        confidence: 0.9,
        provider: 'jev',
      }),
    );
    const [resolved] = await normalizeMemoryOperations(
      [operation],
      messages,
      { classify },
      new AbortController().signal,
    );
    expect(resolved.memoryKey).toBe('preference.response_language');
    expect(resolved.subject).toBe('user');
    expect(operation.memoryKey).toBe('user.preferred_language');
    expect(classify.mock.calls[0][0]).toMatchObject({ userSourceText: '请用中文回答' });
  });

  it('does not treat assistant content as user evidence and keeps original key on failure', async () => {
    const classify = vi.fn(async (_input: MemorySemanticInput) => {
      throw new Error('unavailable');
    });
    const [operation] = await normalizeMemoryOperations(
      [{ action: 'ADD', memoryKey: 'language', content: '中文', sourceMessageId: 'u1' }],
      [{ ...messages[0], role: 'assistant' }],
      { classify },
      new AbortController().signal,
    );
    expect(classify.mock.calls[0][0]).toMatchObject({ userSourceText: null });
    expect(operation.memoryKey).toBe('language');
    expect(operation.semanticDecision?.provider).toBe('unavailable');
  });

  it('does not start classification after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const classify = vi.fn();
    await expect(
      normalizeMemoryOperations([{ action: 'ADD' }], messages, { classify }, controller.signal),
    ).rejects.toThrow();
    expect(classify).not.toHaveBeenCalled();
  });
});
