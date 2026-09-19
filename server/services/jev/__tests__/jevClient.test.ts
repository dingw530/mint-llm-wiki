import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callJev, classifyJevStatus, parseJevAnswers } from '../jevClient.js';
import type { JevConfig, JevRequest } from '../types.js';

const CONFIG: JevConfig = {
  apiUrl: 'https://api.typesafe.ai/v1/systemone',
  apiKey: 'test-key',
  model: 'jev-latest',
  timeoutMs: 3_000,
};

const REQUEST: JevRequest = {
  state: 'hello',
  model: 'jev-latest',
  questions: {
    worth: {
      type: 'noul',
      instructions: 'Is it worth remembering?',
      criteria: { true: 'yes', false: 'no' },
    },
  },
};

/** 构造带指定 `name` 的错误，用于模拟 fetch 的超时与取消。 */
function errorNamed(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('parseJevAnswers', () => {
  it('returns undefined when answers is not an object', () => {
    expect(parseJevAnswers(undefined)).toBeUndefined();
    expect(parseJevAnswers(null)).toBeUndefined();
    expect(parseJevAnswers([])).toBeUndefined();
    expect(parseJevAnswers('nope')).toBeUndefined();
  });

  it('accepts an empty answers map without throwing', () => {
    expect(parseJevAnswers({})).toEqual({});
  });

  it('skips a key whose structure is invalid instead of failing the whole response', () => {
    const answers = parseJevAnswers({
      worth: { type: 'noul', noul: 0.9 },
      broken_choice: { type: 'choice' },
      unknown_type: { type: 'ranking', rank: 1 },
      not_an_object: 'nope',
    });
    expect(answers).toEqual({ worth: { type: 'noul', noul: 0.9 } });
  });

  it('defaults a missing confidence to zero rather than trusting the answer', () => {
    const answers = parseJevAnswers({ agent: { type: 'choice', choice: 'a1' } });
    expect(answers?.agent).toEqual({ type: 'choice', choice: 'a1', confidence: 0 });
  });

  it('clamps probabilities into the unit interval', () => {
    const answers = parseJevAnswers({
      agent: { type: 'choice', choice: 'a1', confidence: 1.4 },
      worth: { type: 'noul', noul: -0.2 },
    });
    expect(answers?.agent).toMatchObject({ confidence: 1 });
    expect(answers?.worth).toMatchObject({ noul: 0 });
  });

  it('keeps score answers with a non-array legend by falling back to an empty legend', () => {
    const answers = parseJevAnswers({
      importance: { type: 'score', score: 2.5, legend: 'moderate', confidence: 0.7 },
    });
    expect(answers?.importance).toEqual({
      type: 'score',
      score: 2.5,
      legend: [],
      confidence: 0.7,
    });
  });
});

describe('classifyJevStatus', () => {
  it('maps the documented error codes to audit reasons', () => {
    expect(classifyJevStatus(401)).toBe('invalid_key');
    expect(classifyJevStatus(422)).toBe('invalid_request');
    expect(classifyJevStatus(429)).toBe('rate_limited');
    expect(classifyJevStatus(529)).toBe('overloaded');
  });

  it('falls back to network_error for uncategorized statuses', () => {
    expect(classifyJevStatus(500)).toBe('network_error');
    expect(classifyJevStatus(404)).toBe('network_error');
  });
});

describe('callJev', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // fetch 是进程级全局：必须在每个用例后恢复，否则 stub 会泄漏到同线程的后续测试文件。
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not issue a request when the API key is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await callJev({ ...CONFIG, apiKey: '' }, REQUEST);

    expect(result).toMatchObject({ ok: false, reason: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not issue a request when the endpoint is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await callJev({ ...CONFIG, apiUrl: '' }, REQUEST);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns normalized answers and sends the bearer token', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: 'jev-latest',
            answers: { worth: { type: 'noul', noul: 0.82 } },
            usage: { input_tokens: 12, output_tokens: 3 },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callJev(CONFIG, REQUEST);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.answers.worth).toEqual({ type: 'noul', noul: 0.82 });
    expect(fetchMock).toHaveBeenCalledWith(
      CONFIG.apiUrl,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
      }),
    );
  });

  it('reports malformed_response when the payload has no usable answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"model":"x"}', { status: 200 })),
    );

    await expect(callJev(CONFIG, REQUEST)).resolves.toMatchObject({
      ok: false,
      reason: 'malformed_response',
    });
  });

  it('retries rate limited responses and succeeds on the second attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ answers: { worth: { type: 'noul', noul: 0.7 } } }), {
          status: 200,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callJev(CONFIG, REQUEST);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry an invalid key', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callJev(CONFIG, REQUEST)).resolves.toMatchObject({
      ok: false,
      reason: 'invalid_key',
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up when the backoff would exceed the total budget', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callJev({ ...CONFIG, timeoutMs: 300 }, REQUEST);

    expect(result).toMatchObject({ ok: false, reason: 'rate_limited' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps a timeout to the timeout reason instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw errorNamed('TimeoutError', 'The operation was aborted due to timeout');
      }),
    );

    await expect(callJev({ ...CONFIG, timeoutMs: 300 }, REQUEST)).resolves.toMatchObject({
      ok: false,
      reason: 'timeout',
    });
  });

  it('maps a network failure to network_error instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    await expect(callJev(CONFIG, REQUEST)).resolves.toMatchObject({
      ok: false,
      reason: 'network_error',
    });
  });

  it('bounds the total wall clock even when every attempt is rate limited', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 529 }));
    vi.stubGlobal('fetch', fetchMock);

    const startedAt = Date.now();
    const result = await callJev({ ...CONFIG, timeoutMs: 900 }, REQUEST);
    const elapsed = Date.now() - startedAt;

    expect(result).toMatchObject({ ok: false, reason: 'overloaded' });
    expect(elapsed).toBeLessThan(1_500);
  });
});
