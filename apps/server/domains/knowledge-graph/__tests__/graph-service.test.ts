import { afterEach, describe, expect, it, vi } from 'vitest';
import * as graph from '../index.js';
import * as candidates from '../../../infrastructure/persistence/graph-candidate-repository.js';
import { getDb } from '../../../db.js';

const nodeIds = new Set<string>();

/** Create a scoped candidate fixture without clearing shared graph data. */
function candidate(relation = '导致') {
  const source = graph.createNode({
    label: 'domain source',
    type: 'concept',
    sourceFile: 'domain-fixture',
  });
  const target = graph.createNode({
    label: 'domain target',
    type: 'concept',
    sourceFile: 'domain-fixture',
  });
  nodeIds.add(source.id);
  nodeIds.add(target.id);
  return candidates.create({
    sourceId: source.id,
    targetId: target.id,
    relation,
    evidence: 'fixture evidence',
    confidence: 0.9,
    candidateScore: 0.8,
    sourcePage: 'source.md',
    targetPage: 'target.md',
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const id of nodeIds) {
    getDb()
      .prepare('DELETE FROM graph_edge_candidates WHERE source_id = ? OR target_id = ?')
      .run(id, id);
    graph.deleteNode(id);
  }
  nodeIds.clear();
});

describe('Knowledge graph candidate application transactions', () => {
  it('accepts once, creates an evidence-bearing edge and rejects repeated review', () => {
    const item = candidate();
    const edge = graph.acceptCandidate(item.id);
    expect(edge).toMatchObject({
      sourceId: item.sourceId,
      targetId: item.targetId,
      relation: '导致',
      source: 'ai-generated',
    });
    expect(edge.properties).toMatchObject({ evidence: 'fixture evidence', confidence: 0.9 });
    expect(candidates.get(item.id)?.status).toBe('accepted');
    expect(() => graph.acceptCandidate(item.id)).toThrow(expect.objectContaining({ status: 409 }));
  });

  it('rolls back the edge if the candidate status write fails', () => {
    const item = candidate();
    vi.spyOn(candidates, 'review').mockImplementation(() => {
      throw new Error('review write failed');
    });
    expect(() => graph.acceptCandidate(item.id)).toThrow('review write failed');
    expect(graph.findEdgeByTriple(item.sourceId, '导致', item.targetId)).toBeNull();
    expect(candidates.get(item.id)?.status).toBe('pending');
  });

  it('rejects reference relations as semantic candidates without changing their status', () => {
    const item = candidate('references');
    expect(() => graph.acceptCandidate(item.id)).toThrow(expect.objectContaining({ status: 400 }));
    expect(candidates.get(item.id)?.status).toBe('pending');
  });

  it('rejects a candidate with the existing success result and review note', () => {
    const item = candidate();
    expect(graph.rejectCandidate(item.id, ' skip ')).toEqual({ success: true });
    expect(candidates.get(item.id)).toMatchObject({ status: 'rejected', reviewNote: 'skip' });
    expect(graph.findEdgeByTriple(item.sourceId, '导致', item.targetId)).toBeNull();
  });
});
