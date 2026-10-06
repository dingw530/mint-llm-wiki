import { createAnthropic } from '@ai-sdk/anthropic';
import type { ApiAdapter } from './api-adapter.js';
import { registerAdapter } from './api-adapter.js';
import { createAiSdkAdapter } from './ai-sdk-adapter.js';

/** Anthropic Messages API adapter backed by the Vercel AI SDK provider. */
export const anthropicAdapter: ApiAdapter = createAiSdkAdapter(
  (apiUrl, apiKey, settings) => {
    const provider = createAnthropic({
      baseURL: appendV1(apiUrl),
      apiKey,
    });
    return provider.messages(settings.modelId);
  },
  (settings) =>
    settings.thinkingMode
      ? { anthropic: { thinking: { type: 'enabled', budgetTokens: 4096 } } }
      : undefined,
);

registerAdapter('anthropic', anthropicAdapter);

function appendV1(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : `${base}/v1`;
}
