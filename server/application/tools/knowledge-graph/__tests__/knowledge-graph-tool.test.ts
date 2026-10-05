import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ──
// Mock db.js directly to avoid better-sqlite3 native module dependency.
// The correct path: graphRepository imports from ../db which is server/db.ts

vi.mock('../../../db.js', () => ({
  getDb: () => ({
    prepare: () => ({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    }),
    exec: vi.fn(),
    close: vi.fn(),
  }),
}));

import { KnowledgeGraphTool } from '../knowledge-graph-tool.js';

const ctx = { conversationId: 'test-conv' };

describe('KnowledgeGraphTool', () => {
  const tool = new KnowledgeGraphTool();

  it('should have correct metadata', () => {
    expect(tool.name).toBe('knowledge_graph');
    expect(tool.isReadOnly()).toBe(false);
    expect(tool.isConcurrencySafe()).toBe(false);
  });

  it('should return empty message when graph has no data', async () => {
    const result = await tool.execute({ action: 'query_nodes', query: '' }, ctx);
    expect(result.message).toContain('暂无数据');
  });

  it('should return not found message for unmatched query', async () => {
    const result = await tool.execute({ action: 'query_nodes', query: 'UnknownConcept' }, ctx);
    expect(result.message).toContain('未找到匹配');
  });

  it('should report error when source file is missing', async () => {
    const result = await tool.execute(
      {
        action: 'batch_add',
        nodes: [{ label: 'BadNode', type: 'concept', sourceFile: '' }],
      },
      ctx,
    );

    expect(result.message).toContain('1 个错误');
    expect(result.message).toContain('缺少来源文件');
  });

  it('should throw on invalid action', async () => {
    await expect(tool.execute({ action: 'invalid' as any, query: '' }, ctx)).rejects.toThrow(
      '不支持的操作',
    );
  });

  it('should throw when no nodes or edges provided', async () => {
    await expect(tool.execute({ action: 'batch_add', nodes: [], edges: [] }, ctx)).rejects.toThrow(
      '至少需要提供一个节点或一条关系',
    );
  });
});
