export type ExternalServiceKind = 'embedding' | 'vector-store';
export type ExternalErrorCategory =
  | 'cancelled'
  | 'timeout'
  | 'connection_refused'
  | 'network_transient'
  | 'rate_limited'
  | 'server_unavailable'
  | 'authentication'
  | 'configuration'
  | 'protocol';

export interface ResiliencePolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  failureThreshold: number;
  cooldownMs: number;
  retryable(category: ExternalErrorCategory): boolean;
  circuitEligible(category: ExternalErrorCategory): boolean;
}

export interface ResilienceCall<T> {
  key: string;
  service: ExternalServiceKind;
  endpointOrigin?: string;
  model?: string;
  policy: ResiliencePolicy;
  signal?: AbortSignal;
  operation: () => Promise<T>;
}

export interface CircuitSnapshot {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  openedAt: number | null;
  probeInFlight: boolean;
}
