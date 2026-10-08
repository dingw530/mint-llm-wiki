import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCircuits } from '../circuit-registry.js';
import { ExternalServiceError } from '../error-classifier.js';
import { embeddingPolicy } from '../policies.js';
import { resilientCall } from '../resilient-call.js';

function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  return { lines, restore: () => write.mockRestore() };
}

describe('resilientCall logging', () => {
  afterEach(() => {
    clearCircuits();
    vi.restoreAllMocks();
  });

  it('logs retry metadata without the operation input', async () => {
    const logs = captureLogs();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ExternalServiceError('retry', 'network_transient', 'embedding'))
      .mockResolvedValueOnce('vector');
    const policy = { ...embeddingPolicy, baseDelayMs: 0, maxDelayMs: 0 };

    await expect(
      resilientCall({
        key: 'embedding:http://example.test:secret-model',
        service: 'embedding',
        endpointOrigin: 'http://example.test',
        model: 'safe-model',
        policy,
        operation,
      }),
    ).resolves.toBe('vector');

    const entries = logs.lines.map(
      (line) => JSON.parse(line) as { message: string; data: unknown },
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        message: 'external service retry scheduled',
        data: expect.objectContaining({
          service: 'embedding',
          attempt: 1,
          nextAttempt: 2,
          circuitState: 'closed',
        }),
      }),
    );
    expect(logs.lines.join('')).not.toContain('secret-model');
  });

  it('logs circuit opening and skips subsequent calls', async () => {
    const logs = captureLogs();
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const failure = () =>
      Promise.reject(new ExternalServiceError('down', 'connection_refused', 'vector-store'));
    const policy = { ...embeddingPolicy, maxAttempts: 1 };
    const input = {
      key: 'vector-store:http://chroma.test',
      service: 'vector-store' as const,
      endpointOrigin: 'http://chroma.test',
      policy,
      operation: failure,
    };

    await expect(resilientCall(input)).rejects.toThrow('down');
    await expect(resilientCall(input)).rejects.toThrow('down');
    await expect(resilientCall(input)).rejects.toThrow('down');
    await expect(resilientCall(input)).rejects.toThrow('External circuit is open');
    now.mockReturnValue(policy.cooldownMs);
    await expect(
      resilientCall({ ...input, operation: () => Promise.resolve('recovered') }),
    ).resolves.toBe('recovered');

    const messages = logs.lines.map((line) => (JSON.parse(line) as { message: string }).message);
    expect(messages).toContain('external circuit opened');
    expect(messages).toContain('external circuit open; call skipped');
    expect(messages).toContain('external circuit half-open probe started');
    expect(messages).toContain('external circuit recovered');
  });
});
