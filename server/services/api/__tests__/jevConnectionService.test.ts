import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testJevConnection } from '../jevConnectionService.js';

const INPUT = {
  apiUrl: 'https://api.typesafe.ai/v1/systemone',
  apiKey: 'test-key',
  model: 'jev-latest',
};

/** 让 fetch 返回指定的状态与请求体。 */
function stubFetch(status: number, body: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('testJevConnection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // fetch 是进程级全局：必须在每个用例后恢复，否则 stub 会泄漏到同线程的后续测试文件。
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports success for a usable endpoint', async () => {
    stubFetch(200, JSON.stringify({ answers: { reachable: { type: 'noul', noul: 1 } } }));

    await expect(testJevConnection(INPUT)).resolves.toEqual({
      success: true,
      message: 'Jev 连接成功',
    });
  });

  it('reports a readable message for an invalid key', async () => {
    stubFetch(401, '{}');

    await expect(testJevConnection(INPUT)).resolves.toEqual({
      success: false,
      message: 'Jev API Key 无效',
    });
  });

  it('reports a readable message when the endpoint is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    await expect(testJevConnection(INPUT)).resolves.toEqual({
      success: false,
      message: 'Jev 端点不可达或返回异常状态',
    });
  });

  it('reports a readable message for rate limiting', async () => {
    stubFetch(429, '{}');

    await expect(testJevConnection(INPUT)).resolves.toMatchObject({
      success: false,
      message: 'Jev 触发限流，请稍后重试',
    });
  });

  it('refuses to call out without a key', async () => {
    const fetchMock = stubFetch(200, '{"answers":{}}');

    await expect(testJevConnection({ ...INPUT, apiKey: '  ' })).resolves.toEqual({
      success: false,
      message: 'Jev API Key 未配置',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an empty endpoint without calling out', async () => {
    const fetchMock = stubFetch(200, '{"answers":{}}');

    await expect(testJevConnection({ ...INPUT, apiUrl: '' })).resolves.toEqual({
      success: false,
      message: 'Jev Endpoint 不能为空',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws on a malformed response', async () => {
    stubFetch(200, 'not json');

    await expect(testJevConnection(INPUT)).resolves.toMatchObject({ success: false });
  });
});
