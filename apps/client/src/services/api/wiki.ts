import { callEndpoint, isElectron, getElectronAPI, ipcOrHttp, request } from '../api/_base';
import type { WikiCategory, WikiFileTreeNode } from '@/types';

export interface WikiListResponse {
  tree: WikiFileTreeNode[];
  total: number;
}

export interface WikiReadResponse {
  content: string;
  path: string;
  name: string;
  size: number;
}

export interface WikiSchema {
  categories: WikiCategory[];
  [key: string]: unknown;
}

export interface WikiHeatPage {
  id: string;
  path: string;
  title: string;
  status: 'draft' | 'active' | 'stale' | 'archived' | 'superseded' | 'deleted';
  accessCount: number;
  confidence: number;
  importance: number;
  retentionScore: number;
  lastAccessedAt: string | null;
  lastConfirmedAt: string | null;
}

export interface WikiHeatResponse {
  summary: {
    totalPages: number;
    activePages: number;
    stalePages: number;
    archivedPages: number;
    totalAccesses: number;
  };
  pages: WikiHeatPage[];
}

export interface WikiVectorHealth {
  documentCount: number;
  vectorizedCount: number;
  pendingCount: number;
  failedCount: number;
  orphanCount: number;
  coverage: number;
  model: string;
  dimensions: number;
  lastIndexedAt: string | null;
}

export interface WikiVectorBackfillJob {
  id: string;
  scope: 'all' | 'prefix' | 'selected';
  prefix: string | null;
  paths: string[];
  status: 'queued' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  indexed: number;
  skipped: number;
  failed: number;
  currentPath: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}
export interface UploadJob {
  id: string;
  status?: string;
  fileName: string;
  fileSize: number;
  progress: number;
  step: string;
  result?: {
    sourceFile: string;
    format: string;
    textLength: number;
    pageCount?: number;
    preview: string;
    pages?: { filename: string; title: string; size: number; summary?: string }[];
    sourceUrls?: string[];
    sourcePreviewKind?: 'text' | 'markdown' | 'html' | 'unsupported';
    graphErrors?: string[];
    failedItems?: Array<{ name: string; error: string }>;
  };
  error?: string;
  createdAt: string;
  updatedAt: string;
  sourceType?: 'upload' | 'chat';
  conversationId?: string | null;
  fileCount?: number;
  attempts?: number;
  statusLabel?: string;
  phase?: 'active' | 'success' | 'error' | 'cancelled';
  isTerminal?: boolean;
  isSuccessful?: boolean;
  canCancel?: boolean;
  canRetry?: boolean;
}

export interface WikiJobsResponse {
  jobs: UploadJob[];
  total: number;
}

export function listWikiJobs(status?: string, limit?: number): Promise<WikiJobsResponse> {
  if (isElectron()) return getElectronAPI()!.listWikiJobs(status, limit);
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (limit) params.set('limit', String(limit));
  return request(`/wiki/jobs${params.toString() ? `?${params}` : ''}`);
}

export async function getWikiJob(jobId: string): Promise<UploadJob> {
  if (isElectron()) return (await getElectronAPI()!.getWikiJob(jobId)).job;
  const result = await request<{ job: UploadJob }>(`/wiki/jobs/${encodeURIComponent(jobId)}`);
  return result.job;
}

export async function retryWikiJob(jobId: string): Promise<UploadJob> {
  if (isElectron()) return (await getElectronAPI()!.retryWikiJob(jobId)).job;
  const result = await request<{ job: UploadJob }>(`/wiki/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' });
  return result.job;
}

export async function cancelWikiJob(jobId: string): Promise<UploadJob> {
  if (isElectron()) return (await getElectronAPI()!.cancelWikiJob(jobId)).job;
  const result = await request<{ job: UploadJob }>(`/wiki/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
  return result.job;
}

export async function removeWikiJob(jobId: string): Promise<{ success: true; jobId: string }> {
  if (isElectron()) return getElectronAPI()!.removeWikiJob(jobId);
  return request<{ success: true; jobId: string }>(`/wiki/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
}

export interface UploadJobResponse {
  job: UploadJob;
}

export interface UploadStartResponse {
  jobId: string;
  sourceFile: string;
  fileName: string;
  fileSize: number;
}

export function listWiki(): Promise<WikiListResponse> {
  return callEndpoint<WikiListResponse>('wiki:list');
}

export function readWiki(path: string): Promise<WikiReadResponse> {
  return callEndpoint<WikiReadResponse>('wiki:read', path);
}

export function getWikiHeat(limit = 30): Promise<WikiHeatResponse> {
  return callEndpoint<WikiHeatResponse>('wiki:heat', limit);
}

/** 获取向量索引健康度。 */
export function getWikiVectorHealth(): Promise<WikiVectorHealth> {
  return callEndpoint<WikiVectorHealth>('wiki:getVectorHealth');
}

/** 启动 Wiki 向量回填任务。 */
export async function startWikiVectorBackfill(input: { scope: 'all' | 'prefix' | 'selected'; prefix?: string; paths?: string[] }): Promise<WikiVectorBackfillJob> {
  const result = await callEndpoint<{ job: WikiVectorBackfillJob }>('wiki:startVectorBackfill', input);
  return result.job;
}

/** 获取向量回填任务状态。 */
export async function getWikiVectorBackfill(jobId: string): Promise<WikiVectorBackfillJob> {
  const result = await callEndpoint<{ job: WikiVectorBackfillJob }>('wiki:getVectorBackfill', jobId);
  return result.job;
}

/** 重试失败的向量回填任务。 */
export async function retryWikiVectorBackfill(jobId: string): Promise<WikiVectorBackfillJob> {
  const result = await callEndpoint<{ job: WikiVectorBackfillJob }>('wiki:retryVectorBackfill', jobId);
  return result.job;
}

/**
 * 在 Obsidian 中打开当前配置的 Wiki 根目录。
 */
export function openWikiInObsidian(): Promise<{ success: boolean }> {
  if (!isElectron()) throw new Error('仅桌面端支持在 Obsidian 中打开');
  return getElectronAPI()!.openWikiInObsidian();
}

/**
 * 上传文件到 Wiki（异步），返回 jobId
 */
export async function uploadWiki(file: File): Promise<string> {
  const electron = isElectron();
  const api = getElectronAPI();
  console.log(
    '[wiki:uploadWiki] isElectron=',
    electron,
    'api=',
    !!api,
    'electronAPI=',
    !!window.electronAPI,
  );

  if (electron) {
    const buffer = await file.arrayBuffer();
    const result: UploadStartResponse = await api!.uploadWiki({
      name: file.name,
      size: file.size,
      buffer: Array.from(new Uint8Array(buffer)),
    });
    return result.jobId;
  }

  console.log('[wiki:uploadWiki] using HTTP path');
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/wiki/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const text = await res.text();
  console.log(
    '[wiki:uploadWiki] HTTP response length=',
    text.length,
    'preview=',
    text.substring(0, 80),
  );
  try {
    const data: UploadStartResponse = JSON.parse(text);
    return data.jobId;
  } catch {
    throw new Error(`服务返回异常（非 JSON 格式），请确认后端服务运行在端口 3001`);
  }
}

/**
 * 轮询作业状态
 */
export async function getJobStatus(jobId: string): Promise<UploadJob> {
  const electron = isElectron();
  console.log('[wiki:getJobStatus] isElectron=', electron, 'jobId=', jobId);

  if (electron) {
    const api = getElectronAPI();
    try {
      const result = await api!.getJobStatus(jobId);
      console.log('[wiki:getJobStatus] IPC result status=', result?.status);
      return result;
    } catch (err) {
      console.log('[wiki:getJobStatus] IPC error:', (err as Error).message);
      throw err;
    }
  }

  console.log('[wiki:getJobStatus] using HTTP path');
  const res = await fetch(`/api/wiki/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ error: `HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const text = await res.text();
  console.log(
    '[wiki:getJobStatus] HTTP response length=',
    text.length,
    'preview=',
    text.substring(0, 80),
  );
  try {
    const data: UploadJobResponse = JSON.parse(text);
    return data.job;
  } catch {
    throw new Error(`服务返回异常（非 JSON 格式），请确认后端服务运行在端口 3001`);
  }
}

export function getWikiSchema(): Promise<WikiSchema> {
  return callEndpoint<WikiSchema>('wiki:schema');
}

export function addWikiCategory(category: string): Promise<WikiSchema> {
  return callEndpoint<WikiSchema>('wiki:addCategory', category);
}

export function removeWikiCategory(category: string): Promise<WikiSchema> {
  return callEndpoint<WikiSchema>('wiki:removeCategory', category);
}

export function updateWikiSchema(schema: WikiSchema): Promise<WikiSchema> {
  return callEndpoint<WikiSchema>('wiki:updateSchema', schema);
}

// ── 知识图谱 API ──

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  sourceFile: string | null;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  relation: string;
  targetId: string;
  properties: Record<string, unknown>;
  source: string;
  createdAt: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
export interface GraphEdgeCandidate {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  evidence: string;
  confidence: number;
  candidateScore: number;
  sourcePage: string;
  targetPage: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export function getGraphData(): Promise<GraphData> {
  return callEndpoint<GraphData>('graph:data');
}

export function getGraphNode(id: string): Promise<{ node: GraphNode; edges: GraphEdge[] } | null> {
  return callEndpoint<{ node: GraphNode; edges: GraphEdge[] } | null>('graph:node', id);
}

export function getGraphNodeNeighbors(
  id: string,
): Promise<{ node: GraphNode; edges: GraphEdge[] } | null> {
  return callEndpoint<{ node: GraphNode; edges: GraphEdge[] } | null>('graph:neighbors', id);
}

export function searchGraphNodes(query: string): Promise<GraphNode[]> {
  return callEndpoint<GraphNode[]>('graph:search', query);
}

export function createGraphNode(data: {
  label: string;
  type: string;
  sourceFile?: string;
  properties?: Record<string, unknown>;
}): Promise<GraphNode> {
  return callEndpoint<GraphNode>('graph:createNode', data);
}

export function createGraphEdge(data: {
  sourceId: string;
  relation: string;
  targetId: string;
  properties?: Record<string, unknown>;
  source?: string;
}): Promise<GraphEdge> {
  return callEndpoint<GraphEdge>('graph:createEdge', data);
}
export function listGraphCandidates(status = 'pending'): Promise<GraphEdgeCandidate[]> {
  return ipcOrHttp(
    () => getElectronAPI()!.listGraphCandidates(status) as Promise<GraphEdgeCandidate[]>,
    () => request<GraphEdgeCandidate[]>(`/graph/candidates?status=${encodeURIComponent(status)}`),
  );
}
export function acceptGraphCandidate(id: string): Promise<GraphEdge> {
  return ipcOrHttp(
    () => getElectronAPI()!.acceptGraphCandidate(id) as Promise<GraphEdge>,
    () => request<GraphEdge>(`/graph/candidates/${id}/accept`, { method: 'POST' }),
  );
}
export function rejectGraphCandidate(id: string, note?: string): Promise<{ success: true }> {
  return ipcOrHttp(
    () => getElectronAPI()!.rejectGraphCandidate(id, { note }) as Promise<{ success: true }>,
    () =>
      request<{ success: true }>(`/graph/candidates/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
  );
}
