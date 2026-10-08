import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../infrastructure/network/browser-fetch.js', () => ({
  browserFetch: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import { browserFetch } from '../../../infrastructure/network/browser-fetch.js';
import { exec } from 'child_process';
import { captureWikiPage, setPageCaptureProvider } from '../wiki-page-capture.js';

const mockedBrowserFetch = vi.mocked(browserFetch);
const mockedExec = vi.mocked(exec);

beforeEach(() => {
  setPageCaptureProvider(null);
  mockedBrowserFetch.mockReset();
  mockedExec.mockReset();
});

afterEach(() => {
  setPageCaptureProvider(null);
});

describe('wikiPageCapture', () => {
  it('uses registered provider first', async () => {
    setPageCaptureProvider({
      capture: async (url) => ({
        url,
        finalUrl: url,
        mode: 'html',
        content: '<html><body>provider</body></html>',
        source: 'electron',
      }),
    });

    const result = await captureWikiPage('https://example.com/a');
    expect(result.source).toBe('electron');
    expect(result.content).toContain('provider');
  });

  it('falls back to browserFetch when provider is absent', async () => {
    mockedBrowserFetch.mockResolvedValue({
      ok: true,
      url: 'https://example.com/b',
      text: async () => '<html><body>fallback</body></html>',
      headers: new Headers({ 'content-type': 'text/html' }),
    } as any);

    const result = await captureWikiPage('https://example.com/b');
    expect(result.source).toBe('browserFetch');
    expect(result.mode).toBe('html');
  });

  it('falls back to curl when browserFetch fails', async () => {
    mockedBrowserFetch.mockRejectedValue(new Error('network error'));
    mockedExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      cb(null, '<html><body>curl</body></html>', '');
      return {} as any;
    });

    const result = await captureWikiPage('https://example.com/c');
    expect(result.source).toBe('curl');
    expect(result.content).toContain('curl');
  });

  it('throws when all capture paths fail', async () => {
    mockedBrowserFetch.mockRejectedValue(new Error('network error'));
    mockedExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      cb(new Error('curl error'), '', '');
      return {} as any;
    });

    await expect(captureWikiPage('https://example.com/d')).rejects.toThrow('无法抓取 URL 内容');
  });
});
