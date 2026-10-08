import type { ExternalErrorCategory } from './types.js';

export class ExternalServiceError extends Error {
  constructor(
    message: string,
    public readonly category: ExternalErrorCategory,
    public readonly service: string,
    public readonly circuitState: 'closed' | 'open' | 'half-open' = 'closed',
  ) {
    super(message);
    this.name = 'ExternalServiceError';
  }
}

function codeOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const cause = 'cause' in error ? error.cause : error;
  return cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : undefined;
}

export function classifyExternalError(error: unknown): ExternalErrorCategory {
  if (error instanceof ExternalServiceError) return error.category;
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  const code = codeOf(error);
  if (code === 'ECONNREFUSED') return 'connection_refused';
  if (
    code &&
    ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(
      code,
    )
  )
    return 'network_transient';
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  if (typeof status === 'number') {
    if (status === 401 || status === 403) return 'authentication';
    if (status === 429) return 'rate_limited';
    if ([502, 503, 504].includes(status)) return 'server_unavailable';
  }
  return 'protocol';
}
