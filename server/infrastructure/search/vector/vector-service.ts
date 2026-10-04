import type { EmbeddingProvider, VectorStore } from './ports.js';
import type {
  VectorBackfillProgress,
  VectorBackfillResult,
  VectorDocument,
  VectorEmbeddingState,
  VectorHealth,
  VectorIndexConfig,
  VectorSearchHit,
} from './types.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('vector-service');

export interface VectorService<TDocument extends VectorDocument> {
  syncDocuments(documents: TDocument[]): Promise<void>;
  removeDocuments(documentIds: string[]): Promise<void>;
  search(question: string, limit: number): Promise<VectorSearchHit<TDocument>[]>;
  backfill(
    documents: TDocument[],
    onProgress?: VectorBackfillProgress,
  ): Promise<VectorBackfillResult>;
  getHealth(): Promise<VectorHealth>;
  pruneOrphans(): Promise<number>;
}

export interface VectorServiceDependencies<TDocument extends VectorDocument> {
  provider: EmbeddingProvider;
  store: VectorStore<TDocument>;
  config: VectorIndexConfig;
  getDocumentText: (document: TDocument) => string;
}

function isCurrent(
  state: VectorEmbeddingState | null,
  document: VectorDocument,
  config: VectorIndexConfig,
): boolean {
  return Boolean(
    state &&
    state.model === config.model &&
    state.dimensions === config.dimensions &&
    state.contentHash === document.contentHash,
  );
}

/** Creates the provider/store facade used by business services. */
export function createVectorService<TDocument extends VectorDocument>(
  dependencies: VectorServiceDependencies<TDocument>,
): VectorService<TDocument> {
  const { provider, store, config, getDocumentText } = dependencies;

  async function syncDocuments(documents: TDocument[]): Promise<void> {
    const states = await Promise.all(documents.map((document) => store.getState(document.id)));
    const pending = documents.filter(
      (document, index) => !isCurrent(states[index], document, config),
    );
    log.debug('vector state check completed', {
      requested: documents.length,
      pending: pending.length,
      model: config.model,
      dimensions: config.dimensions,
    });
    if (pending.length === 0) return;
    try {
      const embeddingStartedAt = performance.now();
      log.info('vector embedding started', {
        documents: pending.length,
        model: config.model,
        dimensions: config.dimensions,
      });
      const vectors = await provider.embed(pending.map(getDocumentText));
      log.duration('vector embedding completed', embeddingStartedAt, {
        documents: pending.length,
        vectors: vectors.length,
        vectorDimensions: vectors[0]?.length || 0,
        model: config.model,
      });
      const upsertStartedAt = performance.now();
      log.info('vector store upsert started', { documents: pending.length });
      await Promise.all(
        pending.map((document, index) => store.upsert(document, vectors[index], config)),
      );
      log.duration('vector store upsert completed', upsertStartedAt, {
        documents: pending.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('vector indexing failed', {
        documents: pending.length,
        model: config.model,
        error: message,
      });
      await Promise.all(pending.map((document) => store.recordFailure(document, message)));
      throw error;
    }
  }

  async function search(question: string, limit: number): Promise<VectorSearchHit<TDocument>[]> {
    const startedAt = performance.now();
    log.info('vector query embedding started', {
      model: config.model,
      dimensions: config.dimensions,
    });
    const [queryVector] = await provider.embed([question]);
    const results = await store.search(queryVector, config, limit);
    log.duration('vector query completed', startedAt, {
      requested: limit,
      returned: results.length,
      model: config.model,
    });
    return results;
  }

  async function removeDocuments(documentIds: string[]): Promise<void> {
    await Promise.all(documentIds.map((documentId) => store.remove(documentId)));
  }

  async function backfill(
    documents: TDocument[],
    onProgress?: VectorBackfillProgress,
  ): Promise<VectorBackfillResult> {
    const counters = { indexed: 0, skipped: 0, failed: 0 };
    for (const document of documents) {
      if (isCurrent(await store.getState(document.id), document, config)) {
        counters.skipped += 1;
        onProgress?.(
          counters.indexed + counters.skipped + counters.failed,
          counters.indexed,
          counters.skipped,
          counters.failed,
          document.sourcePath,
        );
        continue;
      }
      try {
        await syncDocuments([document]);
        counters.indexed += 1;
      } catch {
        counters.failed += 1;
      }
      onProgress?.(
        counters.indexed + counters.skipped + counters.failed,
        counters.indexed,
        counters.skipped,
        counters.failed,
        document.sourcePath,
      );
    }
    return { ...counters };
  }

  return {
    syncDocuments,
    removeDocuments,
    search,
    backfill,
    getHealth: () => store.getHealth(config),
    pruneOrphans: () => store.pruneOrphans(),
  };
}
