import { describe, expect, it, vi } from 'vitest';

const graph = vi.hoisted(() => ({
  nodes: [] as Array<Record<string, unknown>>,
  edges: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../infrastructure/persistence/graph-repository.js', () => ({
  transaction: <T>(fn: () => T): T => fn(),
  searchNodes: (label: string) => graph.nodes.filter((node) => !label || node.label === label),
  createNode: (params: Record<string, unknown>) => {
    const node = { ...params, id: `node-${graph.nodes.length + 1}` };
    graph.nodes.push(node);
    return node;
  },
  updateNodeType: vi.fn(),
  getAllEdges: () => graph.edges,
  findEdgeByTriple: (sourceId: string, relation: string, targetId: string) =>
    graph.edges.find(
      (edge) =>
        edge.sourceId === sourceId && edge.relation === relation && edge.targetId === targetId,
    ) || null,
  createEdge: (params: Record<string, unknown>) => {
    const edge = { ...params, id: `edge-${graph.edges.length + 1}` };
    graph.edges.push(edge);
    return edge;
  },
}));

import { buildGraphFromPages } from '../graph-builder.js';

describe('buildGraphFromPages references', () => {
  it('stores one reference when two pages link to each other', () => {
    graph.nodes.length = 0;
    graph.edges.length = 0;

    const result = buildGraphFromPages([
      {
        filename: 'pages/方法论/A.md',
        title: 'A',
        tags: [],
        content: '[B](pages/方法论/B.md)',
      },
      {
        filename: 'pages/方法论/B.md',
        title: 'B',
        tags: [],
        content: '[A](pages/方法论/A.md)',
      },
    ]);

    expect(result.edgesCreated).toBe(1);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      relation: 'references',
      properties: { strength: 'weak', confidence: 0.25, evidence: '页面关联链接' },
    });
  });

  it('does not store a reference when either direction has a semantic edge', () => {
    graph.nodes.length = 0;
    graph.edges.length = 0;

    const result = buildGraphFromPages(
      [
        {
          filename: 'pages/方法论/A.md',
          title: 'A',
          tags: [],
          content: '[B](pages/方法论/B.md)',
        },
        {
          filename: 'pages/方法论/B.md',
          title: 'B',
          tags: [],
          content: '',
        },
      ],
      [{ source: 'B', target: 'A', relation: '支持' }],
    );

    expect(result.edgesCreated).toBe(1);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      relation: '支持',
      sourceId: 'node-2',
      targetId: 'node-1',
    });
  });

  it('keeps the highest-priority semantic relation and stores its evidence', () => {
    graph.nodes.length = 0;
    graph.edges.length = 0;

    const result = buildGraphFromPages(
      [
        { filename: 'pages/方法论/A.md', title: 'A', tags: [], content: '' },
        { filename: 'pages/方法论/B.md', title: 'B', tags: [], content: '' },
      ],
      [
        { source: 'A', target: 'B', relation: '支持', confidence: 0.95, reason: '提供辅助' },
        {
          source: 'B',
          target: 'A',
          relation: '应对',
          confidence: 0.6,
          evidence: '方案用于解决挑战',
        },
      ],
    );

    expect(result.edgesCreated).toBe(1);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      relation: '应对',
      sourceId: 'node-2',
      targetId: 'node-1',
      properties: { strength: 'semantic', confidence: 0.6, evidence: '方案用于解决挑战' },
    });
  });
});
