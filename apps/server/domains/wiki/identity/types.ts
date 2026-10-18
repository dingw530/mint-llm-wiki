import type { AiSettings } from '../../../types.js';
import type { JevSettings } from '../../../types.js';

export interface WikiIdentityCandidate {
  filename: string;
  title: string;
  category: string;
  aliases: string[];
  tags: string[];
  summary?: string;
}

export interface WikiIdentityInput {
  title: string;
  category: string;
  aliases: string[];
  tags: string[];
  summary: string;
  content: string;
}

export type WikiIdentityProvider = 'deterministic' | 'jev' | 'llm';

export type WikiIdentityDecision =
  | {
      kind: 'match';
      targetPath: string;
      provider: WikiIdentityProvider;
      fallbackReason?: string;
    }
  | { kind: 'different'; provider: WikiIdentityProvider; fallbackReason?: string }
  | {
      kind: 'uncertain';
      provider: WikiIdentityProvider;
      reason: string;
      fallbackReason?: string;
    };

export type WikiIdentityProviderResult =
  WikiIdentityDecision | { kind: 'unavailable'; reason: string };

export interface WikiIdentityResolverOptions {
  jevEnabled: boolean;
  jevSettings?: JevSettings;
  aiSettings: AiSettings;
}

export type WikiIdentityProviderCall = (
  input: WikiIdentityInput,
  candidates: readonly WikiIdentityCandidate[],
  settings: WikiIdentityResolverOptions,
) => Promise<WikiIdentityProviderResult>;
