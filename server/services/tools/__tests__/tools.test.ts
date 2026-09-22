import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Shared mutable wikiPath for mocks ──
let mockWikiPath: string | null = null;

// ── Mock pathSecurity ──
vi.mock('../../utils/pathSecurity.js', () => ({
  isPathSafe: (root: string, target: string) => {
    const p = require('path');
    const resolvedRoot = p.resolve(root);
    const resolvedTarget = p.resolve(resolvedRoot, target);
    return resolvedTarget.startsWith(resolvedRoot + p.sep) || resolvedTarget === resolvedRoot;
  },
  getWikiPath: () => mockWikiPath,
}));

// ── Mock settingsService ──
vi.mock('../../api/settingsService.js', () => ({
  getAiSettings: () => ({
    apiUrl: '',
    apiKey: '',
    modelId: '',
    systemPrompt: '',
    thinkingMode: false,
    memoryEnabled: false,
    wikiPath: mockWikiPath,
    wikiMaxFileSize: 0,
  }),
  getJevSettings: () => ({
    apiUrl: '',
    apiKey: '',
    model: '',
    timeoutMs: 5000,
    routingEnabled: false,
    routingMinConfidence: 0.5,
    routingBypassOnKeyword: true,
    memoryEnabled: false,
    memoryGateThreshold: 0.4,
    rerankEnabled: false,
  }),
}));

// ── Mock bashSecurityService ──
vi.mock('../../api/bashSecurityService.js', () => ({
  checkCommand: (cmd: string) => {
    if (cmd.includes('rm -rf /')) return { allowed: false, reason: '不允许删除根目录' };
    if (cmd.includes('sudo')) return { allowed: false, reason: '不允许使用 sudo' };
    return { allowed: true };
  },
}));

// ── Mock browserFetch ──
vi.mock('../../utils/browserFetch.js', () => ({
  browserFetch: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: () => Promise.resolve('<html><body>Mock content</body></html>'),
    headers: new Map([['content-type', 'text/html']]),
  }),
}));

// ── Mock fileParseService ──
vi.mock('../../utils/fileParseService.js', () => ({
  parseFile: vi.fn().mockResolvedValue({ text: 'parsed content' }),
  isSupportedFile: (name: string) => /\.(html?|txt|md|pdf)$/i.test(name),
}));

// Re-import after mocks
import { ReadFileTool } from '../ReadFileTool.js';
import { WriteFileTool } from '../WriteFileTool.js';
import { WikiLintTool } from '../WikiLintTool.js';
import { BashTool } from '../BashTool.js';
import { HttpFetchTool } from '../HttpFetchTool.js';
import { WikiSearchTool } from '../WikiSearchTool.js';
import { BaseTool } from '../BaseTool.js';
import { toolExecutor } from '../ToolExecutor.js';
import { ToolExecutor } from '../ToolExecutor.js';
import { ToolRegistry } from '../ToolRegistry.js';
import { browserFetch } from '../../utils/browserFetch.js';

const ctx = { conversationId: 'test-conv' };
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-test-'));
  mockWikiPath = tmpDir;
});

afterEach(() => {
  mockWikiPath = null;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ══════════════════════════════════════════
// ReadFileTool
// ══════════════════════════════════════════
describe('ReadFileTool', () => {
  const tool = new ReadFileTool();

  it('should have correct metadata', () => {
    expect(tool.name).toBe('read_file');
    expect(tool.isReadOnly()).toBe(true);
    expect(tool.isConcurrencySafe()).toBe(true);
  });

  it('should read a file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.md'), 'hello world');
    const result = await tool.execute({ path: 'test.md' }, ctx);
    expect(result.content).toBe('hello world');
    expect(result.path).toBe('test.md');
  });

  it('should list directory contents', async () => {
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a');
    const result = await tool.execute({ path: '.' }, ctx);
    expect(result.content).toContain('[FILE] a.txt');
    expect(result.content).toContain('[DIR] sub');
  });

  it('should throw on non-existent file', async () => {
    await expect(tool.execute({ path: 'nope.md' }, ctx)).rejects.toThrow('文件不存在');
  });

  it('should reject path traversal', async () => {
    await expect(tool.execute({ path: '../../../etc/passwd' }, ctx)).rejects.toThrow(
      '路径穿越被拒绝',
    );
  });

  it('should throw when wikiPath not configured', async () => {
    mockWikiPath = null;
    await expect(tool.execute({ path: 'test.md' }, ctx)).rejects.toThrow('Wiki 路径未配置');
  });
});

// ══════════════════════════════════════════
// WriteFileTool
// ══════════════════════════════════════════
describe('WriteFileTool', () => {
  const tool = new WriteFileTool();

  it('should have correct metadata', () => {
    expect(tool.name).toBe('write_file');
    expect(tool.isReadOnly()).toBe(false);
    expect(tool.isIdempotent()).toBe(true);
  });

  it('should write a file', async () => {
    const result = await tool.execute({ path: 'output.md', content: '# Hello' }, ctx);
    expect(result.path).toBe('output.md');
    expect(result.size).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(tmpDir, 'output.md'), 'utf-8')).toBe('# Hello');
  });

  it('should create subdirectories automatically', async () => {
    await tool.execute({ path: 'pages/sub/deep.md', content: 'nested' }, ctx);
    expect(fs.existsSync(path.join(tmpDir, 'pages/sub/deep.md'))).toBe(true);
  });

  it('should reject path traversal', async () => {
    await expect(
      tool.execute({ path: '../../../etc/crontab', content: 'evil' }, ctx),
    ).rejects.toThrow('路径穿越被拒绝');
  });
});

// ══════════════════════════════════════════
// WikiLintTool
// ══════════════════════════════════════════
describe('WikiLintTool', () => {
  const tool = new WikiLintTool();

  it('should report manifest missing for uninitialized wiki', async () => {
    const result = await tool.execute({}, ctx);
    expect(result.healthy).toBe(false);
    expect(result.issues.some((i) => i.type === 'manifest_missing')).toBe(true);
  });

  it('should report healthy for initialized empty wiki', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '_manifest.json'),
      JSON.stringify({ version: 1, entries: [] }, null, 2),
    );
    const result = await tool.execute({}, ctx);
    expect(result.healthy).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should detect orphan pages', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pages/orphan.md'), '# Orphan\nNo links here.');
    const result = await tool.execute({}, ctx);
    expect(result.issues.some((i) => i.type === 'orphan')).toBe(true);
  });

  it('should detect broken links', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pages/a.md'), '# A\n[link to B](./b)');
    const result = await tool.execute({}, ctx);
    expect(result.issues.some((i) => i.type === 'broken_link')).toBe(true);
  });

  it('should accept links to filenames sanitized with hyphens', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages/topic'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pages/topic/source.md'),
      '# Source\n[Target](pages/topic/Target Page.md)',
    );
    fs.writeFileSync(path.join(tmpDir, 'pages/topic/Target-Page.md'), '# Target');

    const result = await tool.execute({}, ctx);
    expect(result.issues.some((i) => i.type === 'broken_link')).toBe(false);
  });

  it('should not append a duplicate markdown extension to broken link messages', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pages/a.md'), '# A\n[link to B](./missing.md)');

    const result = await tool.execute({}, ctx);
    const broken = result.issues.find((i) => i.type === 'broken_link');
    expect(broken?.description).toContain('missing.md');
    expect(broken?.description).not.toContain('missing.md.md');
  });

  it('should resolve pages-prefixed links from the wiki root', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages/topic'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'pages/概念'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pages/topic/a.md'),
      '# A\n[目标](mint-wiki://open?path=pages%2F概念%2Fb.md)',
    );
    fs.writeFileSync(path.join(tmpDir, 'pages/概念/b.md'), '# B');

    const result = await tool.execute({}, ctx);
    expect(result.issues.some((i) => i.type === 'broken_link')).toBe(false);
  });

  it('should detect missing frontmatter', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pages/nofm.md'), 'No frontmatter here.');
    const result = await tool.execute({}, ctx);
    expect(result.issues.some((i) => i.type === 'missing_frontmatter')).toBe(true);
  });

  it('should not flag pages with valid frontmatter', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pages/good.md'),
      '---\ntitle: Good\ntags: [test]\n---\n# Good page',
    );
    const result = await tool.execute({}, ctx);
    expect(result.issues.some((i) => i.type === 'missing_frontmatter')).toBe(false);
  });

  it('should detect missing required fields, manifest mismatch and index drift together', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages/topic'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '_manifest.json'),
      JSON.stringify(
        {
          version: 1,
          entries: [
            {
              id: 'm1',
              sourceFile: 'sources/source-a.md',
              archivedFiles: [],
              pageFiles: ['pages/topic/missing.md'],
              summary: 'summary',
              createdAt: '2026-06-30T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(tmpDir, '_index.md'),
      '# Wiki 首页\n\n- [Ghost](pages/topic/ghost.md)\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'pages/topic/live.md'),
      '---\ntitle: Live\ntags: [test]\ncreated: 2026-06-30\n---\n# Live',
    );

    const result = await tool.execute({}, ctx);
    expect(
      result.issues.some(
        (i) => i.type === 'missing_required_field' && i.description.includes('"source"'),
      ),
    ).toBe(true);
    expect(result.issues.some((i) => i.type === 'manifest_mismatch')).toBe(true);
    expect(result.issues.some((i) => i.type === 'index_drift')).toBe(true);
  });

  it('should detect page source mismatch against manifest entry', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages/topic'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '_manifest.json'),
      JSON.stringify(
        {
          version: 1,
          entries: [
            {
              id: 'm1',
              sourceFile: 'sources/source-a.md',
              archivedFiles: ['sources/archive-a.pdf'],
              pageFiles: ['pages/topic/live.md'],
              summary: 'summary',
              createdAt: '2026-06-30T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'pages/topic/live.md'),
      '---\ntitle: Live\ntags: [test]\ncreated: 2026-06-30\nsource: other-source.md\n---\n# Live',
    );

    const result = await tool.execute({}, ctx);
    expect(
      result.issues.some(
        (i) =>
          i.type === 'manifest_mismatch' &&
          i.description.includes('页面 source 未匹配到 manifest 记录'),
      ),
    ).toBe(true);
  });

  it('should allow manually created pages without source metadata when manifest has no source', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages/topic'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '_manifest.json'),
      JSON.stringify(
        {
          version: 1,
          entries: [
            {
              id: 'm1',
              sourceFile: '',
              archivedFiles: [],
              pageFiles: ['pages/topic/manual.md'],
              summary: 'manual page',
              createdAt: '2026-06-30T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'pages/topic/manual.md'),
      '---\ntitle: Manual\ntags: [test]\ncreated: 2026-06-30\n---\n# Manual',
    );

    const result = await tool.execute({}, ctx);
    expect(
      result.issues.some(
        (i) => i.type === 'manifest_mismatch' && i.file === 'pages/topic/manual.md',
      ),
    ).toBe(false);
  });

  it('should handle nested directories and cross links at 10+ page scale', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages/alpha/core'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'pages/beta/deep'), { recursive: true });
    const manifestEntries = [];
    const indexLines = ['# Wiki 首页', '', '## 分类索引', ''];

    for (let i = 1; i <= 12; i += 1) {
      const category = i <= 6 ? 'alpha/core' : 'beta/deep';
      const filename = `pages/${category}/page-${i}.md`;
      const nextCategory = i === 12 ? 'alpha/core' : i + 1 <= 6 ? 'alpha/core' : 'beta/deep';
      const nextIndex = i === 12 ? 1 : i + 1;
      const content = `---\ntitle: Page ${i}\ntags: [wiki, batch]\ncreated: 2026-06-30\nsource: source-${i}.md\n---\n# Page ${i}\n\n## Section ${i}\n\nLink to [next](../../${nextCategory}/page-${nextIndex}.md)\n`;
      fs.writeFileSync(path.join(tmpDir, filename), content);
      manifestEntries.push({
        id: `m-${i}`,
        sourceFile: `sources/source-${i}.md`,
        archivedFiles: [],
        pageFiles: [filename],
        summary: `summary-${i}`,
        createdAt: '2026-06-30T00:00:00.000Z',
      });
      indexLines.push(`- [Page ${i}](${filename})`);
      fs.mkdirSync(path.join(tmpDir, 'sources'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, `sources/source-${i}.md`), `# Source ${i}`);
    }

    fs.writeFileSync(
      path.join(tmpDir, '_manifest.json'),
      JSON.stringify({ version: 1, entries: manifestEntries }, null, 2),
    );
    fs.writeFileSync(path.join(tmpDir, '_index.md'), `${indexLines.join('\n')}\n`);

    const result = await tool.execute({}, ctx);
    expect(result.totalPages).toBe(12);
    expect(result.issues).toHaveLength(0);
    expect(result.healthy).toBe(true);
  });

  it('should output formatted and sorted issue descriptions', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages/topic'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pages/topic/a.md'), '# A\n[link](./missing)');
    const result = await tool.execute({}, ctx);
    expect(result.issues[0].description).toBe(
      'Wiki 健康检查 / _manifest.json / manifest 文件不存在',
    );
    expect(result.issues[0].type).toBe('manifest_missing');
  });

  it('should dedupe repeated issue types on the same file', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages/topic'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '_manifest.json'),
      JSON.stringify({ version: 1, entries: [] }, null, 2),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'pages/topic/multi-missing.md'),
      '---\ntags: [test]\n---\n# Missing',
    );

    const result = await tool.execute({}, ctx);
    const requiredFieldIssues = result.issues.filter(
      (i) => i.file === 'pages/topic/multi-missing.md' && i.type === 'missing_required_field',
    );
    expect(requiredFieldIssues).toHaveLength(1);
  });
});

// ══════════════════════════════════════════
// BashTool
// ══════════════════════════════════════════
describe('BashTool', () => {
  const tool = new BashTool();

  it('should have correct metadata', () => {
    expect(tool.name).toBe('bash');
    expect(tool.isReadOnly()).toBe(false);
    expect(tool.isIdempotent()).toBe(false);
  });

  it('should execute simple commands', async () => {
    const result = await tool.execute({ command: 'echo hello' }, ctx);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.sandbox.sandboxed).toBe(false);
    expect(result.sandbox.state).toBe('host_fallback');
  });

  it('should use the Mint workspace by default', async () => {
    const result = await tool.execute({ command: 'pwd' }, ctx);
    expect(result.stdout.trim()).toBe(path.join(os.homedir(), '.mint'));
  });

  it('should capture stderr', async () => {
    const result = await tool.execute({ command: 'echo err >&2' }, ctx);
    expect(result.stderr.trim()).toBe('err');
  });

  it('should return non-zero exit code', async () => {
    const result = await tool.execute({ command: 'exit 42' }, ctx);
    expect(result.exitCode).toBe(42);
  });

  it('should block rm -rf /', async () => {
    const perm = tool.checkPermission({ command: 'rm -rf /' }, ctx);
    expect(perm.allowed).toBe(false);
  });

  it('should block sudo', async () => {
    const perm = tool.checkPermission({ command: 'sudo ls' }, ctx);
    expect(perm.allowed).toBe(false);
  });

  it('should allow safe commands', async () => {
    const perm = tool.checkPermission({ command: 'ls -la' }, ctx);
    expect(perm.allowed).toBe(true);
  });
});

// ══════════════════════════════════════════
// HttpFetchTool
// ══════════════════════════════════════════
describe('HttpFetchTool', () => {
  const tool = new HttpFetchTool();

  it('should have correct metadata', () => {
    expect(tool.name).toBe('http_fetch');
  });

  it('should validate input schema', () => {
    expect(tool.validate({ url: 'https://example.com' }).valid).toBe(true);
    expect(tool.validate({}).valid).toBe(false);
  });

  it('always enables the public-only target policy', async () => {
    await tool.execute({ url: 'https://example.com' }, ctx);
    expect(vi.mocked(browserFetch)).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ targetPolicy: 'public-only' }),
    );
  });

  it('propagates blocked target errors to failed audit without secrets', async () => {
    const registry = new ToolRegistry();
    registry.register(tool);
    vi.mocked(browserFetch).mockRejectedValueOnce(
      new Error('HTTP_TARGET_BLOCKED hostname=private.example reason=address'),
    );
    const audit = vi.fn();
    const result = await new ToolExecutor(registry).execute(
      'http_fetch',
      { url: 'https://private.example/?token=secret' },
      { ...ctx, audit },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP_TARGET_BLOCKED');
    expect(result.error).not.toContain('token=secret');
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'failed',
        error: expect.stringContaining('HTTP_TARGET_BLOCKED'),
      }),
    );
  });
});

// ══════════════════════════════════════════
// WikiSearchTool
// ══════════════════════════════════════════
describe('WikiSearchTool', () => {
  const tool = new WikiSearchTool();

  it('should have correct metadata', () => {
    expect(tool.name).toBe('wiki_search');
    expect(tool.isReadOnly()).toBe(true);
    expect(tool.isConcurrencySafe()).toBe(true);
  });

  it('should summarize question and path calls', () => {
    expect(tool.getCallSummary({ question: '项目架构' })).toBe('正在查找：项目架构');
    expect(tool.getCallSummary({ paths: ['pages/a.md', 'pages/b.md'] })).toBe(
      '正在读取 2 个 Wiki 文件',
    );
  });

  it('should summarize search and path results', () => {
    expect(
      tool.getResultSummary({
        results: [{ file: 'pages/a.md', content: '', score: 1 }],
        total: 4,
        message: '找到 4 个相关页面',
      }),
    ).toBe('找到 4 个相关页面，返回前 1 个');
    expect(
      tool.getResultSummary({
        results: [{ file: 'pages/a.md', content: '', score: 1 }],
        total: 1,
        message: '已读取 1 个文件',
      }),
    ).toBe('已读取 1 个文件');
    expect(tool.getResultSummary({ results: [], total: 0, message: '未找到相关内容' })).toBe(
      '未找到相关内容',
    );
  });

  it('should find matching content via search', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pages/react.md'), '# React\nReact 是一个前端框架。');
    const result = await tool.execute({ question: 'React 前端' }, ctx);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].file).toContain('react.md');
    expect(result.results[0].content.length).toBeGreaterThan(0);
    expect(result.results[0].granularity).toBe('chunk');
  });

  it('should keep question content aligned with the returned chunk', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pages', 'sections.md'),
      '# Overview\n\nSQLite is the default database.\n\n## Operations\n\nSQLite needs regular backups.',
    );

    const result = await tool.execute(
      { question: 'SQLite default database', includeContent: true },
      ctx,
    );

    expect(result.results[0]).toMatchObject({ granularity: 'chunk', heading: 'Overview' });
    expect(result.results[0].content).toContain('SQLite is the default database.');
    expect(result.results[0].content).not.toContain('SQLite needs regular backups.');
  });

  it('should read files via paths parameter', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pages/test.md'),
      '---\ntitle: Test page\n---\n# Test\nHello world',
    );
    const result = await tool.execute({ question: 'unused', paths: ['pages/test.md'] }, ctx);
    expect(result.results.length).toBe(1);
    expect(result.results[0].content).toContain('Hello world');
    expect(result.results[0].title).toBe('Test page');
    expect(result.results[0].snippet).toBe('');
    expect(result.results[0].granularity).toBe('page');
  });

  it('should apply default search options when execute is called directly', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pages/direct.md'),
      '# Direct\nDirect execute keeps full content by default.',
    );
    const result = await tool.execute({ question: 'Direct' }, ctx);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].content).toContain('Direct execute keeps full content by default.');
  });

  it('should list directory when path is directory', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pages/a.md'), 'a');
    const result = await tool.execute({ question: 'unused', paths: ['pages'] }, ctx);
    expect(result.results.length).toBe(1);
    expect(result.results[0].content).toContain('[FILE] a.md');
  });

  it('should return empty for no matches', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pages/empty.md'), '# 空页面\n没有相关内容。');
    const result = await tool.execute({ question: '量子计算 人工智能' }, ctx);
    expect(result.results.length).toBe(0);
  });

  it('should rank title and tags above body-only matches', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages/ranking'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pages/ranking/body-only.md'),
      '---\ntitle: Notes\ntags: [misc]\ncreated: 2026-06-30\nsource: notes.md\n---\n# Notes\n\nMint Mint Mint Mint Mint\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'pages/ranking/title-hit.md'),
      '---\ntitle: Mint Platform\ntags: [knowledge]\ncreated: 2026-06-30\nsource: title.md\n---\n# Mint Platform\n\nOnly one body mention.\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'pages/ranking/tag-hit.md'),
      '---\ntitle: Search Notes\ntags: [mint]\ncreated: 2026-06-30\nsource: tag.md\n---\n# Search Notes\n\nBody without repeated keyword.\n',
    );

    const result = await tool.execute(
      { question: 'Mint', includeContent: false, maxResults: 3 },
      ctx,
    );
    expect(result.results.map((item) => item.file)).toEqual([
      'pages/ranking/title-hit.md',
      'pages/ranking/tag-hit.md',
      'pages/ranking/body-only.md',
    ]);
  });

  it('should return snippet near matching heading', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages/snippets'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pages/snippets/heading.md'),
      `---\ntitle: Guide\ntags: [guide]\ncreated: 2026-06-30\nsource: guide.md\n---\n# Intro\n\n${'x'.repeat(400)}\n\n## Rate Limit Strategy\n\nThis section explains timeout and retry details.\n`,
    );

    const result = await tool.execute({ question: 'Rate Limit', includeContent: false }, ctx);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].content).toContain('## Rate Limit Strategy');
    expect(result.results[0].content).toContain('timeout and retry details');
  });

  it('should filter system files from question search but still read them via paths', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages/system'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '_manifest.json'),
      JSON.stringify({ version: 1, entries: [] }, null, 2),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'pages/system/real-page.md'),
      '---\ntitle: Real Page\ntags: [wiki]\ncreated: 2026-06-30\nsource: real.md\n---\n# Real Page\n\nManifest keyword in body.\n',
    );

    const searchResult = await tool.execute({ question: 'manifest' }, ctx);
    expect(searchResult.results.every((item) => item.file !== '_manifest.json')).toBe(true);

    const readResult = await tool.execute({ paths: ['_manifest.json'] }, ctx);
    expect(readResult.results[0].file).toBe('_manifest.json');
    expect(readResult.results[0].content).toContain('"version": 1');
  });

  it('should throw when wikiPath not configured', async () => {
    mockWikiPath = null;
    await expect(tool.execute({ question: 'test' }, ctx)).rejects.toThrow('Wiki 路径未配置');
  });
});

// ══════════════════════════════════════════
// ToolExecutor timeout override
// ══════════════════════════════════════════
describe('ToolExecutor timeout override', () => {
  class SlowTool extends BaseTool<{ delayMs: number }, { ok: boolean }> {
    readonly name = 'slow_tool';
    readonly description = 'slow tool';
    readonly inputSchema = z.object({ delayMs: z.number() });
    readonly executionTimeoutMs = 20;

    async execute(input: { delayMs: number }): Promise<{ ok: boolean }> {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
      return { ok: true };
    }
  }

  beforeEach(() => {
    const registry = (toolExecutor as any).registry;
    registry.register(new SlowTool());
  });

  it('should prefer tool execution timeout over default timeout', async () => {
    const result = await toolExecutor.execute('slow_tool', { delayMs: 50 }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out after 20ms');
  });
});
