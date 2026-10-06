/** Transitional adapters: preserve existing provider configuration and runtime failure identities. */
export { getAiSettings, getJevSettings } from '../../application/settings/settings-service.js';
export { createWikiVectorService, pruneWikiVectorOrphans } from './wiki-vector-service.js';
export { ExternalServiceError } from '../resilience/index.js';
export type {
  OpenAICompatibleEmbeddingConfig,
  VectorHealth,
  VectorSearchHit,
} from './vector/types.js';
