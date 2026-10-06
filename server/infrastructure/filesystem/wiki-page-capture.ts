import { exec } from 'child_process';
import { browserFetch } from '../../infrastructure/network/browser-fetch.js';

/**
 * URL 页面抓取结果。
 */
export interface WikiPageCaptureResult {
  url: string;
  finalUrl?: string;
  title?: string;
  mode: 'html' | 'text';
  content: string;
  source: 'electron' | 'browserFetch' | 'curl';
}

/**
 * 页面抓取能力抽象。
 */
export interface PageCaptureProvider {
  capture(url: string, options?: WikiPageCaptureOptions): Promise<WikiPageCaptureResult>;
}

/**
 * 页面抓取选项。
 */
export interface WikiPageCaptureOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

type CaptureMode = WikiPageCaptureResult['mode'];

let pageCaptureProvider: PageCaptureProvider | null = null;

/**
 * 注册优先页面抓取实现。
 */
export function setPageCaptureProvider(provider: PageCaptureProvider | null): void {
  pageCaptureProvider = provider;
}

/**
 * 抓取 URL 页面内容。
 * 优先使用注册的 provider，失败后回退到 browserFetch，再回退到 curl。
 */
export async function captureWikiPage(
  url: string,
  options: WikiPageCaptureOptions = {},
): Promise<WikiPageCaptureResult> {
  const providerResult = await tryProvider(url, options);
  if (providerResult) return providerResult;

  const browserFetchResult = await tryBrowserFetch(url, options);
  if (browserFetchResult) return browserFetchResult;

  const curlResult = await tryCurl(url, options);
  if (curlResult) return curlResult;

  throw new Error(`无法抓取 URL 内容: ${url}`);
}

async function tryProvider(
  url: string,
  options: WikiPageCaptureOptions,
): Promise<WikiPageCaptureResult | null> {
  if (!pageCaptureProvider) return null;

  try {
    const result = await pageCaptureProvider.capture(url, options);
    if (result?.content && result.content.trim()) {
      return result;
    }
  } catch (err) {
    console.warn(`[wikiPageCapture] provider failed for ${url}: ${(err as Error).message}`);
  }

  return null;
}

async function tryBrowserFetch(
  url: string,
  options: WikiPageCaptureOptions,
): Promise<WikiPageCaptureResult | null> {
  try {
    const response = await browserFetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: options.timeoutMs ?? 10000,
      signal: options.signal,
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();
    if (!body.trim()) return null;

    return {
      url,
      finalUrl: response.url || url,
      mode: inferMode(contentType, body),
      content: body,
      source: 'browserFetch',
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`抓取超时: ${url}`);
    }
    return null;
  }
}

async function tryCurl(
  url: string,
  options: WikiPageCaptureOptions,
): Promise<WikiPageCaptureResult | null> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      exec(
        `curl -sL --max-time ${Math.max(5, Math.ceil((options.timeoutMs ?? 15000) / 1000))} -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' ${JSON.stringify(url)}`,
        { timeout: options.timeoutMs ?? 20000, maxBuffer: 1024 * 1024 },
        (error, stdoutValue) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdoutValue || '');
        },
      );
    });
    if (!stdout || !stdout.trim()) return null;

    return {
      url,
      mode: inferMode('', stdout),
      content: stdout,
      source: 'curl',
    };
  } catch {
    return null;
  }
}

function inferMode(contentType: string, content: string): CaptureMode {
  const normalizedType = contentType.toLowerCase();
  if (normalizedType.includes('html') || normalizedType.includes('xml')) return 'html';
  if (normalizedType.includes('json')) return 'text';
  if (/<(?:html|body|article|main|div|p|h[1-6]|table|ul|ol)\b/i.test(content)) return 'html';
  return 'text';
}
