import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import { afterAll, describe, expect, it } from 'vitest';

process.env.AI_CHAT_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.AI_CHAT_DB_PATH = '/tmp/ai-chat-cors-test.db';
delete process.env.AI_CHAT_CLIENT_DIST;

const { createApp, createClientAssetRateLimiter, isAllowedCorsOrigin } = await import('../app.js');

const clientDistPath = mkdtempSync(path.join(os.tmpdir(), 'mint-client-dist-'));
writeFileSync(
  path.join(clientDistPath, 'index.html'),
  '<!doctype html><title>Mint test app</title>',
);

afterAll(() => {
  rmSync(clientDistPath, { force: true, recursive: true });
});

/**
 * Run a callback against an ephemeral HTTP server.
 * @param app Express application under test
 * @param callback Callback that receives the server URL
 * @returns Callback result
 */
async function withTestServer<T>(app: Express, callback: (url: string) => Promise<T>): Promise<T> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Test server did not expose a TCP address');
  }

  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('CORS policy', () => {
  it('allows the development client origin', async () => {
    expect(isAllowedCorsOrigin('http://localhost:5800')).toBe(true);
  });

  it('does not grant CORS headers to an unrelated origin', async () => {
    expect(isAllowedCorsOrigin('https://untrusted.example')).toBe(false);
  });
});

describe('production client asset delivery', () => {
  it('serves the SPA fallback for non-API routes', async () => {
    const previousClientDist = process.env.AI_CHAT_CLIENT_DIST;
    process.env.AI_CHAT_CLIENT_DIST = clientDistPath;

    try {
      await withTestServer(createApp(), async (url) => {
        const response = await fetch(`${url}/workspace/123`);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('Mint test app');
      });
    } finally {
      if (previousClientDist === undefined) delete process.env.AI_CHAT_CLIENT_DIST;
      else process.env.AI_CHAT_CLIENT_DIST = previousClientDist;
    }
  });

  it('rate-limits repeated client asset requests', async () => {
    const previousClientDist = process.env.AI_CHAT_CLIENT_DIST;
    process.env.AI_CHAT_CLIENT_DIST = clientDistPath;

    try {
      await withTestServer(createApp(), async (url) => {
        const responses = await Promise.all(
          Array.from({ length: 121 }, () => fetch(`${url}/workspace/123`)),
        );
        const statuses = await Promise.all(
          responses.map(async (response) => {
            await response.text();
            return response.status;
          }),
        );
        expect(statuses.filter((status) => status === 429)).toHaveLength(1);
        expect(
          responses.find((response) => response.status === 429)?.headers.get('ratelimit'),
        ).toContain('r=0');
      });
    } finally {
      if (previousClientDist === undefined) delete process.env.AI_CHAT_CLIENT_DIST;
      else process.env.AI_CHAT_CLIENT_DIST = previousClientDist;
    }
  });

  it('does not rate-limit API requests', async () => {
    const app = express();
    app.use(createClientAssetRateLimiter());
    app.get('/api/test', (_req, res) => res.sendStatus(200));

    await withTestServer(app, async (url) => {
      const responses = await Promise.all(
        Array.from({ length: 121 }, () => fetch(`${url}/api/test`)),
      );
      await Promise.all(responses.map((response) => response.text()));
      expect(responses.every((response) => response.status === 200)).toBe(true);
    });
  });
});
