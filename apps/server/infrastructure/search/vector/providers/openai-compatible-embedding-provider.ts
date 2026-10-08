import type { EmbeddingProvider } from '../ports.js';
import type { OpenAICompatibleEmbeddingConfig } from '../types.js';
import {
  ExternalServiceError,
  resilientCall,
  type ExternalErrorCategory,
  embeddingPolicy,
} from '../../../resilience/index.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BATCH_SIZE = 16;

/** Error raised when an embedding provider cannot return a valid vector batch. */
export class EmbeddingServiceError extends ExternalServiceError {
  constructor(message: string, category: ExternalErrorCategory = 'protocol') {
    super(message, category, 'embedding');
    this.name = 'EmbeddingServiceError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function embeddingEndpoint(apiUrl: string): string {
  const trimmed = apiUrl.trim().replace(/\/$/, '');
  return trimmed.endsWith('/embeddings') ? trimmed : `${trimmed}/embeddings`;
}

function parseEmbeddingResponse(
  value: unknown,
  expectedCount: number,
  dimensions: number,
): number[][] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new EmbeddingServiceError('Embedding response must contain a data array');
  }
  const items = value.data;
  if (items.length !== expectedCount) {
    throw new EmbeddingServiceError(
      `Embedding response count mismatch: expected ${expectedCount}, got ${items.length}`,
    );
  }
  const ordered = items.map((item, fallbackIndex) => {
    if (!isRecord(item) || typeof item.index !== 'number' || !Array.isArray(item.embedding)) {
      throw new EmbeddingServiceError('Embedding response contains an invalid item');
    }
    const embedding = item.embedding.filter(
      (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
    );
    if (embedding.length !== dimensions || embedding.length !== item.embedding.length) {
      throw new EmbeddingServiceError(`Embedding dimension mismatch: expected ${dimensions}`);
    }
    return { index: item.index, embedding, fallbackIndex };
  });
  ordered.sort(
    (left, right) => left.index - right.index || left.fallbackIndex - right.fallbackIndex,
  );
  if (ordered.some((item, index) => item.index !== index)) {
    throw new EmbeddingServiceError('Embedding response indexes are invalid');
  }
  return ordered.map((item) => item.embedding);
}

async function embedBatch(
  texts: string[],
  config: OpenAICompatibleEmbeddingConfig,
): Promise<number[][]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(embeddingEndpoint(config.apiUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.model, input: texts }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const category: ExternalErrorCategory =
        response.status === 429
          ? 'rate_limited'
          : [502, 503, 504].includes(response.status)
            ? 'server_unavailable'
            : response.status === 401 || response.status === 403
              ? 'authentication'
              : 'protocol';
      throw new EmbeddingServiceError(
        `Embedding request failed with HTTP ${response.status}`,
        category,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new EmbeddingServiceError('Embedding response is not valid JSON');
    }
    return parseEmbeddingResponse(payload, texts.length, config.dimensions);
  } catch (error) {
    if (error instanceof EmbeddingServiceError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new EmbeddingServiceError('Embedding request timed out', 'timeout');
    }
    const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : error;
    const category: ExternalErrorCategory =
      cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ECONNREFUSED'
        ? 'connection_refused'
        : 'network_transient';
    throw new EmbeddingServiceError(
      `Embedding request failed: ${error instanceof Error ? error.message : String(error)}`,
      category,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** OpenAI-compatible Embedding provider used by the current Wiki vector path. */
export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly config: OpenAICompatibleEmbeddingConfig) {}

  /** Embeds a batch while preserving input order and the existing validation rules. */
  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.config.apiUrl.trim()) throw new EmbeddingServiceError('Embedding API URL is empty');
    if (!this.config.model.trim()) throw new EmbeddingServiceError('Embedding model is empty');
    if (this.config.dimensions !== 1024)
      throw new EmbeddingServiceError('Embedding dimensions must be 1024');

    const batches: number[][] = [];
    for (let start = 0; start < texts.length; start += MAX_BATCH_SIZE) {
      const batch = [...texts.slice(start, start + MAX_BATCH_SIZE)];
      const endpoint = new URL(this.config.apiUrl).origin;
      const vectors = await resilientCall({
        key: `embedding:${endpoint}:${this.config.model}`,
        service: 'embedding',
        endpointOrigin: endpoint,
        model: this.config.model,
        policy: embeddingPolicy,
        operation: () => embedBatch(batch, this.config),
      });
      batches.push(...vectors);
    }
    return batches;
  }
}
