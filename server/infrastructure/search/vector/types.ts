/** Shared configuration for a vector index implementation. */
export interface VectorIndexConfig {
  model: string;
  dimensions: number;
}

/** Configuration understood by the built-in OpenAI-compatible provider. */
export interface OpenAICompatibleEmbeddingConfig extends VectorIndexConfig {
  apiUrl: string;
  vectorStore?: 'sqlite' | 'chroma';
  chromaUrl?: string;
  chromaApiKey?: string;
}

/** Minimum document identity required by a vector store. */
export interface VectorDocument {
  id: string;
  sourcePath: string;
  contentHash: string;
}

/** Metadata describing the vector currently stored for a document. */
export interface VectorEmbeddingState {
  id: number;
  model: string;
  dimensions: number;
  contentHash: string;
}

/** A document returned by nearest-neighbor search. */
export interface VectorSearchHit<TDocument extends VectorDocument> {
  document: TDocument;
  distance: number;
}

/** Health information shared by vector-store implementations. */
export interface VectorHealth {
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

/** Progress callback used by asynchronous vector backfill jobs. */
export type VectorBackfillProgress = (
  processed: number,
  indexed: number,
  skipped: number,
  failed: number,
  currentPath: string,
) => void;

/** Result counters returned after a vector backfill. */
export interface VectorBackfillResult {
  indexed: number;
  skipped: number;
  failed: number;
}
