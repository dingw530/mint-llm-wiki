import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../db.js';
import { searchWiki } from '../wiki-search-service.js';

const tempDirs: string[] = [];

describe('wikiSearchService', () => {
  afterEach(() => {
    for (const directory of tempDirs.splice(0))
      fs.rmSync(directory, { recursive: true, force: true });
  });

  it('returns a section-level evidence snippet and prioritizes title matches', async () => {
    const wikiPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-search-'));
    tempDirs.push(wikiPath);
    fs.mkdirSync(path.join(wikiPath, 'pages', 'guides'), { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'guides', 'mcp.md'),
      '---\ntitle: MCP 配置\n---\n# MCP 配置\n\n服务需要配置 URL 和认证信息。\n\n## 排错\n\n启动失败时检查端口。',
    );
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'guides', 'misc.md'),
      '---\ntitle: 其他说明\n---\n# 其他说明\n\n这里提到 MCP 服务作为背景。',
    );
    const result = await searchWiki(wikiPath, 'MCP 配置', 5, false);

    expect(result.results[0]).toMatchObject({
      file: 'pages/guides/mcp.md',
      title: 'MCP 配置',
      heading: 'MCP 配置',
      granularity: 'chunk',
    });
    expect(result.results[0].matchTypes).toContain('title');
    expect(result.results[0].snippet).toContain('URL');
  });

  it('rebuilds the index idempotently and handles empty queries', async () => {
    const wikiPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-search-empty-'));
    tempDirs.push(wikiPath);
    fs.mkdirSync(path.join(wikiPath, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(wikiPath, 'pages', 'one.md'), '# One\n\nSQLite database.');

    const first = await searchWiki(wikiPath, 'SQLite', 5, false);
    const firstCount = getDb()
      .prepare('SELECT COUNT(*) AS count FROM wiki_search_documents')
      .get() as { count: number };
    const second = await searchWiki(wikiPath, 'SQLite', 5, false);
    const secondCount = getDb()
      .prepare('SELECT COUNT(*) AS count FROM wiki_search_documents')
      .get() as { count: number };

    expect(first.results).toHaveLength(1);
    expect(second.results).toHaveLength(1);
    expect(secondCount.count).toBe(firstCount.count);
    expect((await searchWiki(wikiPath, '的', 5, false)).results).toEqual([]);
  });

  it('removes frontmatter and markdown noise from evidence snippets', async () => {
    const wikiPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-search-snippet-'));
    tempDirs.push(wikiPath);
    fs.mkdirSync(path.join(wikiPath, 'pages'), { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'harness.md'),
      '---\r\ntitle: Harness 内部标题\r\ntags: [Harness, 工程实践]\r\ncreated: 2026-07-10\r\nsource: 原始资料.md\r\n---\r\n# Harness 内部标题\r\n\r\nHarness 的正文证据应该直接解释规则和脚本如何协作。',
    );

    const result = await searchWiki(wikiPath, 'Harness', 5, false);

    expect(result.results[0].snippet).toContain('Harness 的正文证据');
    expect(result.results[0].snippet).not.toContain('title:');
    expect(result.results[0].snippet).not.toContain('source:');
    expect(result.results[0].snippet).not.toContain('# Harness');
  });

  it('aggregates multiple matching sections into one page evidence result', async () => {
    const wikiPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-search-page-'));
    tempDirs.push(wikiPath);
    fs.mkdirSync(path.join(wikiPath, 'pages'), { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'same.md'),
      '# 概览\n\nSQLite 是默认数据库。\n\n## 运维\n\nSQLite 需要定期备份。',
    );

    const result = await searchWiki(wikiPath, 'SQLite', 5, false);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].file).toBe('pages/same.md');
    expect(result.results[0].snippet).toContain('SQLite');
    expect(result.total).toBe(1);
  });

  it('adds sibling pages from the same source for a cross-topic question', async () => {
    const wikiPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-search-source-family-'));
    tempDirs.push(wikiPath);
    fs.mkdirSync(path.join(wikiPath, 'pages', 'medical'), { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'medical', 'research.md'),
      '---\ntitle: 医疗 Agent 研发\nsource: medical.md\n---\n医疗 Agent 需要持续评测。',
    );
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'medical', 'safety.md'),
      '---\ntitle: 隐私与合规\nsource: medical.md\n---\n医疗数据需要审计和隐私合规。',
    );
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'medical', 'other.md'),
      '---\ntitle: 无关页面\nsource: other.md\n---\n其他领域内容。',
    );

    const result = await searchWiki(wikiPath, '医疗 Agent 工程化问题', 3, true);

    expect(result.results.map((item) => item.file)).toEqual(
      expect.arrayContaining(['pages/medical/research.md', 'pages/medical/safety.md']),
    );
    expect(result.results.find((item) => item.file.endsWith('safety.md'))?.matchTypes).toContain(
      'source-family',
    );
    expect(result.results.find((item) => item.file.endsWith('safety.md'))?.granularity).toBe(
      'source-family',
    );
  });

  it('returns model content at chunk granularity when full evidence is requested', async () => {
    const wikiPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-search-granularity-'));
    tempDirs.push(wikiPath);
    fs.mkdirSync(path.join(wikiPath, 'pages'), { recursive: true });
    fs.writeFileSync(
      path.join(wikiPath, 'pages', 'sections.md'),
      '# Overview\n\nSQLite is the default database.\n\n## Operations\n\nSQLite needs regular backups.',
    );

    const result = await searchWiki(wikiPath, 'SQLite default database', 5, true);

    expect(result.results[0]).toMatchObject({ granularity: 'chunk', heading: 'Overview' });
    expect(result.results[0].content).toContain('SQLite is the default database.');
    expect(result.results[0].content).not.toContain('SQLite needs regular backups.');
  });
});
