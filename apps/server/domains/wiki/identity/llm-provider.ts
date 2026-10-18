import { getAdapter } from '../../../infrastructure/ai/adapters/api-adapter.js';
import type {
  WikiIdentityCandidate,
  WikiIdentityInput,
  WikiIdentityProviderResult,
  WikiIdentityResolverOptions,
} from './types.js';

interface LlmIdentityResponse {
  decision?: unknown;
  targetPath?: unknown;
}

/** Parse one JSON object without accepting prose as an identity decision. */
function parseLlmIdentityResponse(response: string): LlmIdentityResponse | null {
  const trimmed = response.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    return { decision: record.decision, targetPath: record.targetPath };
  } catch {
    return null;
  }
}

/** Validate the LLM decision and reject any path outside the retrieved candidates. */
function resolveLlmResponse(
  parsed: LlmIdentityResponse | null,
  candidates: readonly WikiIdentityCandidate[],
): WikiIdentityProviderResult {
  if (!parsed || typeof parsed.decision !== 'string') {
    return { kind: 'unavailable', reason: 'malformed_response' };
  }
  if (parsed.decision === 'different') return { kind: 'different', provider: 'llm' };
  if (parsed.decision === 'uncertain') {
    return { kind: 'uncertain', provider: 'llm', reason: 'llm_uncertain' };
  }
  if (parsed.decision !== 'match' || typeof parsed.targetPath !== 'string') {
    return { kind: 'unavailable', reason: 'malformed_response' };
  }
  const candidate = candidates.find((item) => item.filename === parsed.targetPath);
  return candidate
    ? { kind: 'match', targetPath: candidate.filename, provider: 'llm' }
    : { kind: 'unavailable', reason: 'target_outside_candidate_set' };
}

/** Use the configured LLM as a strict identity resolver for current candidates. */
export async function resolveWikiIdentityWithLlm(
  input: WikiIdentityInput,
  candidates: readonly WikiIdentityCandidate[],
  settings: WikiIdentityResolverOptions,
): Promise<WikiIdentityProviderResult> {
  const adapter = getAdapter(settings.aiSettings.apiType || 'openai-chat');
  if (!adapter) return { kind: 'unavailable', reason: 'llm_adapter_unavailable' };

  const prompt = `Decide whether the incoming Wiki page is the exact same entity or concept as one of the listed existing pages. Related topics are not the same identity. Do not merge different versions, scopes, or objects. Use only these candidates; never invent a target path.\n\nIncoming page:\n${JSON.stringify(input)}\n\nExisting candidates:\n${JSON.stringify(candidates)}\n\nReturn exactly one JSON object: {"decision":"match","targetPath":"<candidate filename>"}, {"decision":"different"}, or {"decision":"uncertain"}. Return uncertain if identity is not clearly established.`;
  try {
    const response = await adapter.call(
      [
        {
          role: 'system',
          content: 'You are a strict Wiki identity resolver. Output one valid JSON object only.',
        },
        { role: 'user', content: prompt },
      ],
      { modelId: settings.aiSettings.modelId },
      settings.aiSettings.apiUrl,
      settings.aiSettings.apiKey,
      { maxTokens: 256, temperature: 0 },
    );
    return resolveLlmResponse(parseLlmIdentityResponse(response), candidates);
  } catch {
    return { kind: 'unavailable', reason: 'llm_request_failed' };
  }
}
