/**
 * 工具执行器 - 协调工具执行流程
 * 参考 Claude Code 的工具执行架构
 */

import type { ToolContext, ToolAuditEvent } from '../../../agent-runtime/tooling/tool-contracts.js';
import type { ToolRegistry } from './tool-registry.js';
import { toolRegistry } from './tool-registry.js';
import type { ToolCall } from '../../../types.js';
import { createLogger } from '../../../infrastructure/observability/logger.js';
import { evaluateToolPolicy } from './tool-policy.js';

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
  duration: number; // 执行时长（毫秒）
  retries?: number; // 实际重试次数
  approvalRequired?: {
    approvalId?: string;
    reason: string;
  };
}

// ── 工具执行器 ──

export class ToolExecutor {
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry = toolRegistry) {
    this.registry = registry;
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
    const emit = (event: ToolAuditEvent['event'], extra: Partial<ToolAuditEvent> = {}) => {
      context.audit?.({
        event,
        toolName,
        source: this.registry.get(toolName)?.getMetadata().source || 'builtin',
        riskLevel: this.registry.get(toolName)?.getMetadata().riskLevel || 'medium',
        conversationId: context.conversationId,
        duration: Date.now() - startTime,
        ...extra,
      });
    };
    const {
      timeout,
      retries = 0,
      retryDelay = 1000,
      validateInput = true,
      checkPermission = true,
    } = options;

    const tool = this.registry.get(toolName);
    if (!tool) {
      emit('failed', { error: 'Tool not found' });
      return {
        success: false,
        error: `Tool not found: ${toolName}`,
        duration: Date.now() - startTime,
      };
    }

    const effectiveTimeout = timeout ?? tool.executionTimeoutMs ?? 30000;

    if (!tool.isEnabled()) {
      emit('failed', { error: 'Tool is disabled' });
      return {
        success: false,
        error: `Tool is disabled: ${toolName}`,
        duration: Date.now() - startTime,
      };
    }

    // 验证输入
    if (validateInput) {
      const validation = tool.validate(input);
      if (!validation.valid) {
        emit('failed', { error: 'Validation failed' });
        return {
          success: false,
          error: `Validation failed: ${validation.error}`,
          duration: Date.now() - startTime,
        };
      }
    }

    // 检查权限
    if (checkPermission) {
      const permission = tool.checkPermission(input, context);
      if (!permission.allowed) {
        emit('policy_denied', { reason: permission.reason || 'insufficient permissions' });
        return {
          success: false,
          error: `Permission denied: ${permission.reason || 'insufficient permissions'}`,
          duration: Date.now() - startTime,
        };
      }
    }

    const policy = evaluateToolPolicy({
      toolName,
      metadata: tool.getMetadata(),
      input,
      context,
    });
    if (policy.action !== 'allow' && (policy.action === 'deny' || !context.approvalGranted)) {
      const approvalId =
        policy.action === 'approval_required'
          ? context.requestApproval?.({ reason: policy.reason })
          : undefined;
      emit(policy.action === 'deny' ? 'policy_denied' : 'approval_required', {
        reason: policy.reason,
        approvalId,
      });
      log.info('tool_policy_denied', {
        tool: toolName,
        action: policy.action,
        reason: policy.reason,
        conversationId: context.conversationId,
      });
      return {
        success: false,
        error:
          policy.action === 'approval_required'
            ? `Approval required: ${policy.reason}`
            : `Policy denied: ${policy.reason}`,
        duration: Date.now() - startTime,
        ...(policy.action === 'approval_required'
          ? { approvalRequired: { approvalId, reason: policy.reason } }
          : {}),
      };
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    context.signal?.addEventListener('abort', onAbort, { once: true });
    if (context.signal?.aborted) controller.abort();
    const executionContext: ToolContext = { ...context, signal: controller.signal };
    emit('started');

    // 执行（支持重试）
    let lastError: Error | undefined;
    let actualRetries = 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this.executeWithTimeout(
          () => tool.execute(input, executionContext),
          effectiveTimeout,
          controller,
        );

        context.signal?.removeEventListener('abort', onAbort);
        emit('completed');
        log.info('tool_execution_completed', {
          tool: toolName,
          source: tool.getMetadata().source,
          riskLevel: tool.getMetadata().riskLevel,
          conversationId: context.conversationId,
          duration: Date.now() - startTime,
        });

        return {
          success: true,
          data: result as T,
          duration: Date.now() - startTime,
          retries: actualRetries,
        };
      } catch (err) {
        lastError = err as Error;
        actualRetries = attempt;
        const event = lastError.message.includes('timed out')
          ? 'timed_out'
          : controller.signal.aborted
            ? 'cancelled'
            : 'failed';
        emit(event, { error: redactAuditText(lastError.message) });

        if (attempt < retries) {
          log.debug(`Tool execution failed, retrying (${attempt + 1}/${retries})`, {
            tool: toolName,
            error: lastError.message,
          });
          await this.sleep(retryDelay * Math.pow(2, attempt), controller.signal); // 指数退避
        }
      }
    }

    context.signal?.removeEventListener('abort', onAbort);
    log.info('tool_execution_failed', {
      tool: toolName,
      source: tool.getMetadata().source,
      conversationId: context.conversationId,
      duration: Date.now() - startTime,
      error: lastError?.message ? redactAuditText(lastError.message) : undefined,
    });

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      duration: Date.now() - startTime,
      retries: actualRetries,
    };
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

    // 解析输入
    let input: unknown;
    try {
      input = JSON.parse(argsStr);
    } catch (err) {
      return {
        success: false,
        error: `Invalid JSON arguments: ${(err as Error).message}`,
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
   * 带超时的执行
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    controller: AbortController,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Tool execution timed out after ${timeout}ms`));
      }, timeout);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
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
