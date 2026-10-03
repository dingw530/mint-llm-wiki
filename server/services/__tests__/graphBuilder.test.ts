import { afterAll, describe, expect, it, beforeEach } from 'vitest';

import * as graphRepo from '../../infrastructure/persistence/graph-repository.js';
import { buildGraphFromPages, normalizeRelation, extractWikiLinks } from '../graphBuilder.js';
import type { CompiledPage, Relationship } from '../utils/wikiShared.js';

function cleanGraph() {
  graphRepo.getAllEdges().forEach((e) => {
    try {
      graphRepo.deleteEdge(e.id);
    } catch {}
  });
  graphRepo.getGraphData().nodes.forEach((n) => {
    try {
      graphRepo.deleteNode(n.id);
    } catch {}
  });
}

describe('graphBuilder', () => {
  afterAll(() => cleanGraph());
  beforeEach(() => cleanGraph());

  describe('normalizeRelation', () => {
    it('normalizes known relations', () => {
      expect(normalizeRelation('包含')).toBe('包含');
      // Falls back to input when not in synonym map
      expect(normalizeRelation('引用')).toBe('引用');
      expect(normalizeRelation('')).toBe('');
    });
  });

  describe('extractWikiLinks', () => {
    it('extracts wiki links', () => {
      const links = extractWikiLinks('See [X](pages/cat/X.md) and [Y](pages/cat/Y.md)');
      expect(links).toHaveLength(2);
      expect(links[0]).toBe('pages/cat/X.md');
    });

    it('handles relative paths', () => {
      expect(extractWikiLinks('[T](../pages/a.md)')).toContain('pages/a.md');
    });

    it('handles absolute paths', () => {
      expect(extractWikiLinks('[T](/pages/a.md)')).toContain('pages/a.md');
    });

    it('ignores non-wiki links', () => {
      expect(extractWikiLinks('[G](https://google.com)')).toEqual([]);
    });

    it('empty for no links', () => {
      expect(extractWikiLinks('No links')).toEqual([]);
    });

    it('handles encoded URLs', () => {
      const links = extractWikiLinks('[P](pages/cat/page%20name.md)');
      expect(links[0]).toBe('pages/cat/page-name.md');
    });

    it('handles mint-wiki links independently of the source directory', () => {
      const links = extractWikiLinks(
        '[目标](mint-wiki://open?path=pages%2F概念%2F目标.md)',
        'pages/方法论/入口.md',
      );
      expect(links).toEqual(['pages/概念/目标.md']);
    });
  });

  describe('buildGraphFromPages', () => {
    it('returns empty for no pages', () => {
      const result = buildGraphFromPages([]);
      expect(result.nodesCreated).toBe(0);
      expect(result.edgesCreated).toBe(0);
    });

    it('creates nodes', () => {
      const pages: CompiledPage[] = [
        { filename: 'pages/cat/A.md', title: 'GraphA', tags: [], content: 'A' },
        { filename: 'pages/cat/B.md', title: 'GraphB', tags: [], content: 'B' },
      ];
      const result = buildGraphFromPages(pages);
      expect(result.nodesCreated).toBe(2);
      expect(graphRepo.searchNodes('GraphA').length).toBeGreaterThanOrEqual(1);
      expect(result.errors).toEqual([]);
    });

    it('creates edges from relationships', () => {
      const pages: CompiledPage[] = [
        { filename: 'pages/cat/X.md', title: 'GraphX', tags: [], content: 'X' },
        { filename: 'pages/cat/Y.md', title: 'GraphY', tags: [], content: 'Y' },
      ];
      const rels: Relationship[] = [
        {
          source: 'GraphX',
          target: 'GraphY',
          relation: '基于',
          reason: 'test',
          confidence: 0.8,
          evidence: 'e',
        },
      ];
      const result = buildGraphFromPages(pages, rels);
      expect(result.edgesCreated).toBeGreaterThanOrEqual(1);
    });

    it('reuses existing nodes', () => {
      const pages: CompiledPage[] = [
        { filename: 'pages/cat/L1.md', title: 'LabelUnique', tags: [], content: 'A' },
      ];
      buildGraphFromPages(pages);
      const result = buildGraphFromPages(pages);
      expect(result.nodesCreated).toBe(0);
    });

    it('extracts references from markdown links', () => {
      const pages: CompiledPage[] = [
        {
          filename: 'pages/cat/P1.md',
          title: 'P1',
          tags: [],
          content: 'See [P2](pages/cat/P2.md)',
        },
        {
          filename: 'pages/cat/P2.md',
          title: 'P2',
          tags: [],
          content: 'See [P1](pages/cat/P1.md)',
        },
      ];
      const result = buildGraphFromPages(pages);
      expect(result.nodesCreated).toBe(2);
      // Should create at least 1 edge (first direction encounters the other node)
      // The second direction might find the edge already exists
      const edges = graphRepo.getAllEdges();
      expect(edges.length).toBeGreaterThanOrEqual(1);
    });
  });
});
