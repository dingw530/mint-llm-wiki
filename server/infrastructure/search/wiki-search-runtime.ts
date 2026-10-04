/** Transitional adapters: preserve existing provider configuration and runtime failure identities. */
export { getAiSettings, getJevSettings } from '../../application/settings/settings-service.js';
export { createWikiVectorService, pruneWikiVectorOrphans } from '../../services/vector/index.js';
export { baseRrfScore } from '../../services/rerank/legacyRerankProvider.js';
export { rerankCandidates } from '../../services/rerank/index.js';
export { ExternalServiceError } from '../../services/resilience/index.js';
export type {
  OpenAICompatibleEmbeddingConfig,
  VectorHealth,
  VectorSearchHit,
} from '../../services/vector/types.js';
export type { RerankCandidate, RerankedCandidate } from '../../services/rerank/types.js';
