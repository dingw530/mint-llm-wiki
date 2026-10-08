export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  onRetry?: (attempt: number, error: Error) => void;
  signal?: AbortSignal;
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { maxRetries, baseDelay, maxDelay, onRetry, signal } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new Error('Retry aborted');
    }

    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, lastError);

        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

        // Wait with signal support
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          if (signal) {
            const onAbort = () => {
              clearTimeout(timer);
              reject(new Error('Retry aborted'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
          }
        });
      }
    }
  }

  throw lastError ?? new Error('Retry failed');
}
