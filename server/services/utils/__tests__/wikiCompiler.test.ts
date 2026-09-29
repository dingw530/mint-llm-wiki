import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adapter = { call: vi.fn() };

vi.mock('../../adapters/apiAdapter.js', () => ({
  getAdapter: vi.fn(() => adapter),
}));

import { compileSource } from '../wikiCompiler.js';

const settings = {
  apiUrl: 'https://example.com/v1',
  apiKey: 'test-key',
  modelId: 'test-model',
  apiType: 'openai-chat',
  systemPrompt: '',
  thinkingMode: false,
  memoryEnabled: false,
  reactMaxIterations: 3,
  toolMaxRetries: 1,
  showReactSteps: true,
  maxContextRounds: 10,
  wikiPath: '',
  wikiMaxFileSize: 1_000_000,
};

function createWikiFixture(): string {
  const wikiPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-wiki-compiler-'));
  fs.mkdirSync(path.join(wikiPath, 'pages'), { recursive: true });
  fs.writeFileSync(
    path.join(wikiPath, '_schema.json'),
    JSON.stringify({ categories: ['concepts'] }),
  );
  return wikiPath;
}

describe('compileSource', () => {
  let wikiPath: string;

  beforeEach(() => {
    wikiPath = createWikiFixture();
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(wikiPath, { recursive: true, force: true });
  });

  it('compiles AI output into a categorized page and index', async () => {
    adapter.call.mockResolvedValue(
      JSON.stringify({
        pages: [
          {
            filename: 'pages/concepts/Type Safety.md',
            title: 'Type Safety',
            tags: ['typescript'],
            content: 'Use explicit boundaries.\n\nsource text',
          },
        ],
        claims: [{ pageTitle: 'Type Safety', text: 'source text', evidenceQuote: 'source text' }],
        relationships: [],
        summary: 'created one page',
      }),
    );

    const result = await compileSource(settings, wikiPath, 'source text', 'notes.md');

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].filename).toBe('pages/concepts/Type-Safety.md');
    expect(result.pages[0].summary).toBe('Use explicit boundaries.');
    expect(fs.readFileSync(path.join(wikiPath, result.pages[0].filename), 'utf8')).toContain(
      'title: Type Safety',
    );
    expect(fs.readFileSync(path.join(wikiPath, '_index.md'), 'utf8')).toContain('Type Safety');
  });

  it('reports real compilation stages in execution order', async () => {
    adapter.call.mockResolvedValue(
      JSON.stringify({
        pages: [
          {
            filename: 'pages/concepts/stages.md',
            title: 'Stages',
            tags: [],
            content: 'source text',
          },
        ],
        claims: [{ pageTitle: 'Stages', text: 'source text', evidenceQuote: 'source text' }],
        relationships: [],
        summary: 'stages',
      }),
    );
    const stages: string[] = [];

    await compileSource(settings, wikiPath, 'source text', 'stages.md', {
      onProgress: (stage) => stages.push(stage),
    });

    expect(stages).toEqual(['prepare', 'evidence', 'pages']);
  });

  it('can return a normalized compiler snapshot without writing pages or the index', async () => {
    adapter.call.mockResolvedValue(
      JSON.stringify({
        pages: [
          {
            filename: 'pages/concepts/Stable Page.md',
            title: 'Stable Page',
            tags: [],
            content: 'source text',
          },
        ],
        claims: [{ pageTitle: 'Stable Page', text: 'source text', evidenceQuote: 'source text' }],
        relationships: [],
        summary: 'stable snapshot',
      }),
    );

    const result = await compileSource(settings, wikiPath, 'source text', 'notes.md', {
      persistPages: false,
    });

    expect(result.compiledPages[0].filename).toBe('pages/concepts/Stable-Page.md');
    expect(result.pages[0].filename).toBe('pages/concepts/Stable-Page.md');
    expect(fs.existsSync(path.join(wikiPath, result.pages[0].filename))).toBe(false);
    expect(fs.existsSync(path.join(wikiPath, '_index.md'))).toBe(false);
  });

  it('passes the larger output budget for long sources', async () => {
    adapter.call.mockResolvedValue(
      JSON.stringify({
        pages: [
          { filename: 'pages/concepts/long.md', title: 'Long', tags: [], content: 'source text' },
        ],
        claims: [{ pageTitle: 'Long', text: 'source text', evidenceQuote: 'source text' }],
        relationships: [],
        summary: 'long source',
      }),
    );

    await compileSource(settings, wikiPath, 'source text'.repeat(1000), 'long.md');

    expect(adapter.call).toHaveBeenCalledWith(
      expect.any(Array),
      { modelId: 'test-model' },
      'https://example.com/v1',
      'test-key',
      { maxTokens: 8192, temperature: 0.3, thinking: false },
    );
  });

  it('retries an empty long-source response with the default budget', async () => {
    adapter.call.mockResolvedValueOnce('').mockResolvedValueOnce(
      JSON.stringify({
        pages: [
          { filename: 'pages/concepts/retry.md', title: 'Retry', tags: [], content: 'source text' },
        ],
        claims: [{ pageTitle: 'Retry', text: 'source text', evidenceQuote: 'source text' }],
        relationships: [],
        summary: 'retry',
      }),
    );

    await compileSource(settings, wikiPath, 'source text'.repeat(1000), 'long.md');

    expect(adapter.call).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      { modelId: 'test-model' },
      'https://example.com/v1',
      'test-key',
      { maxTokens: 4096, temperature: 0.3, thinking: false },
    );
  });

  it('retries a failed long-source response with the default budget', async () => {
    adapter.call.mockRejectedValueOnce(new Error('request timed out')).mockResolvedValueOnce(
      JSON.stringify({
        pages: [
          {
            filename: 'pages/concepts/timeout.md',
            title: 'Timeout',
            tags: [],
            content: 'source text',
          },
        ],
        claims: [{ pageTitle: 'Timeout', text: 'source text', evidenceQuote: 'source text' }],
        relationships: [],
        summary: 'timeout retry',
      }),
    );

    await compileSource(settings, wikiPath, 'source text'.repeat(1000), 'long.md');

    expect(adapter.call).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      { modelId: 'test-model' },
      'https://example.com/v1',
      'test-key',
      { maxTokens: 4096, temperature: 0.3, thinking: false },
    );
  });

  it('deduplicates a page whose title already exists', async () => {
    fs.mkdirSync(path.join(wikiPath, 'pages', 'concepts'), { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'concepts', 'existing.md'),
      '---\ntitle: Existing Concept\n---\n\nold',
    );
    adapter.call.mockResolvedValue(
      JSON.stringify({
        pages: [
          {
            filename: 'pages/concepts/new.md',
            title: 'Existing Concept',
            tags: [],
            content: 'duplicate',
          },
        ],
        claims: [
          { pageTitle: 'Existing Concept', text: 'source text', evidenceQuote: 'source text' },
        ],
        relationships: [],
        summary: 'deduplicated',
      }),
    );

    const result = await compileSource(settings, wikiPath, 'source text', 'notes.md');

    expect(result.pages).toEqual([]);
    expect(result.relationships).toEqual([
      expect.objectContaining({
        source: 'Existing Concept',
        target: 'Existing Concept',
        relation: '属于',
      }),
    ]);
  });

  it('rejects compiled pages without claims before writing', async () => {
    adapter.call.mockResolvedValue(
      JSON.stringify({
        pages: [
          { filename: 'pages/concepts/unsafe.md', title: 'Unsafe', tags: [], content: 'invented' },
        ],
        relationships: [],
        summary: 'unsafe',
      }),
    );

    await expect(compileSource(settings, wikiPath, 'source text', 'notes.md')).rejects.toThrow(
      'AI 未返回可验证的 Wiki Claim',
    );
    expect(fs.existsSync(path.join(wikiPath, 'pages', 'concepts', 'unsafe.md'))).toBe(false);
    expect(fs.existsSync(path.join(wikiPath, '_index.md'))).toBe(false);
  });

  it('extracts claims in a second call when page compilation omits them', async () => {
    adapter.call
      .mockResolvedValueOnce(
        JSON.stringify({
          pages: [
            {
              filename: 'pages/concepts/recovered.md',
              title: 'Recovered',
              tags: [],
              content: 'source text',
            },
          ],
          relationships: [],
          summary: 'pages only',
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          pages: [],
          claims: [{ pageTitle: 'Recovered', text: 'source text', evidenceQuote: 'source text' }],
          relationships: [],
          summary: 'claims',
        }),
      );

    const result = await compileSource(settings, wikiPath, 'source text', 'notes.md');

    expect(result.claims).toEqual([expect.objectContaining({ pageTitle: 'Recovered' })]);
    expect(adapter.call).toHaveBeenCalledTimes(2);
  });

  it('uses a low-confidence source-only fallback for invalid long-source claims', async () => {
    adapter.call.mockResolvedValue(
      JSON.stringify({
        pages: [
          {
            filename: 'pages/concepts/fallback.md',
            title: 'Fallback',
            tags: [],
            content: 'source text',
          },
        ],
        relationships: [],
        summary: 'pages only',
      }),
    );

    const result = await compileSource(settings, wikiPath, 'source text'.repeat(1000), 'long.md');

    expect(result.claims[0]).toMatchObject({ pageTitle: 'Fallback', confidence: 0.2 });
  });

  it('rejects claims whose evidence is absent from the source', async () => {
    adapter.call.mockResolvedValue(
      JSON.stringify({
        pages: [
          { filename: 'pages/concepts/unsafe.md', title: 'Unsafe', tags: [], content: 'invented' },
        ],
        claims: [{ pageTitle: 'Unsafe', text: 'invented fact', evidenceQuote: 'not in source' }],
        relationships: [],
        summary: 'unsafe',
      }),
    );

    await expect(compileSource(settings, wikiPath, 'source text', 'notes.md')).rejects.toThrow(
      '证据不在原始资料中',
    );
    expect(fs.existsSync(path.join(wikiPath, 'pages', 'concepts', 'unsafe.md'))).toBe(false);
    expect(fs.existsSync(path.join(wikiPath, '_index.md'))).toBe(false);
  });

  it('rejects claims that point to a page not in the compiled result', async () => {
    adapter.call.mockResolvedValue(
      JSON.stringify({
        pages: [
          { filename: 'pages/concepts/known.md', title: 'Known', tags: [], content: 'source text' },
        ],
        claims: [{ pageTitle: 'Unknown', text: 'source text', evidenceQuote: 'source text' }],
        relationships: [],
        summary: 'unsafe',
      }),
    );

    await expect(compileSource(settings, wikiPath, 'source text', 'notes.md')).rejects.toThrow(
      'Claim 指向不存在的页面',
    );
    expect(fs.existsSync(path.join(wikiPath, 'pages', 'concepts', 'known.md'))).toBe(false);
    expect(fs.existsSync(path.join(wikiPath, '_index.md'))).toBe(false);
  });

  it('preserves uncovered lead facts in the most relevant compiled page', async () => {
    adapter.call.mockResolvedValue(
      JSON.stringify({
        pages: [
          {
            filename: 'pages/concepts/dingtalk.md',
            title: '钉钉的敏捷与秩序',
            tags: ['钉钉'],
            content: '钉钉强调敏捷协作。',
          },
        ],
        claims: [
          {
            pageTitle: '钉钉的敏捷与秩序',
            text: '钉钉强调敏捷协作',
            evidenceQuote: '钉钉强调敏捷协作。',
          },
        ],
        relationships: [],
        summary: '钉钉页面',
      }),
    );

    const result = await compileSource(
      settings,
      wikiPath,
      '钉钉的动物园形象钉三多，是一只尖尾雨燕。\n钉钉强调敏捷协作。',
      'dingtalk.md',
    );

    expect(result.compiledPages[0].content).toContain('钉钉的动物园形象钉三多，是一只尖尾雨燕。');
  });

  it('rejects malformed AI output before writing pages', async () => {
    adapter.call.mockResolvedValue('not json');

    await expect(compileSource(settings, wikiPath, 'source text', 'notes.md')).rejects.toThrow(
      'AI 返回格式异常',
    );
    expect(fs.existsSync(path.join(wikiPath, '_index.md'))).toBe(false);
  });
});
