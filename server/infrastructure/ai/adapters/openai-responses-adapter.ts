import { createOpenAI } from '@ai-sdk/openai';
import type { ApiAdapter } from './api-adapter.js';
import { registerAdapter } from './api-adapter.js';
import { createAiSdkAdapter } from './ai-sdk-adapter.js';

/** OpenAI Responses API adapter backed by the Vercel AI SDK provider. */
export const openaiResponsesAdapter: ApiAdapter = createAiSdkAdapter(
  (apiUrl, apiKey, settings) => {
    const provider = createOpenAI({
      baseURL: appendV1(apiUrl),
      apiKey,
    });
    return provider.responses(settings.modelId);
  },
  (settings) =>
    settings.thinkingMode
      ? { openai: { reasoningEffort: 'medium', reasoningSummary: 'auto' } }
      : undefined,
);

registerAdapter('openai-responses', openaiResponsesAdapter);

function appendV1(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/v1`;
}
