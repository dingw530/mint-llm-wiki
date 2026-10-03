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

/** Find the canonical graph node matching an exact label. */
export function findNodeByLabel(label: string): GraphNode | null {
  return graphRepo.searchNodes(label).find((node) => node.label === label) ?? null;
}

/** Create a reviewable semantic edge candidate through the Graph domain boundary. */
export function createGraphCandidate(input: Parameters<typeof candidates.create>[0]) {
  return candidates.create(input);
}
