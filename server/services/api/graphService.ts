import * as graphRepo from '../../repositories/graphRepository.js';
import * as candidateService from './graphCandidateService.js';
import type {
  GraphNode,
  GraphEdge,
  GraphData,
  CreateNodeParams,
  CreateEdgeParams,
} from '../../repositories/graphRepository.js';

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
