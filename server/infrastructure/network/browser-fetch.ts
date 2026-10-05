/**
 * 使用 undici 实现的浏览器风格 HTTP 请求工具
 * - 使用 undici 替代 Node.js 原生 fetch，避免网页端被拦截
 * - 添加模仿 Chrome 浏览器的完整请求头
 * - 支持超时、自定义 headers、请求体
 */

import { fetch, Response, type Dispatcher, type RequestInit } from 'undici';
import type { Response as UndiciResponse } from 'undici';
import {
  createPublicDispatcher,
  HttpTargetBlockedError,
  resolvePublicAddresses,
  type PublicLookup,
} from './http-target-policy.js';

// ── 浏览器请求头模板 ──

export interface BrowserFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  signal?: AbortSignal;
  /** Internal policy used only by http_fetch; omitted for existing callers. */
  targetPolicy?: 'public-only';
  /** Resolver injection for deterministic security tests. */
  publicLookup?: PublicLookup;
}

/**
 * 生成模仿 Chrome 131 浏览器的完整请求头
 * 不覆盖用户显式传入的自定义 headers
 */
function buildBrowserHeaders(customHeaders?: Record<string, string>): Record<string, string> {
  const browserHeaders: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not=A?Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    DNT: '1',
  };

  // 若用户指定了自定义 User-Agent，则不覆盖
  if (customHeaders) {
    for (const [key, value] of Object.entries(customHeaders)) {
      const lower = key.toLowerCase();
      // 用户自定义 headers 覆盖浏览器默认（不区分大小写）
      const matchedKey = Object.keys(browserHeaders).find((k) => k.toLowerCase() === lower);
      if (matchedKey) {
        browserHeaders[matchedKey] = value;
      } else {
        browserHeaders[key] = value;
      }
    }
  }

  return browserHeaders;
}

/**
 * 使用 undici 发起浏览器风格的 HTTP 请求
 * 自动添加完整的浏览器请求头，让目标服务器难以区分请求来源
 *
 * @param url - 请求 URL
 * @param options - 请求选项
 * @returns Response 对象（undici Response，与标准 Response 兼容）
 *
 * @example
 * ```ts
 * const res = await browserFetch('https://example.com');
 * const text = await res.text();
 * ```
 *
 * @example
 * ```ts
 * const res = await browserFetch('https://api.example.com/data', {
 *   method: 'POST',
 *   headers: { 'Authorization': 'Bearer xxx' },
 *   body: JSON.stringify({ key: 'value' }),
 *   timeout: 15000,
 * });
 * ```
 */
export async function browserFetch(
  url: string,
  options: BrowserFetchOptions = {},
): Promise<UndiciResponse> {
  const {
    method = 'GET',
    headers: customHeaders,
    body,
    timeout = 30000,
    signal: externalSignal,
    targetPolicy,
    publicLookup,
  } = options;

  const initialUrl = new URL(url);
  if (targetPolicy === 'public-only' && !['http:', 'https:'].includes(initialUrl.protocol)) {
    const error = new HttpTargetBlockedError(initialUrl.hostname, 'scheme');
    console.warn(`[browserFetch] ${error.message}`);
    throw error;
  }

  // 合并浏览器头 + 自定义头
  const finalHeaders = buildBrowserHeaders(customHeaders);

  // 自动处理 Content-Type
  if (body && ['POST', 'PUT', 'PATCH'].includes(method) && !customHeaders?.['Content-Type']) {
    finalHeaders['Content-Type'] = 'application/json';
  }

  // 超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // 合并外部 signal（支持请求取消）
  const signal = externalSignal
    ? combineAbortSignals([externalSignal, controller.signal])
    : controller.signal;

  try {
    if (method === 'GET' && body) {
      console.warn(`[browserFetch] GET request with body — body will be ignored`);
    }
    return targetPolicy === 'public-only'
      ? await fetchPublicOnly(initialUrl, method, finalHeaders, body, signal, publicLookup)
      : await fetch(url, {
          method,
          headers: finalHeaders,
          signal,
          ...(body && ['POST', 'PUT', 'PATCH'].includes(method) ? { body } : {}),
        });
  } catch (err) {
    if (err instanceof HttpTargetBlockedError) {
      console.warn(`[browserFetch] ${err.message}`);
      throw err;
    }
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw new Error(`HTTP request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

interface RedirectState {
  currentUrl: URL;
  currentMethod: string;
  currentBody?: string;
}

function createRedirectState(url: URL, method: string, body?: string): RedirectState {
  return { currentUrl: url, currentMethod: method, currentBody: body };
}

async function fetchPublicOnly(
  initialUrl: URL,
  initialMethod: string,
  headers: Record<string, string>,
  initialBody: string | undefined,
  signal: AbortSignal,
  lookup?: PublicLookup,
): Promise<Response> {
  const state = createRedirectState(initialUrl, initialMethod, initialBody);

  for (let redirectCount = 0; ; redirectCount += 1) {
    await resolvePublicAddresses(state.currentUrl.hostname, lookup);
    const dispatcher = createPublicDispatcher(lookup);
    let keepDispatcherOpen = false;
    try {
      const requestInit: RequestInit = {
        method: state.currentMethod,
        headers,
        signal,
        redirect: 'manual',
        dispatcher,
        ...(state.currentBody && ['POST', 'PUT', 'PATCH'].includes(state.currentMethod)
          ? { body: state.currentBody }
          : {}),
      };
      const response = await fetch(state.currentUrl, requestInit);
      const location = response.headers.get('location');
      if (!location || !REDIRECT_STATUS_CODES.has(response.status)) {
        keepDispatcherOpen = true;
        return retainDispatcherUntilBodyConsumed(response, dispatcher);
      }
      await discardResponseBody(response);
      if (redirectCount >= MAX_REDIRECTS) {
        throw new HttpTargetBlockedError(state.currentUrl.hostname, 'redirect');
      }
      try {
        state.currentUrl = new URL(location, state.currentUrl);
      } catch {
        throw new HttpTargetBlockedError(state.currentUrl.hostname, 'redirect');
      }
      if (!['http:', 'https:'].includes(state.currentUrl.protocol)) {
        throw new HttpTargetBlockedError(state.currentUrl.hostname, 'scheme');
      }
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && state.currentMethod === 'POST')
      ) {
        state.currentMethod = 'GET';
        state.currentBody = undefined;
      }
    } finally {
      if (!keepDispatcherOpen) {
        void dispatcher.close().catch(() => undefined);
      }
    }
  }
}

async function discardResponseBody(response: UndiciResponse): Promise<void> {
  if (!response.body) return;
  await response.body.cancel().catch(() => undefined);
}

function retainDispatcherUntilBodyConsumed(
  response: UndiciResponse,
  dispatcher: Dispatcher,
): UndiciResponse {
  if (!response.body) {
    void dispatcher.close().catch(() => undefined);
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          await dispatcher.close();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
        await dispatcher.close().catch(() => undefined);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      await dispatcher.close().catch(() => undefined);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * 合并多个 AbortSignal
 */
function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener(
      'abort',
      () => {
        controller.abort(signal.reason);
      },
      { once: true },
    );
  }

  return controller.signal;
}
