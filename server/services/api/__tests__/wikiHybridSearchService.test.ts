import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAiSettings = vi.hoisted(() => vi.fn());
const getJevSettings = vi.hoisted(() => vi.fn());

vi.mock('../settingsService.js', () => ({ getAiSettings, getJevSettings }));

import { searchWiki } from '../wikiSearchService.js';

const tempDirs: string[] = [];

function vector(index: number): number[] {
  const values = Array.from({ length: 1024 }, () => 0);
  values[index] = 1;
  return values;
}

function response(vectors: number[][]): {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
} {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: vectors.map((embedding, index) => ({ index, embedding })) }),
  };
}

describe('wiki hybrid search', () => {
  beforeEach(() => {
    getJevSettings.mockReturnValue({
      apiUrl: '',
      apiKey: '',
      model: '',
      timeoutMs: 0,
      routingEnabled: false,
      routingMinConfidence: 0,
      routingBypassOnKeyword: false,
      memoryEnabled: false,
      memoryGateThreshold: 0,
      rerankEnabled: false,
    });
    getAiSettings.mockReturnValue({
      apiUrl: '',
      apiKey: '',
      modelId: '',
      apiType: 'openai-chat',
      systemPrompt: '',
      thinkingMode: false,
      memoryEnabled: false,
      reactMaxIterations: 5,
      toolMaxRetries: 5,
      showReactSteps: true,
      maxContextRounds: 10,
      wikiPath: '',
      wikiMaxFileSize: 1024,
      wikiSearchMode: 'hybrid',
      embeddingApiUrl: 'http://127.0.0.1:11434/v1',
      embeddingModel: 'bge-m3',
      embeddingDimensions: 1024,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const directory of tempDirs.splice(0))
      fs.rmSync(directory, { recursive: true, force: true });
  });

  it('returns semantic-only candidates with vector match metadata', async () => {
    const wikiPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-hybrid-'));
    tempDirs.push(wikiPath);
    fs.mkdirSync(path.join(wikiPath, 'pages'), { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'alpha.md'),
      '# Alpha\n\nAn unrelated lexical phrase.',
    );
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'beta.md'),
      '# Beta\n\nSemantic retrieval target.',
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response([vector(0)]))
        .mockResolvedValueOnce(response([vector(1)]))
        .mockResolvedValueOnce(response([vector(1)])),
    );

    const result = await searchWiki(wikiPath, '语义问题', 5, false);

    expect(result.results[0]).toMatchObject({ file: 'pages/beta.md' });
    expect(result.results[0].matchTypes).toContain('vector');
    expect(result.results[0].matchTypes).not.toContain('keyword-fallback');
  });

  it('marks keyword fallback when the embedding service fails', async () => {
    const wikiPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-hybrid-fallback-'));
    tempDirs.push(wikiPath);
    fs.mkdirSync(path.join(wikiPath, 'pages'), { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'fallback.md'),
      '# Fallback\n\nFTS fallback content.',
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const result = await searchWiki(wikiPath, 'fallback', 5, false);

    expect(result.results[0].matchTypes).toContain('keyword-fallback');
    expect(result.message).toContain('降级');
  });
});
