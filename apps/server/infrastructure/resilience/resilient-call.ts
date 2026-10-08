import {
  allowCall,
  getCircuit,
  markFailure,
  markSuccess,
  releaseProbe,
  snapshotCircuit,
} from './circuit-registry.js';
import { classifyExternalError, ExternalServiceError } from './error-classifier.js';
import type { ResilienceCall } from './types.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('external-resilience');

const safe = (value: string | undefined): string | undefined =>
  value ? value.replace(/[^\w:./-]/g, '') : undefined;
const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ExternalServiceError('Operation cancelled', 'cancelled', 'external'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new ExternalServiceError('Operation cancelled', 'cancelled', 'external'));
      },
      { once: true },
    );
  });

function logData<T>(
  input: ResilienceCall<T>,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return {
    service: input.service,
    endpointOrigin: safe(input.endpointOrigin),
    model: safe(input.model),
    ...data,
  };
}

function logCircuitOpen<T>(input: ResilienceCall<T>): void {
  const circuit = snapshotCircuit(input.key);
  log.warn(
    'external circuit open; call skipped',
    logData(input, { circuitState: circuit.state, failures: circuit.failures }),
  );
}

function logFailure<T>(input: ResilienceCall<T>, category: string, attempt: number): void {
  const circuit = snapshotCircuit(input.key);
  log.warn(
    'external service call failed',
    logData(input, { errorCategory: category, attempt, circuitState: circuit.state }),
  );
}

export async function resilientCall<T>(input: ResilienceCall<T>): Promise<T> {
  const { key, policy, signal } = input;
  const state = getCircuit(key);
  if (!allowCall(key, policy.cooldownMs)) {
    logCircuitOpen(input);
    throw new ExternalServiceError(
      'External circuit is open',
      'network_transient',
      input.service,
      state.state,
    );
  }
  if (snapshotCircuit(key).state === 'half-open') {
    log.info(
      'external circuit half-open probe started',
      logData(input, { circuitState: 'half-open' }),
    );
  }
  let attempt = 0;
  try {
    while (attempt < policy.maxAttempts) {
      attempt += 1;
      try {
        const result = await input.operation();
        const previous = snapshotCircuit(key);
        markSuccess(key);
        if (previous.state !== 'closed' || previous.failures > 0) {
          log.info('external circuit recovered', logData(input, { circuitState: 'closed' }));
        }
        return result;
      } catch (error) {
        const category = classifyExternalError(error);
        if (category === 'cancelled' || !policy.circuitEligible(category)) {
          logFailure(input, category, attempt);
          throw error instanceof ExternalServiceError
            ? error
            : new ExternalServiceError('External service request failed', category, input.service);
        }
        if (attempt >= policy.maxAttempts || !policy.retryable(category)) {
          const previous = snapshotCircuit(key);
          markFailure(key, policy.failureThreshold);
          const circuit = snapshotCircuit(key);
          logFailure(input, category, attempt);
          if (previous.state !== 'open' && circuit.state === 'open') {
            log.warn(
              'external circuit opened',
              logData(input, {
                errorCategory: category,
                failures: circuit.failures,
                circuitState: circuit.state,
                cooldownMs: policy.cooldownMs,
              }),
            );
          }
          throw error instanceof ExternalServiceError
            ? error
            : new ExternalServiceError('External service  request failed', category, input.service);
        }
        const cap = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
        const retryDelayMs = Math.round(Math.random() * cap);
        log.warn(
          'external service retry scheduled',
          logData(input, {
            errorCategory: category,
            attempt,
            nextAttempt: attempt + 1,
            retryDelayMs,
            circuitState: snapshotCircuit(key).state,
          }),
        );
        await wait(retryDelayMs, signal);
      }
    }
    throw new ExternalServiceError('External service request failed', 'protocol', input.service);
  } finally {
    releaseProbe(key);
  }
}

export { safe };
