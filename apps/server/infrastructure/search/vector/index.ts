export {
  createVectorService,
  type VectorService,
  type VectorServiceDependencies,
} from './vector-service.js';
export {
  EmbeddingServiceError,
  OpenAICompatibleEmbeddingProvider,
} from './providers/openai-compatible-embedding-provider.js';
export type { EmbeddingProvider, VectorStore } from './ports.js';
export type {
  OpenAICompatibleEmbeddingConfig,
  VectorBackfillProgress,
  VectorBackfillResult,
  VectorDocument,
  VectorEmbeddingState,
  VectorHealth,
  VectorIndexConfig,
  VectorSearchHit,
} from './types.js';
