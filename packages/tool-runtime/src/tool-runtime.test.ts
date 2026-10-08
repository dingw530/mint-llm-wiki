import { describe, expect, it, vi } from 'vitest';
import type { ToolRuntimeHooks } from './contracts.js';
import { ToolRuntimeRegistry } from './tool-registry.js';
import { ToolRuntime } from './tool-runtime.js';

interface TestTool {
  name: string;
  enabled: boolean;
}

function createRuntime(overrides: Partial<ToolRuntimeHooks<TestTool, { id: string }>> = {}) {
  const registry = new ToolRuntimeRegistry<TestTool>();
  const tool = { name: 'lookup', enabled: true };
  registry.register(tool);
  const hooks: ToolRuntimeHooks<TestTool, { id: string }> = {
    isEnabled: (registered) => registered.enabled,
    validateInput: (_registered, input) =>
      typeof input === 'object' && input !== null
        ? { valid: true }
        : { valid: false, error: 'input must be an object' },
    authorize: () => ({ action: 'allow' }),
    execute: async (_registered, input, context) => ({ input, context }),
    ...overrides,
  };
  return { runtime: new ToolRuntime({ registry, hooks }), registry, tool };
}

describe('ToolRuntime', () => {
  it('registers, looks up, replaces explicitly, and lists tools', () => {
    const registry = new ToolRuntimeRegistry<TestTool>();
    registry.register({ name: 'search', enabled: true });
    expect(() => registry.register({ name: 'search', enabled: false })).toThrow(
      /already registered/,
    );
    registry.register({ name: 'search', enabled: false }, { replace: true });
    expect(registry.get('search')?.enabled).toBe(false);
    expect(registry.list()).toHaveLength(1);
  });

  it('rejects unknown, disabled, and invalid tools before invocation', async () => {
    const execute = vi.fn(async () => 'should not run');
    const { runtime, registry } = createRuntime({ execute });
    const missing = await runtime.run('missing', {}, { id: 'call-1' });
    expect(missing.status).toBe('failed');
    if (missing.status === 'failed') expect(missing.errorCode).toBe('UNKNOWN_TOOL');
    expect((await runtime.run('lookup', 'bad-input', { id: 'call-2' })).status).toBe('failed');

    registry.register({ name: 'disabled', enabled: false });
    expect((await runtime.run('disabled', {}, { id: 'call-3' })).status).toBe('failed');
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not invoke a tool when policy denies or requests approval', async () => {
    const execute = vi.fn(async () => 'executed');
    const denied = createRuntime({
      execute,
      authorize: () => ({ action: 'deny', code: 'DENIED', message: 'blocked' }),
    });
    const deniedResult = await denied.runtime.run('lookup', {}, { id: 'call-1' });
    expect(deniedResult.status).toBe('failed');

    const pending = createRuntime({
      execute,
      authorize: () => ({
        action: 'approval_required',
        reason: 'confirm write',
        approvalId: 'a-1',
      }),
    });
    const pendingResult = await pending.runtime.run('lookup', {}, { id: 'call-2' });
    expect(pendingResult.status).toBe('approval_required');
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns results and passes an abort signal to the host tool', async () => {
    const signalSeen = vi.fn();
    const { runtime } = createRuntime({
      execute: async (_tool, input, context, signal) => {
        signalSeen(signal instanceof AbortSignal);
        return { input, context };
      },
    });
    const result = await runtime.run('lookup', { query: 'x' }, { id: 'call-1' });
    expect(result.status).toBe('succeeded');
    if (result.status === 'succeeded') {
      expect(result.data).toEqual({ input: { query: 'x' }, context: { id: 'call-1' } });
    }
    expect(signalSeen).toHaveBeenCalledWith(true);
  });

  it('aborts on timeout and external cancellation', async () => {
    const observedAbort = vi.fn();
    const { runtime } = createRuntime({
      execute: async (_tool, _input, _context, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              observedAbort();
              reject(new Error('aborted'));
            },
            { once: true },
          );
        }),
    });
    const timeout = await runtime.run('lookup', {}, { id: 'call-1' }, { timeoutMs: 5 });
    expect(timeout.status).toBe('timed_out');
    expect(observedAbort).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    const pending = runtime.run('lookup', {}, { id: 'call-2' }, { signal: controller.signal });
    controller.abort();
    expect((await pending).status).toBe('cancelled');
  });

  it('normalizes execution exceptions', async () => {
    const { runtime } = createRuntime({
      execute: async () => {
        throw new Error('tool failed');
      },
    });
    const result = await runtime.run('lookup', {}, { id: 'call-1' });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.error).toBe('tool failed');
  });
});
