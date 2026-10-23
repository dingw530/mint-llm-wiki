import * as graphRepo from '../../infrastructure/persistence/graph-repository.js';
import * as candidateService from './graph-candidate-service.js';
import * as candidates from '../../infrastructure/persistence/graph-candidate-repository.js';
import type {
  GraphNode,
  GraphEdge,
  GraphData,
  CreateNodeParams,
  CreateEdgeParams,
} from '../../infrastructure/persistence/graph-repository.js';

// ── CRUD ──

export function getGraphData(): GraphData {
  return graphRepo.getGraphData();
}

export function getNode(id: string): GraphNode | null {
  return graphRepo.getNode(id);
}

export function getNodeNeighbors(id: string): { node: GraphNode; edges: GraphEdge[] } | null {
  return graphRepo.getNodeNeighbors(id);
}

export function searchNodes(query: string): GraphNode[] {
  return graphRepo.searchNodes(query);
}

export function createNode(params: CreateNodeParams): GraphNode {
  return graphRepo.createNode(params);
}

export function createEdge(params: CreateEdgeParams): GraphEdge {
  return graphRepo.createEdge(params);
}

export function deleteNode(id: string): void {
  graphRepo.deleteNode(id);
}

export function deleteEdge(id: string): void {
  graphRepo.deleteEdge(id);
}

export const listCandidates = candidateService.listCandidates;
export const acceptCandidate = candidateService.acceptCandidate;
export const rejectCandidate = candidateService.rejectCandidate;

/** Look up an existing edge for idempotent tool-driven graph updates. */
export const findEdgeByTriple = graphRepo.findEdgeByTriple;

/** Read graph nodes that have source-file metadata for cross-batch matching. */
export function getNodesWithSource(): GraphNode[] {
  return graphRepo.getAllNodesWithSource();
}

/** Merge graph nodes for a retired Wiki path into its canonical page node. */
export function mergeWikiPageNode(
  sourcePath: string,
  targetPath: string,
  targetLabel: string,
  targetType: string,
): { targetNodeId: string; mergedNodeCount: number; rewiredEdgeCount: number } {
  return graphRepo.transaction(() => {
    const allNodes = graphRepo.getAllNodesWithSource();
    const sourceNodes = allNodes.filter((node) => node.sourceFile === sourcePath);
    const targetNode =
      allNodes.find((node) => node.sourceFile === targetPath) ||
      graphRepo
        .searchNodes(targetLabel)
        .find(
          (node) =>
            node.label === targetLabel && !sourceNodes.some((source) => source.id === node.id),
        );
    const canonicalNode =
      targetNode ||
      sourceNodes[0] ||
      graphRepo.createNode({
        label: targetLabel,
        type: targetType,
        sourceFile: targetPath,
      });
    graphRepo.updateNodeType(canonicalNode.id, targetType);
    graphRepo.updateNodeSourceFile(canonicalNode.id, targetPath);

    let mergedNodeCount = 0;
    let rewiredEdgeCount = 0;
    for (const sourceNode of sourceNodes) {
      if (sourceNode.id === canonicalNode.id) continue;
      const neighbors = graphRepo.getNodeNeighbors(sourceNode.id);
      for (const edge of neighbors?.edges || []) {
        const sourceId = edge.sourceId === sourceNode.id ? canonicalNode.id : edge.sourceId;
        const targetId = edge.targetId === sourceNode.id ? canonicalNode.id : edge.targetId;
        if (
          sourceId === targetId ||
          graphRepo.findEdgeByTriple(sourceId, edge.relation, targetId)
        ) {
          continue;
        }
        graphRepo.createEdge({
          sourceId,
          relation: edge.relation,
          targetId,
          properties: edge.properties,
          source: graphEdgeSource(edge.source),
        });
        rewiredEdgeCount += 1;
      }
      graphRepo.deleteNode(sourceNode.id);
      mergedNodeCount += 1;
    }
    return { targetNodeId: canonicalNode.id, mergedNodeCount, rewiredEdgeCount };
  });
}

/** Keep only graph edge provenance values accepted by the repository contract. */
function graphEdgeSource(source: string): 'manual' | 'auto-extracted' | 'ai-generated' {
  if (source === 'auto-extracted' || source === 'ai-generated') return source;
  return 'manual';
}

/** Find the canonical graph node matching an exact label. */
export function findNodeByLabel(label: string): GraphNode | null {
  return graphRepo.searchNodes(label).find((node) => node.label === label) ?? null;
}

/** Create a reviewable semantic edge candidate through the Graph domain boundary. */
export function createGraphCandidate(input: Parameters<typeof candidates.create>[0]) {
  return candidates.create(input);
}
