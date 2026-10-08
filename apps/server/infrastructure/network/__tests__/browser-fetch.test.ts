import { describe, expect, it, vi, afterEach } from 'vitest';

// browserFetch wraps undici's fetch — it's a thin wrapper
// We test that it calls through and handles errors

vi.mock('undici', () => ({
  fetch: vi.fn(),
  Agent: vi.fn(),
  ProxyAgent: vi.fn(),
}));

import { browserFetch } from '../browser-fetch.js';
import { fetch as undiciFetch } from 'undici';

describe('browserFetch', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls undici fetch with URL', async () => {
    const mockResponse = { ok: true, status: 200, text: vi.fn().mockResolvedValue('ok') };
    vi.mocked(undiciFetch).mockResolvedValue(mockResponse as any);

    const result = await browserFetch('https://example.com');
    expect(result).toBe(mockResponse);
    expect(undiciFetch).toHaveBeenCalledWith('https://example.com', expect.any(Object));
  });

  it('handles fetch errors', async () => {
    vi.mocked(undiciFetch).mockRejectedValue(new Error('network error'));

    await expect(browserFetch('https://example.com')).rejects.toThrow('network error');
  });

  it('passes custom headers', async () => {
    const mockResponse = { ok: true, status: 200, text: vi.fn().mockResolvedValue('ok') };
    vi.mocked(undiciFetch).mockResolvedValue(mockResponse as any);

    await browserFetch('https://example.com', {
      method: 'POST',
      headers: { 'X-Custom': 'value' },
      body: 'test body',
    });

    expect(undiciFetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Custom': 'value' }),
      }),
    );
  });
});
