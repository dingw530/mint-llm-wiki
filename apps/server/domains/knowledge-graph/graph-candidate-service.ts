import * as candidates from '../../infrastructure/persistence/graph-candidate-repository.js';
import * as graphRepo from '../../infrastructure/persistence/graph-repository.js';
import { normalizeGraphRelation } from '../../utils/graphOntology.js';
export const listCandidates = (status?: candidates.CandidateStatus) => candidates.list(status);
export function acceptCandidate(id: string) {
  return candidates.transaction(() => {
    const item = candidates.get(id);
    if (!item) throw Object.assign(new Error('候选不存在'), { status: 404 });
    if (item.status !== 'pending') throw Object.assign(new Error('候选已处理'), { status: 409 });
    const hasSemantic = graphRepo
      .getAllEdges()
      .some(
        (e) =>
          e.relation !== 'references' &&
          ((e.sourceId === item.sourceId && e.targetId === item.targetId) ||
            (e.sourceId === item.targetId && e.targetId === item.sourceId)),
      );
    if (hasSemantic) throw Object.assign(new Error('该节点对已有正式语义边'), { status: 409 });
    const relation = normalizeGraphRelation(item.relation);
    if (!relation || relation === 'references')
      throw Object.assign(new Error('候选关系无效'), { status: 400 });
    const edge = graphRepo.createEdge({
      sourceId: item.sourceId,
      targetId: item.targetId,
      relation,
      source: 'ai-generated',
      properties: {
        strength: 'semantic',
        confidence: item.confidence,
        evidence: item.evidence,
        evidenceType: 'source_excerpt',
        sourceFile: item.sourcePage,
      },
    });
    candidates.review(id, 'accepted');
    return edge;
  });
}
export function rejectCandidate(id: string, note?: string) {
  const item = candidates.get(id);
  if (!item) throw Object.assign(new Error('候选不存在'), { status: 404 });
  if (item.status !== 'pending') throw Object.assign(new Error('候选已处理'), { status: 409 });
  candidates.review(id, 'rejected', note);
  return { success: true };
}
