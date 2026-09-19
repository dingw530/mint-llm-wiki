import { describe, expect, it } from 'vitest';
import {
  getFadedColor,
  getGraphEdgeStrokeStyle,
  getGraphEdgeLabelOpacity,
  getGraphEdgeWidth,
  getGraphNodeLabel,
  getGraphNodeSize,
  isReferenceGraphEdge,
  isWeakGraphEdge,
  removeIsolatedGraphNodes,
} from '../WikiGraphPanel';
import { isExternalWikiLink, parseWikiDocument, resolveWikiLinkPath } from '../WikiPanel';
import { formatFileSize, sortWikiTree } from '../WikiSidebar';
import type { WikiFileTreeNode } from '@/types';
import type { GraphEdge } from '@/services/api/wiki';

describe('Wiki link and document helpers', () => {
  it('resolves relative, root-relative and external links', () => {
    expect(isExternalWikiLink('https://example.com')).toBe(true);
    expect(isExternalWikiLink('pages/next')).toBe(false);
    expect(resolveWikiLinkPath('pages/topic/current.md', 'next')).toBe('pages/topic/next.md');
    expect(resolveWikiLinkPath('pages/topic/current.md', '../other')).toBe('pages/other.md');
    expect(
      resolveWikiLinkPath(
        'pages/topic/current.md',
        'mint-wiki://open?path=pages%2Fother%2F目标.md',
      ),
    ).toBe('pages/other/目标.md');
    expect(resolveWikiLinkPath('pages/topic/current.md', '/sources/raw.txt')).toBe(
      'sources/raw.txt',
    );
    expect(resolveWikiLinkPath('pages/topic/current.md', '#section')).toBeNull();
    expect(resolveWikiLinkPath('pages/topic/current.md', 'https://example.com')).toBeNull();
  });

  it('parses frontmatter and derives document metadata', () => {
    expect(
      parseWikiDocument(
        'pages/topic/readme.md',
        [
          '---',
          'title: "A topic"',
          'tags: [one, "two"]',
          'created: 2026-01-01',
          '---',
          '# Body',
        ].join('\n'),
      ),
    ).toEqual({
      title: 'A topic',
      fileName: 'readme.md',
      fileDir: 'pages/topic',
      fileExt: 'md',
      frontmatter: { title: 'A topic', tags: ['one', 'two'], created: '2026-01-01' },
      body: '# Body',
    });
    expect(parseWikiDocument('note.txt', 'plain text').title).toBe('note.txt');
  });
});

const edge = (overrides: Partial<GraphEdge> = {}): GraphEdge => ({
  id: 'edge-1',
  sourceId: 'a',
  targetId: 'b',
  relation: 'supports',
  properties: {},
  source: 'test',
  createdAt: '2026-01-01',
  ...overrides,
});

describe('graph and file display helpers', () => {
  it('sorts each directory without changing the tree hierarchy', () => {
    const nodes: WikiFileTreeNode[] = [
      { name: 'old.md', type: 'file', path: 'old.md', modifiedAt: 100 },
      { name: 'new.md', type: 'file', path: 'new.md', modifiedAt: 300 },
      {
        name: 'docs',
        type: 'directory',
        path: 'docs',
        modifiedAt: 200,
        children: [{ name: 'nested.md', type: 'file', path: 'docs/nested.md', modifiedAt: 50 }],
      },
    ];

    expect(sortWikiTree(nodes, 'modified-desc').map((node) => node.name)).toEqual([
      'new.md',
      'docs',
      'old.md',
    ]);
    expect(sortWikiTree(nodes, 'name-asc')[0].children?.[0].path).toBe('docs/nested.md');
  });

  it('fades colors, truncates labels and formats file sizes', () => {
    expect(getFadedColor('#123456')).toBe('rgba(18,52,86,0.12)');
    expect(getGraphNodeLabel('12345678901234567')).toBe('1234567890123456...');
    expect(getGraphNodeSize(0)).toBe(8);
    expect(getGraphNodeSize(16)).toBe(18);
    expect(getGraphNodeSize(200)).toBe(28);
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
  });

  it('identifies weak edges and calculates edge widths', () => {
    expect(isWeakGraphEdge(edge({ relation: 'references' }))).toBe(true);
    expect(isWeakGraphEdge(edge({ properties: { strength: 'weak' } }))).toBe(true);
    expect(isWeakGraphEdge(edge({ properties: { strength: 'strong' } }))).toBe(false);
    expect(getGraphEdgeWidth(edge({ properties: { confidence: 0.9 } }))).toBeCloseTo(1.06);
    expect(getGraphEdgeWidth(edge({ relation: 'references' }))).toBe(0.6);
    expect(isWeakGraphEdge({ relation: 'shared_tag', strength: 'weak' })).toBe(true);
    expect(getGraphEdgeWidth({ relation: 'shared_tag', strength: 'strong' })).toBeCloseTo(0.92);
  });

  it('styles reference edges as faded dashed lines', () => {
    expect(isReferenceGraphEdge(edge({ relation: 'references' }))).toBe(true);
    expect(isReferenceGraphEdge(edge({ relation: 'supports' }))).toBe(false);
    expect(getGraphEdgeStrokeStyle(edge({ relation: 'references' }))).toBe('#DDE3E8');
    expect(getGraphEdgeStrokeStyle(edge({ relation: 'supports' }))).toBe('#C3CBD3');
    expect(getGraphEdgeLabelOpacity(edge({ relation: 'references' }))).toBe(0);
    expect(getGraphEdgeLabelOpacity(edge({ relation: 'supports' }))).toBe(1);
  });

  it('removes isolated nodes while retaining connected edges', () => {
    const result = removeIsolatedGraphNodes({
      nodes: [
        {
          id: 'a',
          label: 'A',
          type: 'concept',
          properties: {},
          sourceFile: null,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'b',
          label: 'B',
          type: 'concept',
          properties: {},
          sourceFile: null,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'orphan',
          label: '孤立节点',
          type: 'concept',
          properties: {},
          sourceFile: null,
          createdAt: '',
          updatedAt: '',
        },
      ],
      edges: [edge()],
    });
    expect(result.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(result.edges).toHaveLength(1);
  });
});
