import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJevMemoryGateProvider } from '../jevMemoryGateProvider.js';
import type { JevSettings } from '../../../types.js';

const JEV: JevSettings = {
  apiUrl: 'https://api.typesafe.ai/v1/systemone',
  apiKey: 'test-key',
  model: 'jev-latest',
  timeoutMs: 3_000,
  routingEnabled: false,
  routingMinConfidence: 0.5,
  routingBypassOnKeyword: true,
  memoryEnabled: true,
  memoryGateThreshold: 0.4,
};

const CONFIG = { jev: JEV };
const provider = createJevMemoryGateProvider();

/** 让 fetch 返回一个带 `answers` 的 Jev 响应。 */
function stubAnswers(answers: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(JSON.stringify({ model: 'jev-latest', answers }), { status: 200 }),
    ),
  );
}

/** 四个问题的完整答案，`worth` 可覆盖。 */
function fullAnswers(worth: number, overrides: Record<string, unknown> = {}) {
  return {
    worth: { type: 'noul', noul: worth },
    category: { type: 'choice', choice: 'project', confidence: 0.8 },
    importance: { type: 'score', score: 3, legend: [], confidence: 0.7 },
    action: { type: 'choice', choice: 'ADD', confidence: 0.9 },
    ...overrides,
  };
}

describe('jevMemoryGateProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // fetch 是进程级全局：必须在每个用例后恢复，否则 stub 会泄漏到同线程的后续测试文件。
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('memorizes above the threshold and carries the classification as a hint', async () => {
    stubAnswers(fullAnswers(0.9));

    const outcome = await provider.evaluate({ userContent: '我住在杭州' }, CONFIG);

    expect(outcome).toEqual({
      kind: 'memorize',
      hint: { category: 'project', importance: 3, action: 'ADD', confidence: 0.7, worth: 0.9 },
    });
  });

  it('skips when the noul value is below the configured threshold', async () => {
    stubAnswers(fullAnswers(0.39));

    await expect(provider.evaluate({ userContent: '谢谢你' }, CONFIG)).resolves.toEqual({
      kind: 'skip',
      reason: 'not_worth_remembering',
    });
  });

  it('accepts a value exactly on the threshold', async () => {
    stubAnswers(fullAnswers(0.4));
    const outcome = await provider.evaluate({ userContent: '我住在杭州' }, CONFIG);
    expect(outcome.kind).toBe('memorize');
  });

  it('treats a missing worth answer as unavailable rather than as a skip', async () => {
    stubAnswers({ category: { type: 'choice', choice: 'personal', confidence: 0.8 } });

    await expect(provider.evaluate({ userContent: '我住在杭州' }, CONFIG)).resolves.toMatchObject({
      kind: 'unavailable',
      reason: 'malformed_response',
    });
  });

  it('falls back to safe defaults when the auxiliary answers are missing', async () => {
    stubAnswers({ worth: { type: 'noul', noul: 0.95 } });

    const outcome = await provider.evaluate({ userContent: '我住在杭州' }, CONFIG);

    expect(outcome).toEqual({
      kind: 'memorize',
      hint: { category: 'general', importance: 0.5, action: 'ADD', confidence: 0, worth: 0.95 },
    });
  });

  it('rejects an action that is not one of the four write actions', async () => {
    stubAnswers(
      fullAnswers(0.9, { action: { type: 'choice', choice: 'UPSERT', confidence: 0.9 } }),
    );

    const outcome = await provider.evaluate({ userContent: '我住在杭州' }, CONFIG);

    expect(outcome).toMatchObject({ kind: 'memorize', hint: { action: 'ADD' } });
  });

  it('reports unavailable when the API key is not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await provider.evaluate(
      { userContent: '我住在杭州' },
      {
        jev: { ...JEV, apiKey: '' },
      },
    );

    expect(outcome).toMatchObject({ kind: 'unavailable', reason: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports unavailable on an invalid key response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );

    await expect(provider.evaluate({ userContent: '我住在杭州' }, CONFIG)).resolves.toMatchObject({
      kind: 'unavailable',
      reason: 'invalid_key',
    });
  });
});
