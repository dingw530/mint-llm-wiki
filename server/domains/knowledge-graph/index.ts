export * from './graph-service.js';
export type {
  GraphNode,
  GraphEdge,
  GraphData,
  CreateNodeParams,
  CreateEdgeParams,
} from '../../infrastructure/persistence/graph-repository.js';
export type {
  CandidateStatus,
  GraphEdgeCandidate,
} from '../../infrastructure/persistence/graph-candidate-repository.js';

export { buildGraphFromPages, extractWikiLinks, normalizeRelation } from './graph-builder.js';
export type { BuildGraphResult, GraphNodeTypeResolver } from './graph-builder.js';
