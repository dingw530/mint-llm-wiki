import { resolveWikiIdentityWithLlm } from './llm-provider.js';
import type {
  WikiIdentityCandidate,
  WikiIdentityDecision,
  WikiIdentityInput,
  WikiIdentityProviderCall,
  WikiIdentityResolverOptions,
} from './types.js';

/** Attach the provider-selection reason to the final typed decision. */
function withFallbackReason(
  decision: WikiIdentityDecision,
  fallbackReason: string,
): WikiIdentityDecision {
  return { ...decision, fallbackReason };
}

/** Prefer Jev when enabled; use the LLM only when Jev is disabled or unavailable. */
export async function resolveWikiPageIdentity(
  input: WikiIdentityInput,
  candidates: readonly WikiIdentityCandidate[],
  settings: WikiIdentityResolverOptions,
  providers: {
    jev?: WikiIdentityProviderCall;
    llm?: WikiIdentityProviderCall;
  } = {},
): Promise<WikiIdentityDecision> {
  if (candidates.length === 0) {
    return { kind: 'different', provider: 'deterministic' };
  }

  const llmProvider = providers.llm || resolveWikiIdentityWithLlm;
  if (!settings.jevEnabled) {
    const llmDecision = await llmProvider(input, candidates, settings);
    return llmDecision.kind === 'unavailable'
      ? {
          kind: 'uncertain',
          provider: 'llm',
          reason: llmDecision.reason,
          fallbackReason: 'jev_disabled',
        }
      : withFallbackReason(llmDecision, 'jev_disabled');
  }

  const jevDecision = providers.jev
    ? await providers.jev(input, candidates, settings)
    : { kind: 'unavailable' as const, reason: 'jev_provider_unavailable' };
  if (jevDecision.kind !== 'unavailable') return jevDecision;

  const llmDecision = await llmProvider(input, candidates, settings);
  return llmDecision.kind === 'unavailable'
    ? {
        kind: 'uncertain',
        provider: 'llm',
        reason: llmDecision.reason,
        fallbackReason: jevDecision.reason,
      }
    : withFallbackReason(llmDecision, jevDecision.reason);
}
