/**
 * 工具执行器 - 协调工具执行流程
 * 参考 Claude Code 的工具执行架构
 */

import type {
  ToolContext,
  ToolAuditEvent,
  ToolErrorCode,
  ToolInvocationOutcome,
  ToolMetadata,
  ToolInvocationFinish,
  ToolAuditResultCode,
  ToolHandler,
} from '../../../agent-runtime/tooling/tool-contracts.js';
import { ToolRuntime } from '@mint/tool-runtime';
import type {
  ToolRuntimeAuthorization,
  ToolRuntimeExecutionResult,
  ToolRuntimePrepareResult,
} from '@mint/tool-runtime';
import { createHash } from 'node:crypto';
import type { ToolRegistry } from './tool-registry.js';
import { toolRegistry } from './tool-registry.js';
import type { ToolCall } from '../../../types.js';
import { createLogger } from '../../../infrastructure/observability/logger.js';
import { evaluateToolPolicy } from './tool-policy.js';
import { ToolRetryableError } from '../../../agent-runtime/tooling/tool-errors.js';
import { summarizeToolParameters } from '../../../infrastructure/observability/tool-audit-sink.js';

const log = createLogger('tool-executor');

function redactAuditText(value: string): string {
  return value
    .replace(
      /(authorization|cookie|api[-_]?key|token|password)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]',
    )
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');
}

// ── 执行选项 ──

export interface ExecutionOptions {
  timeout?: number; // 超时时间（毫秒）
  retries?: number; // 重试次数
  retryDelay?: number; // 重试延迟（毫秒）
  validateInput?: boolean; // 是否验证输入（默认 true）
  checkPermission?: boolean; // 是否检查权限（默认 true）
}

// ── 执行结果 ──

export interface ExecutionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: ToolErrorCode;
  retryable?: boolean;
  outcomeUnknown?: boolean;
  duration: number; // 执行时长（毫秒）
  retries?: number; // 实际重试次数
  approvalRequired?: {
    approvalId?: string;
    reason: string;
  };
}

type AuditEmitter = (event: ToolAuditEvent['event'], extra?: Partial<ToolAuditEvent>) => void;

// ── 工具执行器 ──

export class ToolExecutor {
  private registry: ToolRegistry;
  private runtime: ToolRuntime<ToolHandler<unknown, unknown>, ToolContext>;

  constructor(registry: ToolRegistry = toolRegistry) {
    this.registry = registry;
    this.runtime = new ToolRuntime({
      registry,
      hooks: {
        isEnabled: (tool) => tool.isEnabled(),
        validateInput: (tool, input) => tool.validate(input),
        authorize: (tool, input, context) => this.authorizeTool(tool, input, context, true),
        execute: (tool, input, context, signal) => tool.execute(input, { ...context, signal }),
      },
    });
  }

  /**
   * 执行工具（从输入参数）
   */
  async execute<T>(
    toolName: string,
    input: unknown,
    context: ToolContext,
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult<T>> {
    const startTime = Date.now();
    const emit = createAuditEmitter(context, toolName, input, this.registry, startTime);
    const prepared = await this.prepareExecution(
      toolName,
      input,
      context,
      options,
      emit,
      startTime,
    );
    if ('result' in prepared) return prepared.result;

    const claim = this.claimInvocation(prepared, input, context, emit, startTime);
    if ('result' in claim) return claim.result;

    const executionInput = injectInvocationIdempotencyKey(
      toolName,
      input,
      context.invocation?.invocationId,
    );
    return this.runTool<T>(
      prepared,
      executionInput,
      context,
      options,
      emit,
      startTime,
      claim.attempt - 1,
    );
  }

  private async prepareExecution(
    toolName: string,
    input: unknown,
    context: ToolContext,
    options: ExecutionOptions,
    emit: AuditEmitter,
    startTime: number,
  ): Promise<
    | {
        tool: NonNullable<ReturnType<ToolRegistry['get']>>;
        metadata: ToolMetadata;
        runtimePrepared: Extract<
          ToolRuntimePrepareResult<ToolHandler<unknown, unknown>, ToolContext>,
          { status: 'ready' }
        >;
      }
    | { result: ExecutionResult<never> }
  > {
    const runtimePrepared = await this.runtime.prepare(toolName, input, context, {
      signal: context.signal,
      validateInput: options.validateInput,
      authorize: (tool, value, toolContext) =>
        this.authorizeTool(tool, value, toolContext, options.checkPermission !== false),
    });
    if (runtimePrepared.status !== 'ready') {
      const code = toMintToolErrorCode(runtimePrepared.errorCode);
      if (runtimePrepared.status === 'approval_required') {
        emit('approval_required', {
          reason: runtimePrepared.reason,
          approvalId: runtimePrepared.approvalId,
          resultCode: 'approval_required',
          errorCode: 'APPROVAL_REQUIRED',
        });
        return {
          result: {
            ...failure(
              'APPROVAL_REQUIRED',
              `Approval required: ${runtimePrepared.reason}`,
              startTime,
            ),
            approvalRequired: {
              approvalId: runtimePrepared.approvalId,
              reason: runtimePrepared.reason,
            },
          },
        };
      }

      const isPermission = code === 'PERMISSION_DENIED' || code === 'POLICY_DENIED';
      emit(
        runtimePrepared.status === 'cancelled'
          ? 'cancelled'
          : isPermission
            ? 'policy_denied'
            : 'failed',
        {
          error:
            code === 'INVALID_TOOL_INPUT'
              ? 'Validation failed'
              : redactAuditText(runtimePrepared.error).slice(0, 200),
          ...(code ? { errorCode: code } : {}),
          resultCode: isPermission
            ? 'permission_denied'
            : runtimePrepared.status === 'cancelled'
              ? 'cancelled'
              : 'failed',
        },
      );
      return { result: failure(code || 'TOOL_FAILED', runtimePrepared.error, startTime) };
    }
    return {
      tool: runtimePrepared.tool,
      metadata: runtimePrepared.tool.getMetadata(),
      runtimePrepared,
    };
  }

  private authorizeTool(
    tool: ToolHandler<unknown, unknown>,
    input: unknown,
    context: ToolContext,
    checkPermission: boolean,
  ): ToolRuntimeAuthorization {
    if (checkPermission) {
      const permission = tool.checkPermission(input, context);
      if (!permission.allowed) {
        return {
          action: 'deny',
          code: 'PERMISSION_DENIED',
          message: `Permission denied: ${permission.reason || 'insufficient permissions'}`,
        };
      }
    }

    const policy = evaluateToolPolicy({
      toolName: tool.name,
      metadata: tool.getMetadata(),
      input,
      context,
    });
    if (policy.action === 'deny') {
      log.info('tool_policy_denied', {
        tool: tool.name,
        action: policy.action,
        reason: policy.reason,
        conversationId: context.conversationId,
      });
      return { action: 'deny', code: 'POLICY_DENIED', message: `Policy denied: ${policy.reason}` };
    }
    if (policy.action === 'approval_required' && !context.approvalGranted) {
      const approvalId = context.requestApproval?.({ reason: policy.reason });
      log.info('tool_policy_denied', {
        tool: tool.name,
        action: policy.action,
        reason: policy.reason,
        conversationId: context.conversationId,
      });
      return { action: 'approval_required', reason: policy.reason, approvalId };
    }
    return { action: 'allow' };
  }

  private claimInvocation(
    prepared: { tool: NonNullable<ReturnType<ToolRegistry['get']>>; metadata: ToolMetadata },
    input: unknown,
    context: ToolContext,
    emit: AuditEmitter,
    startTime: number,
  ): { allowed: true; attempt: number } | { result: ExecutionResult<never> } {
    if (!context.invocation) return { allowed: true, attempt: 1 };
    let claim: ReturnType<NonNullable<ToolContext['invocation']>['claim']>;
    try {
      claim = context.invocation.claim({
        toolName: prepared.tool.name,
        inputHash: hashToolInput(input),
        retrySafety: prepared.metadata.retrySafety ?? 'never',
      });
    } catch {
      emit('failed', { error: 'Invocation state unavailable' });
      return {
        result: failure(
          'INVOCATION_STATE_UNAVAILABLE',
          'Tool invocation state is unavailable; the tool was not executed',
          startTime,
        ),
      };
    }
    if (claim.allowed) return { allowed: true, attempt: claim.attempt };
    emit('failed', { error: claim.errorCode, errorCode: claim.errorCode });
    return { result: failure(claim.errorCode, claim.message, startTime) };
  }

  private async runTool<T>(
    prepared: {
      tool: NonNullable<ReturnType<ToolRegistry['get']>>;
      metadata: ToolMetadata;
      runtimePrepared: Extract<
        ToolRuntimePrepareResult<ToolHandler<unknown, unknown>, ToolContext>,
        { status: 'ready' }
      >;
    },
    input: unknown,
    context: ToolContext,
    options: ExecutionOptions,
    emit: AuditEmitter,
    startTime: number,
    priorRetries: number,
  ): Promise<ExecutionResult<T>> {
    const { tool, metadata } = prepared;
    const timeout = options.timeout ?? tool.executionTimeoutMs ?? 30000;
    const retries = Math.max(0, Math.min(options.retries ?? 0, 10));
    const retryDelay = options.retryDelay ?? 1000;
    if (context.signal?.aborted) {
      finishInvocation(context, { status: 'failed', retryable: false, errorCode: 'CANCELLED' });
      emit('cancelled', { resultCode: 'cancelled', errorCode: 'CANCELLED' });
      return failure('CANCELLED', 'Tool execution was cancelled before dispatch', startTime);
    }
    emit('started', { retryCount: priorRetries });

    let lastError: Error | undefined;
    let retryCount = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let runtimeStatus: ToolRuntimeExecutionResult['status'] | undefined;
      try {
        const outcome = await this.runtime.execute(prepared.runtimePrepared, {
          input,
          context: { ...context },
          signal: context.signal,
          timeoutMs: timeout,
        });
        if (outcome.status !== 'succeeded') {
          runtimeStatus = outcome.status;
          throw outcome.cause instanceof Error ? outcome.cause : new Error(outcome.error);
        }
        const data = outcome.data;
        if (!finishInvocation(context, { status: 'succeeded', retryable: false })) {
          return failure(
            'OUTCOME_UNKNOWN',
            'Tool completed but its invocation state could not be stored',
            startTime,
            {
              outcomeUnknown: true,
              retries: retryCount,
            },
          );
        }
        emit('completed', { resultCode: 'success', retryCount: priorRetries + retryCount });
        log.info('tool_execution_completed', {
          tool: tool.name,
          source: metadata.source,
          riskLevel: metadata.riskLevel,
          conversationId: context.conversationId,
          duration: Date.now() - startTime,
        });
        return {
          success: true,
          data: data as T,
          duration: Date.now() - startTime,
          retries: retryCount,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const retryable =
          lastError instanceof ToolRetryableError && metadata.retrySafety !== 'never';
        const errorCode =
          runtimeStatus === 'timed_out'
            ? 'TIMEOUT'
            : runtimeStatus === 'cancelled'
              ? 'CANCELLED'
              : getToolErrorCode(lastError, context.signal?.aborted ?? false);
        const event =
          errorCode === 'TIMEOUT'
            ? 'timed_out'
            : errorCode === 'CANCELLED'
              ? 'cancelled'
              : 'failed';
        emit(event, {
          error: redactAuditText(lastError.message),
          errorCode,
          retryCount: priorRetries + retryCount,
        });
        if (attempt < retries && retryable) {
          retryCount += 1;
          log.debug('tool_execution_retry_scheduled', { tool: tool.name, attempt: retryCount });
          try {
            await this.sleep(retryDelay * Math.pow(2, attempt), context.signal);
          } catch {
            finishInvocation(context, {
              status: 'failed',
              retryable: false,
              errorCode: 'CANCELLED',
            });
            emit('cancelled', {
              resultCode: 'cancelled',
              errorCode: 'CANCELLED',
              retryCount: priorRetries + retryCount,
            });
            return failure('CANCELLED', 'Tool execution was cancelled before retry', startTime, {
              retries: retryCount,
            });
          }
          continue;
        }
        const outcomeUnknown = metadata.sideEffect !== 'none' && !retryable;
        const status: ToolInvocationOutcome = outcomeUnknown ? 'outcome_unknown' : 'failed';
        if (!finishInvocation(context, { status, retryable, errorCode })) {
          return failure(
            'OUTCOME_UNKNOWN',
            'Tool failed and its invocation state is unknown',
            startTime,
            {
              outcomeUnknown: true,
              retries: retryCount,
            },
          );
        }
        if (outcomeUnknown) {
          emit('failed', {
            resultCode: 'outcome_unknown',
            errorCode: 'OUTCOME_UNKNOWN',
            retryCount: priorRetries + retryCount,
          });
        }
        log.info('tool_execution_failed', {
          tool: tool.name,
          source: metadata.source,
          conversationId: context.conversationId,
          duration: Date.now() - startTime,
          errorCode,
        });
        return failure(
          outcomeUnknown ? 'OUTCOME_UNKNOWN' : errorCode,
          outcomeUnknown
            ? errorCode === 'TIMEOUT'
              ? 'Tool timed out; side-effect outcome is unknown'
              : 'Tool may have produced a side effect; outcome is unknown'
            : lastError.message,
          startTime,
          { retryable, outcomeUnknown, retries: retryCount },
        );
      }
    }
    return failure('TOOL_FAILED', lastError?.message || 'Unknown tool failure', startTime, {
      retries: retryCount,
    });
  }

  /**
   * 从 ToolCall 执行工具
   */
  async executeFromToolCall<T>(
    toolCall: ToolCall,
    context: ToolContext,
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult<T>> {
    const { name, arguments: argsStr } = toolCall.function;
    const emit = createAuditEmitter(context, name, argsStr, this.registry, Date.now());

    // 解析输入
    let input: unknown;
    try {
      input = JSON.parse(argsStr);
    } catch {
      emit('failed', { resultCode: 'invalid_input', errorCode: 'INVALID_TOOL_INPUT' });
      return {
        success: false,
        error: 'Invalid JSON arguments',
        errorCode: 'INVALID_TOOL_INPUT',
        retryable: false,
        duration: 0,
      };
    }

    return this.execute<T>(name, input, context, options);
  }

  /**
   * 批量执行工具
   */
  async executeBatch(
    toolCalls: ToolCall[],
    context: ToolContext,
    options: ExecutionOptions = {},
  ): Promise<Map<string, ExecutionResult>> {
    const results = new Map<string, ExecutionResult>();

    // 并行执行所有工具
    const promises = toolCalls.map(async (toolCall) => {
      const result = await this.executeFromToolCall(toolCall, context, options);
      results.set(toolCall.function.name, result);
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * 延迟
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Tool execution cancelled'));
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('Tool execution cancelled'));
        },
        { once: true },
      );
    });
  }

  /**
   * 获取执行统计信息
   */
  getStats(): {
    registeredTools: number;
    enabledTools: number;
    toolCategories: string[];
  } {
    const stats = this.registry.getStats();
    return {
      registeredTools: stats.total,
      enabledTools: stats.enabled,
      toolCategories: Object.keys(stats.byCategory),
    };
  }
}

// 单例
export const toolExecutor = new ToolExecutor();

function createAuditEmitter(
  context: ToolContext,
  toolName: string,
  input: unknown,
  registry: ToolRegistry,
  startTime: number,
): AuditEmitter {
  return (event, extra = {}) => {
    try {
      const metadata = registry.get(toolName)?.getMetadata();
      context.audit?.({
        event,
        toolName,
        source: metadata?.source || 'builtin',
        riskLevel: metadata?.riskLevel || 'medium',
        conversationId: context.conversationId,
        invocationId: context.invocationId,
        runId: context.runId,
        callId: context.callId,
        duration: Date.now() - startTime,
        parameterSummary: summarizeToolParameters(input),
        resultCode: extra.resultCode ?? mapAuditResultCode(event, extra.errorCode),
        errorCode: extra.errorCode,
        retryCount: extra.retryCount,
        ...extra,
      });
    } catch {
      // Logging must not change an authorization or execution outcome.
    }
  };
}

function finishInvocation(context: ToolContext, outcome: ToolInvocationFinish): boolean {
  if (!context.invocation) return true;
  try {
    context.invocation.finish(outcome);
    return true;
  } catch {
    return false;
  }
}

function toMintToolErrorCode(code: string): ToolErrorCode {
  switch (code) {
    case 'CANCELLED':
    case 'UNKNOWN_TOOL':
    case 'TOOL_DISABLED':
    case 'INVALID_TOOL_INPUT':
    case 'PERMISSION_DENIED':
    case 'APPROVAL_REQUIRED':
    case 'POLICY_DENIED':
    case 'TIMEOUT':
    case 'TOOL_FAILED':
    case 'OUTCOME_UNKNOWN':
    case 'INVOCATION_CONFLICT':
    case 'INVOCATION_ALREADY_COMPLETED':
    case 'INVOCATION_STATE_UNAVAILABLE':
      return code;
    default:
      return 'TOOL_FAILED';
  }
}

function getToolErrorCode(error: Error, aborted: boolean): ToolErrorCode {
  if (error instanceof ToolRetryableError) return error.errorCode;
  if (error.message.includes('timed out')) return 'TIMEOUT';
  if (aborted || error.name === 'AbortError') return 'CANCELLED';
  return 'TOOL_FAILED';
}

function hashToolInput(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(input)))
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function injectInvocationIdempotencyKey(
  toolName: string,
  input: unknown,
  invocationId?: string,
): unknown {
  if (toolName !== 'wiki_ingest' || !invocationId || !isRecord(input)) return input;
  return { ...input, idempotencyKey: invocationId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure<T = never>(
  errorCode: ToolErrorCode,
  error: string,
  startTime: number,
  extra: Partial<ExecutionResult<T>> = {},
): ExecutionResult<T> {
  return {
    success: false,
    error,
    errorCode,
    retryable: false,
    duration: Date.now() - startTime,
    ...extra,
  };
}

function mapAuditResultCode(
  event: ToolAuditEvent['event'],
  errorCode?: ToolErrorCode,
): ToolAuditResultCode | undefined {
  if (event === 'completed') return 'success';
  if (event === 'approval_required') return 'approval_required';
  if (event === 'policy_denied') return 'permission_denied';
  if (event === 'timed_out' || errorCode === 'TIMEOUT') return 'timed_out';
  if (event === 'cancelled' || errorCode === 'CANCELLED') return 'cancelled';
  if (errorCode === 'OUTCOME_UNKNOWN') return 'outcome_unknown';
  if (errorCode === 'INVALID_TOOL_INPUT') return 'invalid_input';
  if (event === 'failed') return 'failed';
  return undefined;
}
