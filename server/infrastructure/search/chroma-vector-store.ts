/**
 * Experimental Chroma vector-store adapter.
 *
 * This module is not part of the default local Mint runtime. It requires a
 * separately managed Chroma Server and is intended for evaluation only.
 */
import { ChromaClient, type Collection, type EmbeddingFunction } from 'chromadb';
import type { WikiSearchDocumentInput } from '../persistence/wiki-search-repository.js';
import type { VectorStore } from './vector/ports.js';
import type { OpenAICompatibleEmbeddingConfig } from './vector/types.js';
import type {
  VectorEmbeddingState,
  VectorHealth,
  VectorIndexConfig,
  VectorSearchHit,
} from './vector/types.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('chroma-vector-store');

interface ChromaMetadata extends Record<string, string | number> {
  contentHash: string;
  dimensions: number;
  documentType: string;
  heading: string;
  model: string;
  pageId: string;
  sourcePath: string;
  title: string;
  body: string;
}

class ExternalEmbeddingFunction implements EmbeddingFunction {
  public static buildFromConfig(): EmbeddingFunction {
    return new ExternalEmbeddingFunction();
  }

  public readonly name = 'mint-external-embedding-provider';

  public getConfig(): Record<string, unknown> {
    return {};
  }

  public async generate(): Promise<number[][]> {
    throw new Error(
      'Mint supplies embeddings externally; text embedding is not supported by Chroma',
    );
  }
}

const externalEmbeddingFunction: EmbeddingFunction = new ExternalEmbeddingFunction();
const collectionCache = new Map<string, Promise<Collection>>();

function createClient(config: OpenAICompatibleEmbeddingConfig): ChromaClient {
  const endpoint = new URL(config.chromaUrl || 'http://127.0.0.1:8000');
  const apiKey = config.chromaApiKey;
  return new ChromaClient({
    host: endpoint.hostname,
    port: Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)),
    ssl: endpoint.protocol === 'https:',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
}

function metadata(document: WikiSearchDocumentInput, config: VectorIndexConfig): ChromaMetadata {
  return {
    contentHash: document.contentHash,
    dimensions: config.dimensions,
    documentType: document.documentType,
    heading: document.heading,
    model: config.model,
    pageId: document.pageId || '',
    sourcePath: document.sourcePath,
    title: document.title,
    body: document.body,
  };
}

function toDocument(id: string, value: ChromaMetadata): WikiSearchDocumentInput {
  return {
    id,
    pageId: value.pageId || null,
    sourcePath: value.sourcePath,
    title: value.title,
    heading: value.heading,
    body: value.body,
    documentType: value.documentType === 'claim' ? 'claim' : 'chunk',
    contentHash: value.contentHash,
  };
}

function collectionName(): string {
  // Keep the experimental collection separate from collections created by the
  // earlier default-embedding implementation.
  return process.env.MINT_CHROMA_COLLECTION || 'mint_wiki_chroma_experimental';
}

function collectionCacheKey(config: OpenAICompatibleEmbeddingConfig, name: string): string {
  return [config.chromaUrl || 'http://127.0.0.1:8000', name, config.chromaApiKey || ''].join(
    '\u0000',
  );
}

function getOrCreateCollection(
  config: OpenAICompatibleEmbeddingConfig,
  name: string,
): Promise<Collection> {
  const key = collectionCacheKey(config, name);
  const cached = collectionCache.get(key);
  if (cached) return cached;

  const endpoint = new URL(config.chromaUrl || 'http://127.0.0.1:8000');
  log.info('chroma collection initializing', { collection: name, url: endpoint.origin });
  const collectionPromise = createClient(config)
    .getOrCreateCollection({ name, embeddingFunction: externalEmbeddingFunction })
    .then((collection) => {
      log.info('chroma collection ready', { collection: name });
      return collection;
    })
    .catch((error: unknown) => {
      collectionCache.delete(key);
      log.error('chroma collection initialization failed', {
        collection: name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
  collectionCache.set(key, collectionPromise);
  return collectionPromise;
}

/**
 * Creates the experimental Chroma-backed Wiki vector store.
 * @experimental Requires MINT_VECTOR_STORE=chroma and a reachable Chroma Server.
 * @returns A Chroma-backed implementation of the Wiki vector-store port.
 */
export function createChromaVectorStore(
  config: OpenAICompatibleEmbeddingConfig,
): VectorStore<WikiSearchDocumentInput> {
  const name = collectionName();
  const getCollection = (): Promise<Collection> => getOrCreateCollection(config, name);

  async function getState(documentId: string): Promise<VectorEmbeddingState | null> {
    const startedAt = performance.now();
    const result = await (
      await getCollection()
    ).get<ChromaMetadata>({
      ids: [documentId],
      include: ['metadatas'],
    });
    const value = result.metadatas[0];
    if (!value) {
      log.duration('chroma vector state miss', startedAt, { documentId });
      return null;
    }
    log.duration('chroma vector state read', startedAt, { documentId });
    return {
      id: 0,
      model: value.model,
      dimensions: value.dimensions,
      contentHash: value.contentHash,
    };
  }

  async function upsert(
    document: WikiSearchDocumentInput,
    vector: number[],
    config: VectorIndexConfig,
  ): Promise<void> {
    if (vector.length !== config.dimensions)
      throw new Error(`Embedding dimension mismatch: expected ${config.dimensions}`);
    const startedAt = performance.now();
    await (
      await getCollection()
    ).upsert({
      ids: [document.id],
      embeddings: [vector],
      metadatas: [metadata(document, config)],
    });
    log.duration('chroma vector upsert', startedAt, {
      documentId: document.id,
      model: config.model,
      dimensions: config.dimensions,
    });
  }

  async function search(
    queryVector: number[],
    config: VectorIndexConfig,
    limit: number,
  ): Promise<VectorSearchHit<WikiSearchDocumentInput>[]> {
    const startedAt = performance.now();
    const result = await (
      await getCollection()
    ).query<ChromaMetadata>({
      queryEmbeddings: [queryVector],
      nResults: Math.max(1, Math.min(limit, 100)),
      where: { $and: [{ model: config.model }, { dimensions: config.dimensions }] },
      include: ['metadatas', 'distances'],
    });
    const ids = result.ids[0] || [];
    const values = result.metadatas[0] || [];
    const distances = result.distances[0] || [];
    const hits = ids.flatMap((id, index) => {
      const value = values[index];
      const distance = distances[index];
      if (!value || distance === null || distance === undefined) return [];
      return [{ document: toDocument(id, value), distance }];
    });
    log.duration('chroma vector query', startedAt, {
      requested: limit,
      returned: hits.length,
      model: config.model,
      dimensions: config.dimensions,
    });
    return hits;
  }

  async function getHealth(config: VectorIndexConfig): Promise<VectorHealth> {
    const startedAt = performance.now();
    const result = await (
      await getCollection()
    ).get<ChromaMetadata>({
      include: ['metadatas'],
    });
    const current = result.metadatas.flatMap((value) => {
      if (!value || value.model !== config.model || value.dimensions !== config.dimensions) {
        return [];
      }
      return [value];
    });
    const health = {
      documentCount: current.length,
      vectorizedCount: current.length,
      pendingCount: 0,
      failedCount: 0,
      orphanCount: 0,
      coverage: current.length === 0 ? 1 : 1,
      model: config.model,
      dimensions: config.dimensions,
      lastIndexedAt: null,
    };
    log.duration('chroma vector health read', startedAt, {
      vectorizedCount: health.vectorizedCount,
      model: config.model,
      dimensions: config.dimensions,
    });
    return health;
  }

  return {
    getState,
    upsert,
    remove: async (documentId) => {
      const startedAt = performance.now();
      await (await getCollection()).delete({ ids: [documentId] });
      log.duration('chroma vector delete', startedAt, { documentId });
    },
    search,
    recordFailure: async () => undefined,
    getHealth,
    pruneOrphans: async () => 0,
  };
}
