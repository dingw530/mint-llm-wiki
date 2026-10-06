import * as graphService from '../../domains/knowledge-graph/index.js';
import type { EndpointDescriptor } from '../types.js';
import type { CandidateStatus } from '../../domains/knowledge-graph/index.js';

export const graphEndpoints: EndpointDescriptor[] = [
  {
    id: 'graph:data',
    method: 'GET',
    path: '/data',
    preloadMethod: 'getGraphData',
    service: graphService.getGraphData,
    args: [],
    result: 'direct',
  },
  {
    id: 'graph:node',
    method: 'GET',
    path: '/node/:id',
    preloadMethod: 'getGraphNode',
    service: (id: string) => graphService.getNode(id),
    args: [{ from: 'path', name: 'id' }],
    result: 'direct',
  },
  {
    id: 'graph:neighbors',
    method: 'GET',
    path: '/node/:id/neighbors',
    preloadMethod: 'getGraphNodeNeighbors',
    service: (id: string) => graphService.getNodeNeighbors(id),
    args: [{ from: 'path', name: 'id' }],
    result: 'direct',
  },
  {
    id: 'graph:search',
    method: 'GET',
    path: '/search',
    preloadMethod: 'searchGraphNodes',
    service: (query: string) => graphService.searchNodes(query),
    args: [{ from: 'query', name: 'query' }],
    result: 'direct',
  },
  {
    id: 'graph:createNode',
    method: 'POST',
    path: '/node',
    preloadMethod: 'createGraphNode',
    service: (data: Record<string, unknown>) => {
      const node = graphService.createNode({
        label: data.label as string,
        type: data.type as string,
        sourceFile: data.sourceFile as string | undefined,
        properties: data.properties as Record<string, unknown> | undefined,
      });
      return node;
    },
    args: [{ from: 'body' }],
    result: 'direct',
  },
  {
    id: 'graph:createEdge',
    method: 'POST',
    path: '/edge',
    preloadMethod: 'createGraphEdge',
    service: (data: Record<string, unknown>) => {
      const edge = graphService.createEdge({
        sourceId: data.sourceId as string,
        relation: data.relation as string,
        targetId: data.targetId as string,
        properties: data.properties as Record<string, unknown> | undefined,
        source: data.source as 'manual' | 'auto-extracted' | 'ai-generated' | undefined,
      });
      return edge;
    },
    args: [{ from: 'body' }],
    result: 'direct',
  },
  {
    id: 'graph:deleteNode',
    method: 'DELETE',
    path: '/node/:id',
    preloadMethod: 'deleteGraphNode',
    service: (id: string) => {
      graphService.deleteNode(id);
      return { success: true };
    },
    args: [{ from: 'path', name: 'id' }],
    result: 'direct',
  },
  {
    id: 'graph:deleteEdge',
    method: 'DELETE',
    path: '/edge/:id',
    preloadMethod: 'deleteGraphEdge',
    service: (id: string) => {
      graphService.deleteEdge(id);
      return { success: true };
    },
    args: [{ from: 'path', name: 'id' }],
    result: 'direct',
  },
  {
    id: 'graph:listCandidates',
    method: 'GET',
    path: '/candidates',
    preloadMethod: 'listGraphCandidates',
    service: (status?: string) =>
      graphService.listCandidates(status as CandidateStatus | undefined),
    args: [{ from: 'query', name: 'status', optional: true }],
    result: 'direct',
  },
  {
    id: 'graph:acceptCandidate',
    method: 'POST',
    path: '/candidates/:id/accept',
    preloadMethod: 'acceptGraphCandidate',
    service: (id: string) => graphService.acceptCandidate(id),
    args: [{ from: 'path', name: 'id' }],
    result: 'direct',
  },
  {
    id: 'graph:rejectCandidate',
    method: 'POST',
    path: '/candidates/:id/reject',
    preloadMethod: 'rejectGraphCandidate',
    service: (id: string, body: { note?: string }) => graphService.rejectCandidate(id, body?.note),
    args: [{ from: 'path', name: 'id' }, { from: 'body' }],
    result: 'direct',
  },
];
