import type {
  VectorDocument,
  VectorEmbeddingState,
  VectorHealth,
  VectorIndexConfig,
  VectorSearchHit,
} from './types.js';

/** Converts text batches into vectors without exposing a provider protocol. */
export interface EmbeddingProvider {
  embed(texts: readonly string[]): Promise<number[][]>;
}

/** Persistence and nearest-neighbor operations required by VectorService. */
export interface VectorStore<TDocument extends VectorDocument> {
  getState(documentId: string): Promise<VectorEmbeddingState | null>;
  upsert(document: TDocument, vector: number[], config: VectorIndexConfig): Promise<void>;
  remove(documentId: string): Promise<void>;
  search(
    queryVector: number[],
    config: VectorIndexConfig,
    limit: number,
  ): Promise<VectorSearchHit<TDocument>[]>;
  recordFailure(document: Pick<TDocument, 'id' | 'sourcePath'>, error: string): Promise<void>;
  getHealth(config: VectorIndexConfig): Promise<VectorHealth>;
  pruneOrphans(): Promise<number>;
}
