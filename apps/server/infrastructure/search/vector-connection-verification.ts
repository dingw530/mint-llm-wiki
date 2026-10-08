import { ChromaClient } from 'chromadb';

const EMBEDDING_TIMEOUT_MS = 60_000;
const CHROMA_TIMEOUT_MS = 10_000;

export interface EmbeddingConnectionInput {
  apiUrl: string;
  model: string;
  dimensions: number;
}

export interface ConnectionTestResult {
  success: boolean;
  message?: string;
  dimensions?: number;
}

function validateUrl(value: string, label: string): URL {
  if (!value.trim()) throw Object.assign(new Error(`${label}不能为空`), { status: 400 });
  try {
    return new URL(value.trim());
  } catch {
    throw Object.assign(new Error(`${label}格式无效`), { status: 400 });
  }
}

function embeddingUrl(apiUrl: string): string {
  const url = validateUrl(apiUrl, 'Embedding 服务 URL');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/embeddings`;
  return url.toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Tests an OpenAI-compatible embedding endpoint with one short input. */
export async function testEmbeddingConnection(
  input: EmbeddingConnectionInput,
): Promise<ConnectionTestResult> {
  if (!input.model.trim())
    throw Object.assign(new Error('Embedding 模型不能为空'), { status: 400 });
  if (input.dimensions !== 1024)
    throw Object.assign(new Error('Embedding 向量维度必须为 1024'), { status: 400 });
  try {
    const response = await fetch(embeddingUrl(input.apiUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: input.model.trim(), input: 'test' }),
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    });
    if (!response.ok)
      return { success: false, message: `Embedding 服务返回 HTTP ${response.status}` };
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.data))
      return { success: false, message: 'Embedding 响应缺少 data 数组' };
    const first = payload.data[0];
    const vector = isRecord(first) ? first.embedding : undefined;
    if (!Array.isArray(vector)) return { success: false, message: 'Embedding 响应缺少向量' };
    if (vector.length !== input.dimensions)
      return {
        success: false,
        message: `向量维度不匹配：返回 ${vector.length}，期望 ${input.dimensions}`,
      };
    return { success: true, dimensions: vector.length, message: 'Embedding 服务连接成功' };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'Embedding 服务连接超时'
          : errorMessage(error),
    };
  }
}

/** Tests a Chroma Server without creating or mutating a collection. */
export async function testChromaConnection(
  chromaUrl: string,
  apiKey?: string,
): Promise<ConnectionTestResult> {
  const endpoint = validateUrl(chromaUrl, 'Chroma Server URL');
  const client = new ChromaClient({
    host: endpoint.hostname,
    port: Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)),
    ssl: endpoint.protocol === 'https:',
    headers: apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined,
    fetchOptions: { signal: AbortSignal.timeout(CHROMA_TIMEOUT_MS) },
  });
  try {
    await client.heartbeat();
    return { success: true, message: 'Chroma Server 连接成功' };
  } catch (error) {
    return { success: false, message: errorMessage(error) };
  }
}
