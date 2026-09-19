import type { ElectronAPI } from '@/types';

// ── 常量 ──

export const BASE_URL = '/api';

// 运行时检测 Electron 环境（避免模块加载时序问题）
export function getElectronAPI(): ElectronAPI | undefined {
  return window.electronAPI;
}
export function isElectron(): boolean {
  return !!getElectronAPI()?.isElectron;
}

// ── HTTP 请求 ──

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const text = await res.text();
  console.log(
    `[request] ${options?.method || 'GET'} ${path} => ${text.length} bytes, preview=${text.substring(0, 60)}`,
  );
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP 响应非 JSON 格式（${path}），请确认后端运行在 3001 端口`);
  }
}

// ── IPC/HTTP 双通道 ──

export async function ipcOrHttp<T>(
  ipcCall: () => Promise<T>,
  httpCall: () => Promise<T>,
): Promise<T> {
  if (!isElectron()) return httpCall();
  return ipcCall();
}

// ── Endpoint Manifest ──

export interface ManifestEntry {
  id: string;
  ipcChannel: string;
  preloadMethod: string | null;
  method: string;
  httpPath: string;
  args: readonly { from: string; name?: string; optional?: boolean }[];
  result: string | null;
  async: boolean;
}

function isManifestEntry(value: unknown): value is ManifestEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ManifestEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.ipcChannel === 'string' &&
    typeof entry.method === 'string' &&
    typeof entry.httpPath === 'string'
  );
}

let manifestCache: ManifestEntry[] | null = null;

export async function getManifest(): Promise<ManifestEntry[]> {
  if (manifestCache) return manifestCache;
  try {
    const mod = await import('../../../../electron/endpoints-manifest.json');
    const candidate: unknown = mod.default || mod;
    manifestCache = Array.isArray(candidate) ? candidate.filter(isManifestEntry) : [];
  } catch {
    manifestCache = [];
  }
  return manifestCache;
}

// ── callEndpoint ──

export async function callEndpoint<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
  const manifest = await getManifest();
  const ep = manifest.find((e) => e.id === id);
  if (!ep) throw new Error(`Unknown endpoint: ${id}`);

  return ipcOrHttp(
    () => {
      if (!ep.preloadMethod) throw new Error(`No preload method for ${id}`);
      const api = getElectronAPI();
      if (!api) throw new Error(`Electron API unavailable for ${id}`);
      const method = api[ep.preloadMethod as keyof ElectronAPI];
      if (typeof method !== 'function') throw new Error(`No preload method for ${id}`);
      return (method as (...methodArgs: unknown[]) => Promise<T>)(...args);
    },
    () => {
      const url = buildUrlFromManifest(ep, args);
      const body = extractBodyFromManifest(ep, args);
      return request<T>(url, {
        method: ep.method,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    },
  );
}

export function buildUrlFromManifest(ep: ManifestEntry, args: unknown[]): string {
  let url = ep.httpPath;
  let argIdx = 0;
  for (const mapping of ep.args) {
    if (mapping.from === 'path') {
      if (mapping.name) url = url.replace(`:${mapping.name}`, String(args[argIdx]));
    } else if (mapping.from === 'query') {
      const value = args[argIdx];
      if (value !== undefined && value !== null) {
        const sep = url.includes('?') ? '&' : '?';
        if (mapping.name) url += `${sep}${mapping.name}=${encodeURIComponent(String(value))}`;
      }
    }
    argIdx++;
  }
  return url;
}

export function extractBodyFromManifest(ep: ManifestEntry, args: unknown[]): unknown {
  const bodyMapping = ep.args.find((a) => a.from === 'body');
  if (!bodyMapping) return undefined;
  return args[ep.args.indexOf(bodyMapping)];
}

// ── SSE chunk 解析（IPC/HTTP 共享） ──

import type { SendCallbacks } from '@/types';

export function parseSSEChunk(
  data: Record<string, unknown>,
  callbacks: SendCallbacks,
  lastThought: { value: string },
) {
  if (!hasValidRunEnvelope(data)) return;
  if (data.type) {
    switch (data.type) {
      case 'run_started':
        callbacks.onRunStarted?.(data);
        return;
      case 'round_started':
        callbacks.onRoundStarted?.(data);
        return;
      case 'agent_status':
        callbacks.onAgentStatus?.(data);
        return;
      case 'loop_detected':
        callbacks.onLoopDetected?.(data);
        return;
      case 'run_completed':
        callbacks.onRunCompleted?.(data);
        if (data.estimatedTokens != null) callbacks.onTokenUsage?.(data);
        return;
      case 'a2ui':
        callbacks.onA2ui?.(data);
        return;
      case 'run_cancelled':
        callbacks.onRunCancelled?.(data);
        return;
      case 'token_usage':
        callbacks.onTokenUsage?.(data);
        return;
      case 'run_failed':
        callbacks.onError?.(new Error(String(data.error || 'ReAct run failed')));
        return;
      case 'thought':
        if (data.content) lastThought.value += data.content;
        if (data.content) callbacks.onThought?.(data.content as string);
        if (data.reasoning) callbacks.onReasoning?.(data.reasoning as string);
        return;
      case 'tool_call_start':
        lastThought.value = '';
        callbacks.onToolCallStart?.(data);
        return;
      case 'tool_call_end':
        lastThought.value = '';
        callbacks.onToolCallEnd?.(data);
        return;
      case 'tool_call_error':
        lastThought.value = '';
        callbacks.onToolCallError?.(data);
        return;
      case 'approval_required':
        lastThought.value = '';
        callbacks.onToolApprovalRequired?.(data);
        return;
      case 'answer':
        if (data.content) callbacks.onChunk?.(data.content as string);
        if (data.reasoning) callbacks.onReasoning?.(data.reasoning as string);
        return;
      case 'answer_ready':
        if (lastThought.value) callbacks.onAnswerReady?.(lastThought.value);
        lastThought.value = '';
        return;
    }
  }
  if (data.content) callbacks.onChunk?.(data.content as string);
  if (data.reasoning) callbacks.onReasoning?.(data.reasoning as string);
  if (data.agent) callbacks.onRouting?.(data.agent as string);
}

/** Accepts legacy events and complete AgentRun envelopes, while rejecting half-formed run identities. */
function hasValidRunEnvelope(data: Record<string, unknown>): boolean {
  const hasRunId = Object.prototype.hasOwnProperty.call(data, 'runId');
  const hasSequence = Object.prototype.hasOwnProperty.call(data, 'sequence');
  if (!hasRunId && !hasSequence) return true;
  return (
    typeof data.runId === 'string' &&
    data.runId.length > 0 &&
    typeof data.sequence === 'number' &&
    Number.isSafeInteger(data.sequence) &&
    data.sequence > 0
  );
}
