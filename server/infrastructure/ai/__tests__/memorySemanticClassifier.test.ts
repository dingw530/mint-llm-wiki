import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemorySemanticClassifier } from '../memorySemanticClassifier.js';
import { DISABLED_JEV_SETTINGS } from '../../../services/jev/config.js';
import * as settingsService from '../../../services/api/settingsService.js';
import type { JevCallResult, JevConfig, JevRequest } from '../../../services/jev/types.js';

const input = {
  memoryKey: 'language',
  subject: 'user',
  content: '偏好中文回答',
  userSourceText: '请用中文回答',
};

function setup() {
  const callJev = vi.fn(
    async (_config: JevConfig, _request: JevRequest): Promise<JevCallResult> => ({
      ok: true,
      latencyMs: 1,
      answers: { semantic_type: { type: 'choice', choice: 'response_language', confidence: 0.95 } },
    }),
  );
  const complete = vi.fn(async () => '{"kind":"response_language","confidence":0.9}');
  const dependencies = {
    getAiSettings: () => ({
      ...settingsService.getAiSettings(),
      apiUrl: 'https://llm.invalid',
      apiKey: 'fixture',
    }),
    getJevSettings: () => ({
      ...DISABLED_JEV_SETTINGS,
      memoryEnabled: true,
      apiUrl: 'https://jev.invalid',
      apiKey: 'fixture',
      model: 'jev',
    }),
    extractionClient: { complete },
    callJev,
    timeoutMs: 100,
  };
  return { callJev, complete, dependencies };
}

afterEach(() => vi.useRealTimers());

describe('Jev / LLM memory semantic classifier', () => {
  it('uses Jev success and supplies key, content, subject and source as data', async () => {
    const { dependencies, callJev, complete } = setup();
    expect(
      await createMemorySemanticClassifier(dependencies).classify(
        input,
        new AbortController().signal,
      ),
    ).toMatchObject({ kind: 'response_language', provider: 'jev' });
    expect(complete).not.toHaveBeenCalled();
    expect(callJev.mock.calls[0][1].state).toMatchObject({
      memory_key: 'language',
      user_source: '请用中文回答',
      subject: 'user',
    });
  });

  it.each([
    ['other', 0.95],
    ['uncertain', 0.95],
    ['response_language', 0.3],
  ] as const)('does not overturn Jev %s at %s confidence', async (choice, confidence) => {
    const { dependencies, callJev, complete } = setup();
    callJev.mockResolvedValue({
      ok: true,
      latencyMs: 1,
      answers: { semantic_type: { type: 'choice', choice, confidence } },
    });
    const decision = await createMemorySemanticClassifier(dependencies).classify(
      input,
      new AbortController().signal,
    );
    expect(decision.kind).toBe(choice === 'response_language' ? 'uncertain' : choice);
    expect(complete).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'rate_limited', 'not_configured', 'network_error'] as const)(
    'falls back on Jev %s',
    async (reason) => {
      const { dependencies, callJev, complete } = setup();
      callJev.mockResolvedValue({ ok: false, reason, message: 'fixture', latencyMs: 1 });
      expect(
        await createMemorySemanticClassifier(dependencies).classify(
          input,
          new AbortController().signal,
        ),
      ).toMatchObject({ provider: 'llm', confidence: 0.9 });
      expect(complete).toHaveBeenCalledOnce();
    },
  );

  it('uses LLM when the Jev memory feature is disabled', async () => {
    const { dependencies, callJev } = setup();
    dependencies.getJevSettings = () => ({ ...DISABLED_JEV_SETTINGS });
    expect(
      (
        await createMemorySemanticClassifier(dependencies).classify(
          input,
          new AbortController().signal,
        )
      ).provider,
    ).toBe('llm');
    expect(callJev).not.toHaveBeenCalled();
  });

  it('falls back on malformed or thrown Jev responses', async () => {
    const { dependencies, callJev } = setup();
    callJev
      .mockResolvedValueOnce({ ok: true, latencyMs: 1, answers: {} })
      .mockRejectedValueOnce(new Error('offline'));
    const classifier = createMemorySemanticClassifier(dependencies);
    for (let i = 0; i < 2; i++)
      expect((await classifier.classify(input, new AbortController().signal)).provider).toBe('llm');
  });

  it.each([
    'not-json',
    '{"kind":"invented","confidence":0.9}',
    '{"kind":"response_language","confidence":2}',
    '{"kind":"response_language","confidence":"0.9"}',
  ])('abstains on invalid LLM output %s', async (content) => {
    const { dependencies, callJev, complete } = setup();
    callJev.mockResolvedValue({ ok: true, latencyMs: 1, answers: {} });
    complete.mockResolvedValue(content);
    expect(
      await createMemorySemanticClassifier(dependencies).classify(
        input,
        new AbortController().signal,
      ),
    ).toEqual({ kind: 'uncertain', confidence: 0, provider: 'unavailable' });
  });

  it('keeps low LLM confidence separate from extraction confidence', async () => {
    const { dependencies, callJev, complete } = setup();
    callJev.mockResolvedValue({ ok: true, latencyMs: 1, answers: {} });
    complete.mockResolvedValue('{"kind":"response_language","confidence":0.4}');
    expect(
      await createMemorySemanticClassifier(dependencies).classify(
        input,
        new AbortController().signal,
      ),
    ).toEqual({ kind: 'uncertain', confidence: 0.4, provider: 'llm' });
  });

  it('bounds a stuck transport and avoids further calls on timeout', async () => {
    vi.useFakeTimers();
    const { dependencies, callJev, complete } = setup();
    callJev.mockImplementation(() => new Promise(() => {}));
    const work = createMemorySemanticClassifier(dependencies).classify(
      input,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(101);
    expect((await work).provider).toBe('unavailable');
    expect(complete).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start LLM when cancelled during Jev', async () => {
    const { dependencies, callJev, complete } = setup();
    const controller = new AbortController();
    callJev.mockImplementation(async () => {
      controller.abort();
      return { ok: true, latencyMs: 1, answers: {} };
    });
    await expect(
      createMemorySemanticClassifier(dependencies).classify(input, controller.signal),
    ).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
});
