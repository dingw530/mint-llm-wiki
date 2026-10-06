import { afterEach, describe, expect, it, vi } from 'vitest';

const { dispatchers, fetchMock } = vi.hoisted(() => ({
  dispatchers: [] as Array<{ close: ReturnType<typeof vi.fn> }>,
  fetchMock: vi.fn(),
}));

vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  return {
    ...actual,
    fetch: fetchMock,
    Agent: vi.fn(() => {
      const dispatcher = { close: vi.fn().mockResolvedValue(undefined) };
      dispatchers.push(dispatcher);
      return dispatcher;
    }),
  };
});

import { browserFetch } from '../browser-fetch.js';

describe('browserFetch public-only security boundary', () => {
  afterEach(() => {
    fetchMock.mockReset();
    dispatchers.length = 0;
    vi.restoreAllMocks();
  });

  it('uses a dedicated manual redirect dispatcher for every hop', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/next' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const response = await browserFetch('https://public.example/start', {
      targetPolicy: 'public-only',
      publicLookup: async () => [{ address: '8.8.8.8', family: 4 }],
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(fetchMock.mock.calls[0][1].dispatcher).toBeDefined();
    expect(fetchMock.mock.calls[1][1].dispatcher).toBeDefined();
    expect(dispatchers).toHaveLength(2);
    expect(dispatchers[0].close).toHaveBeenCalled();
    await response.text();
    expect(dispatchers[1].close).toHaveBeenCalled();
  });

  it('keeps default callers on the existing fetch path', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await browserFetch('https://public.example/start');
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('dispatcher');
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('redirect');
    expect(dispatchers).toHaveLength(0);
  });

  it('rejects private IPv6 literals before fetch and allows public IPv6 literals', async () => {
    await expect(
      browserFetch('https://[::1]/', { targetPolicy: 'public-only' }),
    ).rejects.toMatchObject({ code: 'HTTP_TARGET_BLOCKED', reason: 'address' });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const response = await browserFetch('https://[2001:4860:4860::8888]/', {
      targetPolicy: 'public-only',
      publicLookup: async () => [{ address: '2001:4860:4860::8888', family: 6 }],
    });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects a private redirect before issuing the next fetch', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://private.example/next' } }),
    );
    await expect(
      browserFetch('https://public.example/start', {
        targetPolicy: 'public-only',
        publicLookup: async (hostname) =>
          hostname === 'private.example'
            ? [{ address: '192.168.1.1', family: 4 }]
            : [{ address: '8.8.8.8', family: 4 }],
      }),
    ).rejects.toMatchObject({ code: 'HTTP_TARGET_BLOCKED', reason: 'address' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('closes the final dispatcher when the response body is cancelled', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const response = await browserFetch('https://public.example/start', {
      targetPolicy: 'public-only',
      publicLookup: async () => [{ address: '8.8.8.8', family: 4 }],
    });
    await response.body?.cancel();
    expect(dispatchers[0].close).toHaveBeenCalled();
  });

  it('cancels redirect bodies before closing the old dispatcher', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    fetchMock
      .mockResolvedValueOnce(new Response(stream, { status: 302, headers: { location: '/next' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const response = await browserFetch('https://public.example/start', {
      targetPolicy: 'public-only',
      publicLookup: async () => [{ address: '8.8.8.8', family: 4 }],
    });
    await response.text();
    expect(cancel).toHaveBeenCalled();
    expect(dispatchers[0].close).toHaveBeenCalled();
  });

  it.each([
    ['301', 301, 'POST', 'GET'],
    ['302', 302, 'POST', 'GET'],
    ['303', 303, 'PUT', 'GET'],
    ['307', 307, 'POST', 'POST'],
    ['308', 308, 'POST', 'POST'],
  ])('%s preserves Fetch redirect method semantics', async (_name, status, method, nextMethod) => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status, headers: { location: '/next' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await browserFetch('https://public.example/start', {
      method,
      body: 'secret-body',
      targetPolicy: 'public-only',
      publicLookup: async () => [{ address: '8.8.8.8', family: 4 }],
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: nextMethod });
    if (nextMethod === 'GET') expect(fetchMock.mock.calls[1][1]).not.toHaveProperty('body');
    else expect(fetchMock.mock.calls[1][1].body).toBe('secret-body');
  });

  it('rejects redirect loops after five hops', async () => {
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 302, headers: { location: '/next' } }),
    );
    await expect(
      browserFetch('https://public.example/start', {
        targetPolicy: 'public-only',
        publicLookup: async () => [{ address: '8.8.8.8', family: 4 }],
      }),
    ).rejects.toMatchObject({ code: 'HTTP_TARGET_BLOCKED', reason: 'redirect' });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('logs safe target rejection details without URL or request secrets', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      browserFetch('ftp://user:pass@private.example/path?token=secret#fragment', {
        targetPolicy: 'public-only',
      }),
    ).rejects.toMatchObject({ code: 'HTTP_TARGET_BLOCKED' });
    const message = warning.mock.calls.map(([value]) => String(value)).join('\n');
    expect(message).toContain('HTTP_TARGET_BLOCKED');
    expect(message).toContain('hostname=private.example');
    expect(message).not.toMatch(/user|pass|token|secret|fragment|Authorization/);
  });
});
