import { afterAll, describe, it, expect } from 'vitest';
import type { CompiledPage } from '../wikiShared.js';
import {
  normalizeWikiSchema,
  getWikiPageSummary,
  tryParseLooseJson,
  writeWikiPages,
  updateIndexMd,
  appendWikiManifestEntry,
  readWikiManifest,
} from '../wikiShared.js';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';

describe('normalizeWikiSchema', () => {
  it('兼容旧版字符串分类并转换为结构化定义', () => {
    const schema = normalizeWikiSchema({
      categories: ['实践', { name: '概念', description: '术语', include: ['定义'] }],
    });

    expect(schema.categories).toEqual([
      { name: '实践', description: '', include: [], exclude: [] },
      { name: '概念', description: '术语', include: ['定义'], exclude: [] },
    ]);
  });
});

describe('getWikiPageSummary', () => {
  it('提取首个有效段落并跳过标题', () => {
    expect(getWikiPageSummary('# Title\n\nFirst paragraph\n\nSecond paragraph')).toBe(
      'First paragraph',
    );
    expect(getWikiPageSummary('## Title\n\n- First item')).toBe('First item');
  });

  it('没有正文时返回空字符串', () => {
    expect(getWikiPageSummary('  \n\n```\ncode\n```')).toBe('');
  });
});

describe('tryParseLooseJson', () => {
  it('解析标准 JSON', () => {
    const input = JSON.stringify({
      pages: [
        {
          filename: 'pages/test/cat.md',
          title: 'Test',
          tags: ['tag1'],
          created: '2026-06-23',
          source: 'src.txt',
          content: '# Title\n\nBody\n',
        },
      ],
    });
    const result = tryParseLooseJson(input);
    expect(result).not.toBeNull();
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].content).toContain('\n');
    expect(result.pages[0].content).not.toContain('\\n');
  });

  it('解析 AI 返回的带真实换行符的非标准 JSON（内容中有未转义换行）', () => {
    // 模拟 AI 返回：JSON 结构中的 content 值包含真实换行符（不符合 JSON 标准）
    const input = `{
  "pages": [
    {
      "filename": "pages/ai/test.md",
      "title": "标题",
      "tags": ["标签1", "标签2"],
      "created": "2026-06-23",
      "source": "source.txt",
      "content": "# 第一章

## 1.1 背景

这是正文内容。

## 1.2 要点

- 要点一
- 要点二"
    }
  ],
  "summary": "测试"
}`;
    const result = tryParseLooseJson(input);
    expect(result).not.toBeNull();
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].content).toContain('\n');
    expect(result.pages[0].content).not.toContain('\\n');
    expect(result.pages[0].title).toBe('标题');
    expect(result.pages[0].tags).toEqual(['标签1', '标签2']);
    expect(result.pages[0].filename).toBe('pages/ai/test.md');
  });

  it('处理含中文引号的 content', () => {
    // 中文引号 " " 是 U+201C/U+201D，不应与 ASCII " 混淆
    const input = `{
  "pages": [
    {
      "filename": "pages/ai/test.md",
      "title": "测试",
      "tags": ["tag"],
      "content": "作者认为「这样」是"正确"的。"
    }
  ]
}`;
    const result = tryParseLooseJson(input);
    expect(result).not.toBeNull();
    expect(result.pages[0].content).toBe('作者认为「这样」是"正确"的。');
  });

  it('宽松解析时保留 claims', () => {
    const input = `{
  "pages": [{
    "filename": "pages/ai/test.md",
    "title": "测试",
    "tags": ["tag"],
    "content": "正文中有未转义的\n换行"
  }],
  "claims": [{
    "pageTitle": "测试",
    "text": "原文事实",
    "evidenceQuote": "原文事实"
  }],
  "relationships": [],
  "summary": "测试"
}`;

    const result = tryParseLooseJson(input);
    expect(result?.claims).toEqual([
      expect.objectContaining({
        pageTitle: '测试',
        evidenceQuote: '原文事实',
      }),
    ]);
  });

  it('处理含转义 \\n 的标准 JSON', () => {
    const input = JSON.stringify({
      pages: [
        {
          filename: 'pages/ai/test.md',
          title: 'Test',
          tags: ['t'],
          content: 'Line1\n\nLine2\n',
        },
      ],
    });
    const result = tryParseLooseJson(input);
    expect(result).not.toBeNull();
    expect(result.pages[0].content).toBe('Line1\n\nLine2\n');
  });

  it('错误输入返回 null', () => {
    expect(tryParseLooseJson('not json at all')).toBeNull();
    expect(tryParseLooseJson('{broken')).toBeNull();
    expect(tryParseLooseJson('')).toBeNull();
  });
});

describe('writeWikiPages', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-test-'));

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('写入页面文件并保留真实换行符', () => {
    const pages: CompiledPage[] = [
      {
        filename: 'pages/test/page.md',
        title: 'Test Page',
        tags: ['tag1', 'tag2'],
        created: '2026-06-23',
        source: 'source.txt',
        content: '# Title\n\nParagraph 1\n\nParagraph 2\n',
      },
    ];

    const results = writeWikiPages(tmpDir, pages);
    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe('Paragraph 1');

    const filePath = path.join(tmpDir, 'pages/test/page.md');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf-8');
    // frontmatter
    expect(content).toMatch(
      /^---\ntitle: Test Page\ntags: \[tag1, tag2\]\ncreated: 2026-06-23\nsource: source\.txt\n---\n\n/,
    );
    // body should have real newlines, not literal \n
    expect(content).toContain('# Title\n\nParagraph 1\n\nParagraph 2');
    expect(content).not.toContain('\\n');
  });

  it('重建索引时保留多级目录页面', () => {
    const pages: CompiledPage[] = [
      {
        filename: 'pages/topic/sub/page.md',
        title: 'Nested Page',
        tags: ['tag1'],
        created: '2026-06-23',
        source: 'source.txt',
        content: '# Nested',
      },
    ];

    writeWikiPages(tmpDir, pages);
    updateIndexMd(tmpDir, pages);

    const indexContent = fs.readFileSync(path.join(tmpDir, '_index.md'), 'utf-8');
    expect(indexContent).toContain('[Nested Page](pages/topic/sub/page.md)');
  });

  it('规范化协议链接中被替换空格的页面路径', () => {
    const pages: CompiledPage[] = [
      {
        filename: 'pages/topic/target page.md',
        title: 'Target Page',
        tags: [],
        content: '[Target](mint-wiki://open?path=pages%2Ftopic%2Ftarget%20page.md)',
      },
    ];

    writeWikiPages(tmpDir, pages);

    const content = fs.readFileSync(path.join(tmpDir, 'pages/topic/target-page.md'), 'utf-8');
    expect(content).toContain('mint-wiki://open?path=pages%2Ftopic%2Ftarget-page.md');
  });
});

describe('appendWikiManifestEntry', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-manifest-test-'));

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is idempotent for the same manifest entry id', () => {
    const entry = {
      id: 'stable-commit',
      sourceFile: 'sources/source.md',
      archivedFiles: [],
      pageFiles: ['pages/topic/page.md'],
      summary: 'summary',
      createdAt: '2026-09-23T00:00:00.000Z',
    };

    appendWikiManifestEntry(tmpDir, entry);
    appendWikiManifestEntry(tmpDir, entry);

    expect(readWikiManifest(tmpDir).entries).toEqual([entry]);
    expect(() => appendWikiManifestEntry(tmpDir, { ...entry, summary: 'different' })).toThrow(
      'Wiki manifest id 已存在但内容不匹配: stable-commit',
    );
  });
});
