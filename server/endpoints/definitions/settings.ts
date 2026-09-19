import * as settingsService from '../../services/api/settingsService.js';
import { httpError } from '../helpers.js';
import type { EndpointDescriptor } from '../types.js';
import type { SettingsInput } from '../../types.js';
import * as vectorConnectionService from '../../services/api/vectorConnectionService.js';
import * as jevConnectionService from '../../services/api/jevConnectionService.js';
import { MAX_JEV_TIMEOUT_MS, MIN_JEV_TIMEOUT_MS } from '../../services/api/settingsService.js';

function toSettingsInput(data: Record<string, unknown>): SettingsInput {
  return {
    ...(typeof data.apiUrl === 'string' ? { apiUrl: data.apiUrl } : {}),
    ...(typeof data.modelId === 'string' ? { modelId: data.modelId } : {}),
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : undefined,
    systemPrompt: typeof data.systemPrompt === 'string' ? data.systemPrompt : undefined,
    thinkingMode: typeof data.thinkingMode === 'boolean' ? data.thinkingMode : undefined,
    memoryEnabled: typeof data.memoryEnabled === 'boolean' ? data.memoryEnabled : undefined,
    routingMode: typeof data.routingMode === 'string' ? data.routingMode : undefined,
    reactMaxIterations:
      typeof data.reactMaxIterations === 'number' ? data.reactMaxIterations : undefined,
    toolMaxRetries: typeof data.toolMaxRetries === 'number' ? data.toolMaxRetries : undefined,
    showReactSteps: typeof data.showReactSteps === 'boolean' ? data.showReactSteps : undefined,
    wikiPath: typeof data.wikiPath === 'string' ? data.wikiPath : undefined,
    wikiMaxFileSize: typeof data.wikiMaxFileSize === 'number' ? data.wikiMaxFileSize : undefined,
    wikiSearchMode:
      data.wikiSearchMode === 'hybrid' || data.wikiSearchMode === 'keyword'
        ? data.wikiSearchMode
        : undefined,
    embeddingApiUrl: typeof data.embeddingApiUrl === 'string' ? data.embeddingApiUrl : undefined,
    embeddingModel: typeof data.embeddingModel === 'string' ? data.embeddingModel : undefined,
    embeddingDimensions:
      typeof data.embeddingDimensions === 'number' ? data.embeddingDimensions : undefined,
    vectorStore:
      data.vectorStore === 'chroma' || data.vectorStore === 'sqlite' ? data.vectorStore : undefined,
    chromaUrl: typeof data.chromaUrl === 'string' ? data.chromaUrl : undefined,
    chromaApiKey: typeof data.chromaApiKey === 'string' ? data.chromaApiKey : undefined,
    jevApiUrl: typeof data.jevApiUrl === 'string' ? data.jevApiUrl : undefined,
    jevApiKey: typeof data.jevApiKey === 'string' ? data.jevApiKey : undefined,
    jevModel: typeof data.jevModel === 'string' ? data.jevModel : undefined,
    jevTimeoutMs: typeof data.jevTimeoutMs === 'number' ? data.jevTimeoutMs : undefined,
    jevRoutingEnabled:
      typeof data.jevRoutingEnabled === 'boolean' ? data.jevRoutingEnabled : undefined,
    jevRoutingMinConfidence:
      typeof data.jevRoutingMinConfidence === 'number' ? data.jevRoutingMinConfidence : undefined,
    jevRoutingBypassOnKeyword:
      typeof data.jevRoutingBypassOnKeyword === 'boolean'
        ? data.jevRoutingBypassOnKeyword
        : undefined,
    jevMemoryEnabled:
      typeof data.jevMemoryEnabled === 'boolean' ? data.jevMemoryEnabled : undefined,
    jevMemoryGateThreshold:
      typeof data.jevMemoryGateThreshold === 'number' ? data.jevMemoryGateThreshold : undefined,
  };
}

/** 校验 Jev 端点与阈值；非法时抛 400。 */
function validateJevSettings(data: Record<string, unknown>): void {
  if (data.jevApiUrl !== undefined) {
    if (typeof data.jevApiUrl !== 'string' || !data.jevApiUrl.trim()) {
      throw httpError(400, 'jevApiUrl must be a valid URL');
    }
    try {
      new URL(data.jevApiUrl);
    } catch {
      throw httpError(400, 'jevApiUrl must be a valid URL');
    }
  }
  if (data.jevModel !== undefined && (typeof data.jevModel !== 'string' || !data.jevModel.trim())) {
    throw httpError(400, 'jevModel is required');
  }
  if (
    data.jevTimeoutMs !== undefined &&
    (typeof data.jevTimeoutMs !== 'number' ||
      data.jevTimeoutMs < MIN_JEV_TIMEOUT_MS ||
      data.jevTimeoutMs > MAX_JEV_TIMEOUT_MS)
  ) {
    throw httpError(
      400,
      `jevTimeoutMs must be between ${MIN_JEV_TIMEOUT_MS} and ${MAX_JEV_TIMEOUT_MS}`,
    );
  }
  for (const key of ['jevRoutingMinConfidence', 'jevMemoryGateThreshold'] as const) {
    const value = data[key];
    if (value !== undefined && (typeof value !== 'number' || value < 0 || value > 1)) {
      throw httpError(400, `${key} must be between 0 and 1`);
    }
  }
}

// ── settings:save 的包装函数（包含验证逻辑，Express/IPC 共享） ──

function saveSettings(data: Record<string, unknown>) {
  if (data.apiUrl !== undefined) {
    if (typeof data.apiUrl !== 'string' || !data.apiUrl.trim()) {
      throw httpError(400, 'apiUrl must be a valid URL');
    }
    try {
      new URL(data.apiUrl);
    } catch {
      throw httpError(400, 'apiUrl must be a valid URL');
    }
  }
  if (data.modelId !== undefined && (typeof data.modelId !== 'string' || !data.modelId.trim())) {
    throw httpError(400, 'modelId is required');
  }
  if (
    data.wikiSearchMode !== undefined &&
    data.wikiSearchMode !== 'keyword' &&
    data.wikiSearchMode !== 'hybrid'
  ) {
    throw httpError(400, 'wikiSearchMode must be keyword or hybrid');
  }
  if (data.embeddingDimensions !== undefined && data.embeddingDimensions !== 1024) {
    throw httpError(400, 'embeddingDimensions must be 1024');
  }
  if (data.embeddingApiUrl !== undefined) {
    try {
      new URL(data.embeddingApiUrl as string);
    } catch {
      throw httpError(400, 'embeddingApiUrl must be a valid URL');
    }
  }
  if (
    data.vectorStore !== undefined &&
    data.vectorStore !== 'sqlite' &&
    data.vectorStore !== 'chroma'
  ) {
    throw httpError(400, 'vectorStore must be sqlite or chroma');
  }
  if (data.chromaUrl !== undefined) {
    if (typeof data.chromaUrl !== 'string' || !data.chromaUrl.trim()) {
      throw httpError(400, 'chromaUrl must be a valid URL');
    }
    try {
      new URL(data.chromaUrl);
    } catch {
      throw httpError(400, 'chromaUrl must be a valid URL');
    }
  }
  validateJevSettings(data);
  settingsService.save(toSettingsInput(data));
  return { success: true };
}

/** 校验 Jev 前先解析出待测连接配置：表单值优先，留空则用已存值。 */
function resolveJevConnectionTarget(data: Record<string, unknown>) {
  const stored = settingsService.getJevSettings();
  return {
    apiUrl: typeof data.apiUrl === 'string' && data.apiUrl.trim() ? data.apiUrl : stored.apiUrl,
    apiKey: typeof data.apiKey === 'string' && data.apiKey.trim() ? data.apiKey : stored.apiKey,
    model: typeof data.model === 'string' && data.model.trim() ? data.model : stored.model,
  };
}

export const settingsEndpoints: EndpointDescriptor[] = [
  {
    id: 'settings:get',
    method: 'GET',
    path: '/',
    preloadMethod: 'getSettings',
    service: settingsService.get,
    result: 'direct',
  },
  {
    id: 'settings:save',
    method: 'PUT',
    path: '/',
    preloadMethod: 'saveSettings',
    service: saveSettings,
    args: [{ from: 'body' }],
    result: 'direct',
  },
  {
    id: 'settings:testEmbeddingConnection',
    method: 'POST',
    path: '/test-embedding-connection',
    preloadMethod: 'testEmbeddingConnection',
    service: (data: Record<string, unknown>) =>
      vectorConnectionService.testEmbeddingConnection({
        apiUrl: typeof data.apiUrl === 'string' ? data.apiUrl : '',
        model: typeof data.model === 'string' ? data.model : '',
        dimensions: typeof data.dimensions === 'number' ? data.dimensions : 0,
      }),
    args: [{ from: 'body' }],
    result: 'direct',
    async: true,
  },
  {
    id: 'settings:testChromaConnection',
    method: 'POST',
    path: '/test-chroma-connection',
    preloadMethod: 'testChromaConnection',
    service: (data: Record<string, unknown>) =>
      vectorConnectionService.testChromaConnection(
        typeof data.url === 'string' ? data.url : '',
        typeof data.apiKey === 'string' && data.apiKey.trim()
          ? data.apiKey
          : settingsService.getChromaApiKey(),
      ),
    args: [{ from: 'body' }],
    result: 'direct',
    async: true,
  },
  {
    id: 'settings:testJevConnection',
    method: 'POST',
    path: '/test-jev-connection',
    preloadMethod: 'testJevConnection',
    service: (data: Record<string, unknown>) =>
      jevConnectionService.testJevConnection(resolveJevConnectionTarget(data)),
    args: [{ from: 'body' }],
    result: 'direct',
    async: true,
  },
];
