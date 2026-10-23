import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adapter = { call: vi.fn() };
const resolveWikiPageIdentity = vi.hoisted(() => vi.fn());

vi.mock('../../../infrastructure/ai/adapters/api-adapter.js', () => ({
  getAdapter: vi.fn(() => adapter),
}));
vi.mock('../identity/wiki-identity-resolver.js', () => ({ resolveWikiPageIdentity }));

import { compileSource, prepareExistingWikiPageMerge } from '../wiki-compiler.js';

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
    adapter.call.mockReset();
    resolveWikiPageIdentity.mockReset().mockResolvedValue({ kind: 'different', provider: 'llm' });
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

  it('maps an exact title to the existing path and keeps old and new page content', async () => {
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

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toMatchObject({
      filename: 'pages/concepts/existing.md',
      title: 'Existing Concept',
    });
    const savedPage = fs.readFileSync(path.join(wikiPath, result.pages[0].filename), 'utf-8');
    expect(savedPage).toContain('old');
    expect(savedPage).toContain('duplicate');
    expect(resolveWikiPageIdentity).not.toHaveBeenCalled();
  });

  it('maps an exact existing alias to its canonical page and remaps claims and relationships', async () => {
    fs.mkdirSync(path.join(wikiPath, 'pages', 'concepts'), { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'concepts', 'retrieval-augmented-generation.md'),
      '---\ntitle: Retrieval-Augmented Generation\naliases: [RAG]\n---\n\nold',
    );
    adapter.call.mockResolvedValue(
      JSON.stringify({
        pages: [
          {
            filename: 'pages/concepts/rag.md',
            title: 'RAG',
            tags: [],
            content: 'source text',
          },
          {
            filename: 'pages/concepts/embeddings.md',
            title: 'Embeddings',
            tags: [],
            content: 'source text',
          },
        ],
        claims: [
          { pageTitle: 'RAG', text: 'source text', evidenceQuote: 'source text' },
          { pageTitle: 'Embeddings', text: 'source text', evidenceQuote: 'source text' },
        ],
        relationships: [{ source: 'RAG', target: 'Embeddings', relation: '相关于' }],
        summary: 'alias match',
      }),
    );

    const result = await compileSource(settings, wikiPath, 'source text', 'notes.md');

    expect(result.pages.map((page) => page.filename)).toContain(
      'pages/concepts/retrieval-augmented-generation.md',
    );
    expect(result.compiledPages.map((page) => page.title)).toContain(
      'Retrieval-Augmented Generation',
    );
    expect(result.claims.find((claim) => claim.text === 'source text')?.pageTitle).toBe(
      'Retrieval-Augmented Generation',
    );
    expect(result.relationships).toContainEqual({
      source: 'Retrieval-Augmented Generation',
      target: 'Embeddings',
      relation: '相关于',
    });
    expect(
      fs.readFileSync(
        path.join(wikiPath, 'pages/concepts/retrieval-augmented-generation.md'),
        'utf-8',
      ),
    ).toContain('aliases: ["RAG"]');
  });

  it('recalls and unions a separate Top-K candidate set for each title and alias', async () => {
    const pagesDir = path.join(wikiPath, 'pages', 'concepts');
    fs.mkdirSync(pagesDir, { recursive: true });
    const existingTitles = [
      ...['A', 'B', 'C', 'D', 'E', 'F'].map((suffix) => `AlphaProject ${suffix}`),
      ...['A', 'B', 'C', 'D', 'E', 'F'].map((suffix) => `BetaProject ${suffix}`),
    ];
    existingTitles.forEach((title, index) => {
      const slug = title.replace(/\s+/g, '-').toLowerCase();
      fs.writeFileSync(
        path.join(pagesDir, `${slug}.md`),
        `---\ntitle: ${title}\n---\n\nexisting content ${index}`,
      );
    });
    adapter.call.mockResolvedValue(
      JSON.stringify({
        pages: [
          {
            filename: 'pages/concepts/portfolio.md',
            title: 'Portfolio',
            aliases: ['AlphaProject', 'BetaProject', 'Alpha Project'],
            tags: [],
            content: 'source text',
          },
        ],
        claims: [{ pageTitle: 'Portfolio', text: 'source text', evidenceQuote: 'source text' }],
        relationships: [],
        summary: 'candidate recall',
      }),
    );

    await compileSource(settings, wikiPath, 'source text', 'notes.md');

    const candidates = resolveWikiPageIdentity.mock.calls[0]?.[1];
    expect(candidates).toHaveLength(10);
    expect(candidates?.map((candidate) => candidate.title)).toEqual(
      expect.arrayContaining([
        'AlphaProject A',
        'AlphaProject B',
        'AlphaProject C',
        'AlphaProject D',
        'AlphaProject E',
        'BetaProject A',
        'BetaProject B',
        'BetaProject C',
        'BetaProject D',
        'BetaProject E',
      ]),
    );
    expect(candidates?.map((candidate) => candidate.filename)).toHaveLength(
      new Set(candidates?.map((candidate) => candidate.filename)).size,
    );
  });

  it('prepares an existing-page merge with the same exact-alias target without writing files', async () => {
    const pagesDir = path.join(wikiPath, 'pages', 'concepts');
    fs.mkdirSync(pagesDir, { recursive: true });
    const targetPath = 'pages/concepts/canonical.md';
    const sourcePath = 'pages/concepts/source-alias.md';
    const targetMarkdown = '---\ntitle: Canonical\naliases: [Source Alias]\n---\n\ntarget body';
    const sourceMarkdown = '---\ntitle: Source Alias\n---\n\nsource body';
    fs.writeFileSync(path.join(wikiPath, targetPath), targetMarkdown);
    fs.writeFileSync(path.join(wikiPath, sourcePath), sourceMarkdown);
    adapter.call.mockResolvedValue(
      '---\ntitle: Canonical\naliases: [Source Alias]\n---\n\ntarget body\n\nsource body',
    );

    const plan = await prepareExistingWikiPageMerge(settings, wikiPath, sourcePath);

    expect(plan.decision).toEqual({
      kind: 'match',
      targetPath,
      provider: 'deterministic',
    });
    expect(plan.candidates.map((candidate) => candidate.filename)).toEqual([targetPath]);
    expect(plan.mergedTargetPage).toMatchObject({ filename: targetPath, title: 'Canonical' });
    expect(plan.mergedTargetPage?.content).toContain('target body');
    expect(plan.mergedTargetPage?.content).toContain('source body');
    expect(fs.readFileSync(path.join(wikiPath, targetPath), 'utf8')).toBe(targetMarkdown);
    expect(fs.readFileSync(path.join(wikiPath, sourcePath), 'utf8')).toBe(sourceMarkdown);
    expect(resolveWikiPageIdentity).not.toHaveBeenCalled();
  });

  it('coalesces multiple alias matches into one update without dropping either page body', async () => {
    fs.mkdirSync(path.join(wikiPath, 'pages', 'concepts'), { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'concepts', 'canonical.md'),
      '---\ntitle: Canonical Concept\naliases: [Alias A, Alias B]\n---\n\nold body',
    );
    adapter.call.mockResolvedValue(
      JSON.stringify({
        pages: [
          {
            filename: 'pages/concepts/alias-a.md',
            title: 'Alias A',
            tags: ['a'],
            content: 'fact from alias A',
          },
          {
            filename: 'pages/concepts/alias-b.md',
            title: 'Alias B',
            tags: ['b'],
            content: 'fact from alias B',
          },
        ],
        claims: [
          { pageTitle: 'Alias A', text: 'claim A', evidenceQuote: 'source text' },
          { pageTitle: 'Alias B', text: 'claim B', evidenceQuote: 'source text' },
        ],
        relationships: [],
        summary: 'two aliases',
      }),
    );

    const result = await compileSource(settings, wikiPath, 'source text', 'notes.md');

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].filename).toBe('pages/concepts/canonical.md');
    expect(result.claims.map((claim) => claim.pageTitle)).toEqual([
      'Canonical Concept',
      'Canonical Concept',
    ]);
    const savedPage = fs.readFileSync(path.join(wikiPath, result.pages[0].filename), 'utf-8');
    expect(savedPage).toContain('old body');
    expect(savedPage).toContain('fact from alias A');
    expect(savedPage).toContain('fact from alias B');
  });

  it('keeps a title-similar page when the identity resolver says it is different', async () => {
    fs.mkdirSync(path.join(wikiPath, 'pages', 'concepts'), { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'concepts', 'new.md'),
      '---\ntitle: Existing Concept\n---\n\nold',
    );
    adapter.call
      .mockResolvedValueOnce(
        JSON.stringify({
          pages: [
            {
              filename: 'pages/concepts/new.md',
              title: 'Existing Concept v2',
              tags: [],
              content: 'source text',
            },
          ],
          claims: [
            { pageTitle: 'Existing Concept v2', text: 'source text', evidenceQuote: 'source text' },
          ],
          relationships: [],
          summary: 'different page',
        }),
      )
      .mockResolvedValueOnce(JSON.stringify({ decision: 'different' }));

    const result = await compileSource(settings, wikiPath, 'source text', 'notes.md', {
      jevSettings: {
        apiUrl: 'https://typesafe.example/v1/systemone',
        apiKey: 'secret',
        model: 'jev-test',
        timeoutMs: 1000,
        routingEnabled: false,
        routingMinConfidence: 0.5,
        routingBypassOnKeyword: true,
        memoryEnabled: false,
        memoryGateThreshold: 0.4,
        wikiIdentityEnabled: true,
      },
    });

    expect(resolveWikiPageIdentity).toHaveBeenCalledOnce();
    expect(resolveWikiPageIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Existing Concept v2' }),
      expect.arrayContaining([expect.objectContaining({ title: 'Existing Concept' })]),
      expect.objectContaining({ jevEnabled: true }),
      { jev: undefined },
    );
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].filename).toMatch(/^pages\/concepts\/new-[a-f0-9]{8}\.md$/);
    expect(result.pages[0].title).toBe('Existing Concept v2');
    expect(fs.readFileSync(path.join(wikiPath, result.pages[0].filename), 'utf-8')).toContain(
      'source text',
    );
    expect(fs.readFileSync(path.join(wikiPath, 'pages/concepts/new.md'), 'utf-8')).toContain('old');
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
