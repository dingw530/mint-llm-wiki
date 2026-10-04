import { createChromaVectorStore } from './chroma-vector-store.js';
import { pruneOrphans, sqliteVectorStore } from '../persistence/vector-repository.js';
import type { WikiSearchDocumentInput } from '../persistence/wiki-search-repository.js';
import { OpenAICompatibleEmbeddingProvider } from './vector/providers/openai-compatible-embedding-provider.js';
import { createVectorService, type VectorService } from './vector/vector-service.js';
import type { VectorStore } from './vector/ports.js';
import type { OpenAICompatibleEmbeddingConfig } from './vector/types.js';
import {
  chromaReadPolicy,
  chromaWritePolicy,
  resilientCall,
} from '../../services/resilience/index.js';

function protectChromaStore(
  store: VectorStore<WikiSearchDocumentInput>,
  config: OpenAICompatibleEmbeddingConfig,
): VectorStore<WikiSearchDocumentInput> {
  const key = `vector-store:${new URL(config.chromaUrl || 'http://127.0.0.1:8000').origin}`;
  const read = <T>(operation: () => Promise<T>): Promise<T> =>
    resilientCall({ key, service: 'vector-store', policy: chromaReadPolicy, operation });
  const write = <T>(operation: () => Promise<T>): Promise<T> =>
    resilientCall({ key, service: 'vector-store', policy: chromaWritePolicy, operation });
  return {
    ...store,
    getState: (id) => read(() => store.getState(id)),
    search: (vector, indexConfig, limit) => read(() => store.search(vector, indexConfig, limit)),
    getHealth: (indexConfig) => read(() => store.getHealth(indexConfig)),
    upsert: (document, vector, indexConfig) =>
      write(() => store.upsert(document, vector, indexConfig)),
    remove: (id) => write(() => store.remove(id)),
  };
}

/** Creates the current local Wiki vector service from its replaceable ports. */
export function createWikiVectorService(
  config: OpenAICompatibleEmbeddingConfig,
  getDocumentText: (document: WikiSearchDocumentInput) => string,
): VectorService<WikiSearchDocumentInput> {
  // Experimental only: Chroma requires an external server and is never the default backend.
  const rawStore =
    config.vectorStore === 'chroma' ? createChromaVectorStore(config) : sqliteVectorStore;
  const store = config.vectorStore === 'chroma' ? protectChromaStore(rawStore, config) : rawStore;
  return createVectorService({
    provider: new OpenAICompatibleEmbeddingProvider(config),
    store,
    config,
    getDocumentText,
  });
}

/** Runs local vector-store cleanup without requiring an embedding provider. */
export const pruneWikiVectorOrphans = pruneOrphans;
