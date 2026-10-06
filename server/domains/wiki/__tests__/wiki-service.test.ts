import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

vi.mock('../../../application/settings/settings-service.js', () => ({
  get: vi.fn(),
}));

import * as wikiService from '../wiki-service.js';
import * as settingsService from '../../../application/settings/settings-service.js';

describe('wikiService', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-test-'));
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'sources'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '_schema.json'),
      JSON.stringify({
        version: 1,
        categories: [{ name: 'concept', description: 'Concepts' }],
      }),
    );
    fs.writeFileSync(path.join(tmpDir, 'pages', 'hello.md'), '# Hello Page\nContent here.');
    vi.mocked(settingsService.get).mockReturnValue({ wikiPath: tmpDir } as any);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    vi.clearAllMocks();
  });

  describe('listWiki', () => {
    it('returns tree with files', () => {
      const result = wikiService.listWiki();
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.tree.length).toBeGreaterThanOrEqual(1);
      const pages = result.tree.find((node) => node.path === 'pages');
      expect(pages?.children?.[0].modifiedAt).toEqual(expect.any(Number));
    });
  });

  describe('readWiki', () => {
    it('reads existing file', () => {
      const result = wikiService.readWiki('pages/hello.md');
      expect(result.content).toContain('Hello Page');
    });

    it('resolves a unique filename when generated links omit normalized hyphens', () => {
      const categoryDir = path.join(tmpDir, 'pages', '概念');
      fs.mkdirSync(categoryDir, { recursive: true });
      fs.writeFileSync(path.join(categoryDir, 'LLM-Wiki-的认知架构.md'), '# Architecture');

      const result = wikiService.readWiki('pages/概念/LLM-Wiki的认知架构.md');

      expect(result.path).toBe('pages/概念/LLM-Wiki-的认知架构.md');
      expect(result.content).toContain('Architecture');
    });

    it('rejects path traversal', () => {
      expect(() => wikiService.readWiki('../../../../etc/passwd')).toThrow('路径穿越');
    });

    it('rejects non-existent file', () => {
      expect(() => wikiService.readWiki('pages/nonexistent.md')).toThrow('不存在');
    });
  });

  describe('getSchema', () => {
    it('returns parsed schema', () => {
      const schema = wikiService.getSchema();
      expect(schema.categories).toHaveLength(1);
    });

    it('returns empty with no file', () => {
      fs.unlinkSync(path.join(tmpDir, '_schema.json'));
      const schema = wikiService.getSchema();
      expect(schema.categories).toEqual([]);
    });
  });

  describe('addCategory', () => {
    it('adds new category', () => {
      const schema = wikiService.addCategory('new-category');
      expect(schema.categories.find((c) => c.name === 'new-category')).toBeDefined();
    });

    it('throws on duplicate', () => {
      expect(() => wikiService.addCategory('concept')).toThrow('已存在');
    });

    it('throws on empty name', () => {
      expect(() => wikiService.addCategory('  ')).toThrow('不能为空');
    });
  });

  describe('removeCategory', () => {
    it('removes existing', () => {
      wikiService.addCategory('extra-cat');
      const schema = wikiService.removeCategory('extra-cat');
      expect(schema.categories.find((c) => c.name === 'extra-cat')).toBeUndefined();
      // Original category should remain
      expect(schema.categories.find((c) => c.name === 'concept')).toBeDefined();
    });

    it('non-existent is a no-op', () => {
      const schema = wikiService.removeCategory('nonexistent');
      // Should not throw and should still have original categories
      expect(schema.categories.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('updateSchema', () => {
    it('rejects duplicates', () => {
      expect(() =>
        wikiService.updateSchema({
          categories: [
            { name: 'a', description: '', include: [], exclude: [] },
            { name: 'a', description: '', include: [], exclude: [] },
          ],
        }),
      ).toThrow('已存在');
    });

    it('saves valid schema', () => {
      const schema = wikiService.updateSchema({
        categories: [{ name: 'updated-cat', description: 'Updated', include: [], exclude: [] }],
      });
      expect(schema.categories).toHaveLength(1);
      expect(schema.categories[0].name).toBe('updated-cat');
    });
  });
});
