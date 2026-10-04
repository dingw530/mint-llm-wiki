import {
  EmbeddingServiceError,
  OpenAICompatibleEmbeddingProvider,
} from '../../infrastructure/search/vector/providers/openai-compatible-embedding-provider.js';
import type { OpenAICompatibleEmbeddingConfig } from '../../infrastructure/search/vector/types.js';

/** @deprecated Import the vector provider and its config from infrastructure/search/vector instead. */
export type EmbeddingConfig = OpenAICompatibleEmbeddingConfig;

export { EmbeddingServiceError };

/**
 * Compatibility facade for the former Embedding utility.
 * @param texts Texts to embed.
 * @param config OpenAI-compatible provider configuration.
 * @returns Vectors in the same order as the input texts.
 */
export async function embedTexts(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  return new OpenAICompatibleEmbeddingProvider(config).embed(texts);
}
