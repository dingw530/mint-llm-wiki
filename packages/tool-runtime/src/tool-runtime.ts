import type {
  ToolRuntimeExecuteOptions,
  ToolRuntimeExecutionResult,
  ToolRuntimeHooks,
  ToolRuntimePrepareOptions,
  ToolRuntimePrepareResult,
  ToolRuntimeToolReference,
} from './contracts.js';
import { ToolRuntimeRegistry } from './tool-registry.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface ToolRuntimeOptions<Tool extends ToolRuntimeToolReference, Context> {
  registry: ToolRuntimeRegistry<Tool>;
  hooks: ToolRuntimeHooks<Tool, Context>;
  defaultTimeoutMs?: number;
}

/** Coordinates a host tool registry, policy callbacks, cancellation, and one execution attempt. */
export class ToolRuntime<Tool extends ToolRuntimeToolReference, Context> {
  private readonly registry: ToolRuntimeRegistry<Tool>;
  private readonly hooks: ToolRuntimeHooks<Tool, Context>;
  private readonly defaultTimeoutMs: number;

  constructor(options: ToolRuntimeOptions<Tool, Context>) {
    this.registry = options.registry;
    this.hooks = options.hooks;
    this.defaultTimeoutMs = normalizeTimeout(options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  /** Finds, validates, and authorizes a tool before the host claims any side-effect invocation. */
  async prepare(
    name: string,
    input: unknown,
    context: Context,
    options: ToolRuntimePrepareOptions<Tool, Context> = {},
  ): Promise<ToolRuntimePrepareResult<Tool, Context>> {
    const startedAt = Date.now();
    if (options.signal?.aborted) {
      return prepareFailure('CANCELLED', 'Tool execution was cancelled before dispatch', startedAt);
    }

    const tool = this.registry.get(name);
    if (!tool) return prepareFailure('UNKNOWN_TOOL', `Tool not found: ${name}`, startedAt);
    let enabled: boolean;
    try {
      enabled = this.hooks.isEnabled(tool);
    } catch (error) {
      return prepareFailure('TOOL_STATE_FAILED', errorMessage(error), startedAt);
    }
    if (!enabled) {
      return prepareFailure('TOOL_DISABLED', `Tool is disabled: ${name}`, startedAt);
    }
    if (options.validateInput !== false) {
      let validation: { valid: boolean; error?: string };
      try {
        validation = this.hooks.validateInput(tool, input);
      } catch (error) {
        return prepareFailure('INVALID_TOOL_INPUT', errorMessage(error), startedAt);
      }
      if (!validation.valid) {
        return prepareFailure(
          'INVALID_TOOL_INPUT',
          `Validation failed: ${validation.error || 'invalid input'}`,
          startedAt,
        );
      }
    }

    let authorization;
    try {
      authorization = await (options.authorize || this.hooks.authorize)(tool, input, context);
    } catch (error) {
      return prepareFailure('POLICY_FAILED', errorMessage(error), startedAt);
    }
    if (authorization.action === 'deny') {
      return prepareFailure(authorization.code, authorization.message, startedAt);
    }
    if (authorization.action === 'approval_required') {
      return {
        status: 'approval_required',
        reason: authorization.reason,
        ...(authorization.approvalId ? { approvalId: authorization.approvalId } : {}),
        errorCode: 'APPROVAL_REQUIRED',
        durationMs: Date.now() - startedAt,
      };
    }

    return { status: 'ready', tool, input, context };
  }

  /** Executes one prepared attempt and returns timeout/cancellation as data, not an uncaught error. */
  async execute(
    prepared: Extract<ToolRuntimePrepareResult<Tool, Context>, { status: 'ready' }>,
    options: ToolRuntimeExecuteOptions<Context> = { timeoutMs: this.defaultTimeoutMs },
  ): Promise<ToolRuntimeExecutionResult> {
    const startedAt = Date.now();
    const timeoutMs = normalizeTimeout(options.timeoutMs ?? this.defaultTimeoutMs);
    const externalSignal = options.signal;
    if (externalSignal?.aborted) {
      return executionFailure(
        'cancelled',
        'Tool execution was cancelled',
        startedAt,
        new Error('Tool execution cancelled'),
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectInterruption: ((error: Error) => void) | undefined;
    const onAbort = (): void => {
      controller.abort();
      rejectInterruption?.(new Error('Tool execution cancelled'));
    };
    const interrupted = new Promise<never>((_resolve, reject) => {
      rejectInterruption = reject;
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      externalSignal?.addEventListener('abort', onAbort, { once: true });
    });

    try {
      const data = await Promise.race([
        this.hooks.execute(
          prepared.tool,
          hasOwn(options, 'input') ? options.input : prepared.input,
          hasOwn(options, 'context') ? (options.context as Context) : prepared.context,
          controller.signal,
        ),
        interrupted,
      ]);
      return { status: 'succeeded', data, durationMs: Date.now() - startedAt };
    } catch (error) {
      const status = timedOut ? 'timed_out' : externalSignal?.aborted ? 'cancelled' : 'failed';
      return {
        status,
        error: errorMessage(error),
        cause: error,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      if (timer) clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onAbort);
    }
  }

  /** Prepares and executes one tool call using the runtime's default timeout. */
  async run(
    name: string,
    input: unknown,
    context: Context,
    options: ToolRuntimePrepareOptions<Tool, Context> & { timeoutMs?: number } = {},
  ): Promise<ToolRuntimePrepareResult<Tool, Context> | ToolRuntimeExecutionResult> {
    const prepared = await this.prepare(name, input, context, options);
    if (prepared.status !== 'ready') return prepared;
    return this.execute(prepared, {
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
    });
  }
}

function prepareFailure(
  errorCode: string,
  error: string,
  startedAt: number,
): ToolRuntimePrepareResult<never, never> {
  const status = errorCode === 'CANCELLED' ? 'cancelled' : 'failed';
  return { status, errorCode, error, durationMs: Date.now() - startedAt };
}

function executionFailure(
  status: 'cancelled' | 'timed_out' | 'failed',
  error: string,
  startedAt: number,
  cause: unknown,
): ToolRuntimeExecutionResult {
  return { status, error, cause, durationMs: Date.now() - startedAt };
}

function normalizeTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('Tool timeout must be a positive integer');
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
