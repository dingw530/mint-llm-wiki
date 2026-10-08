import type { ExternalErrorCategory, ResiliencePolicy } from './types.js';
const retryable = (category: ExternalErrorCategory): boolean =>
  ['timeout', 'network_transient', 'rate_limited', 'server_unavailable'].includes(category);
const eligible = (category: ExternalErrorCategory): boolean =>
  !['cancelled', 'authentication', 'configuration', 'protocol'].includes(category);
export const embeddingPolicy: ResiliencePolicy = {
  maxAttempts: 2,
  baseDelayMs: 100,
  maxDelayMs: 2000,
  failureThreshold: 3,
  cooldownMs: 30_000,
  retryable,
  circuitEligible: eligible,
};
export const chromaReadPolicy = { ...embeddingPolicy };
export const chromaWritePolicy: ResiliencePolicy = {
  ...embeddingPolicy,
  maxAttempts: 1,
  retryable: () => false,
};
