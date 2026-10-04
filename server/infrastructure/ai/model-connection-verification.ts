import type { ApiAdapter } from './adapters/api-adapter.js';

export const SUPPORTED_API_TYPES = ['openai-chat', 'openai-responses', 'anthropic'] as const;
export type SupportedApiType = (typeof SUPPORTED_API_TYPES)[number];
export type ConnectionErrorCategory = 'retryable' | 'configuration' | 'unknown';

export interface ConnectionInput {
  apiUrl: string;
  apiKey?: string;
  modelId: string;
  apiType?: string;
}

export interface ModelListResult {
  models: string[];
  available: boolean;
}

export interface ConnectionTestResult {
  success: boolean;
  errorCategory?: ConnectionErrorCategory;
  errorMessage?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const MODEL_LIST_TIMEOUT_MS = 10_000;
const CONNECTION_TEST_TIMEOUT_MS = 30_000;
const TEST_PROMPT = 'Reply with the single word: OK';

function getApiType(apiType?: string): SupportedApiType {
  const selectedType = apiType || 'openai-chat';
  const supportedType = SUPPORTED_API_TYPES.find((supported) => supported === selectedType);
  if (supportedType) return supportedType;
  throw Object.assign(new Error('API 类型不受支持'), { status: 400 });
}

function validateInput(input: ConnectionInput): SupportedApiType {
  if (!input.apiUrl?.trim()) throw Object.assign(new Error('API URL 不能为空'), { status: 400 });
  try {
    new URL(input.apiUrl);
  } catch {
    throw Object.assign(new Error('API URL 格式无效'), { status: 400 });
  }
  if (!input.modelId?.trim()) throw Object.assign(new Error('模型不能为空'), { status: 400 });
  return getApiType(input.apiType || 'openai-chat');
}

function authHeaders(apiKey?: string): Record<string, string> {
  const key = apiKey?.trim();
  return key ? { Authorization: `Bearer ${key}`, 'x-api-key': key } : {};
}

function modelsUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = `${pathname.endsWith('/v1') ? pathname : `${pathname}/v1`}/models`;
  return url.toString();
}

function extractModels(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const candidates = Array.isArray(value.data)
    ? value.data
    : Array.isArray(value.models)
      ? value.models
      : [];
  return candidates.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string')
      return [item.id];
    return [];
  });
}

function classifyError(error: unknown): ConnectionErrorCategory {
  const status =
    error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
      ? error.status
      : undefined;
  if (status === 401 || status === 403 || status === 404) return 'configuration';
  if (status === 429 || (status !== undefined && status >= 500)) return 'retryable';
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/timeout|network|fetch failed|econn|enotfound|socket/.test(message)) return 'retryable';
  if (
    /model|api key|unauthor|forbidden|not found|invalid.*(request|parameter)|bad request/.test(
      message,
    )
  )
    return 'configuration';
  return 'unknown';
}

function messageFor(category: ConnectionErrorCategory): string {
  if (category === 'retryable') return '连接暂时失败，请重试。';
  if (category === 'configuration')
    return '模型连接配置无效，请检查 API URL、API Key、API 类型和模型。';
  return '连接失败，请检查配置或重试。';
}

/** Attempts to retrieve model IDs without making model configuration a blocking step. */
export async function listModels(input: ConnectionInput): Promise<ModelListResult> {
  validateInput({ ...input, modelId: input.modelId || 'model-list-placeholder' });
  try {
    const response = await fetch(modelsUrl(input.apiUrl), {
      headers: authHeaders(input.apiKey),
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    });
    if (!response.ok) return { models: [], available: false };
    return { models: extractModels(await response.json()), available: true };
  } catch {
    return { models: [], available: false };
  }
}

/** Sends a bounded real request used to verify a model connection before persistence. */
export interface ModelConnectionService {
  listModels(input: ConnectionInput): Promise<ModelListResult>;
  testConnection(input: ConnectionInput): Promise<ConnectionTestResult>;
}

/** Creates the provider-backed checker without importing adapter registration into infrastructure. */
export function createModelConnectionVerifier(
  resolveAdapter: (apiType: SupportedApiType) => ApiAdapter | undefined,
): ModelConnectionService {
  return {
    listModels,
    testConnection: async (input) => {
      const apiType = validateInput(input);
      const adapter = resolveAdapter(apiType);
      if (!adapter)
        return {
          success: false,
          errorCategory: 'configuration',
          errorMessage: 'API 类型不受支持。',
        };

      try {
        const content = await adapter.call(
          [{ role: 'user', content: TEST_PROMPT }],
          { modelId: input.modelId.trim() },
          input.apiUrl.trim(),
          input.apiKey?.trim() || '',
          { maxTokens: 16, signal: AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS) },
        );
        if (!content.trim())
          return { success: false, errorCategory: 'unknown', errorMessage: '模型返回空响应。' };
        return { success: true };
      } catch (error) {
        const errorCategory = classifyError(error);
        return { success: false, errorCategory, errorMessage: messageFor(errorCategory) };
      }
    },
  };
}
