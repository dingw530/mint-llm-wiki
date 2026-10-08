import { getAdapter } from './adapters/api-adapter.js';
import type { MemoryExtractionClient } from '../../domains/memory/index.js';

/** Routes memory extraction requests through the configured AI adapter. */
export const memoryExtractionClient: MemoryExtractionClient = {
  async complete(messages, settings, apiUrl, apiKey, options) {
    const adapter = getAdapter(settings.apiType);
    if (!adapter) return null;
    return adapter.call(messages, settings, apiUrl, apiKey, options);
  },
};
