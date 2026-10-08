// ── Tool 调用循环引擎 ──
// 将"一轮工具调用往返"（构建请求 → fetch → 解析 SSE → 返回结构化结果）抽象为统一引擎
// 不依赖 Express，可单元测试

import type { HistoryMessage, TokenUsage, ToolCall } from '../../types.js';
import { randomUUID } from 'node:crypto';
import type {
  AdapterStream,
  ApiAdapter,
  ParsedChunk,
} from '../../infrastructure/ai/adapters/api-adapter.js';
import { getAdapter } from '../../infrastructure/ai/adapters/api-adapter.js';
import { executeTool, executeToolDetailed, getToolResultSummary } from './tool-execution-service.js';
import { createLogger } from '../../infrastructure/observability/logger.js';
import type { Sink } from '../../agent-runtime/output-sink.js';
import type { ReactEventPayload } from '../../agent-runtime/react-events.js';
import { serializeToolResultForContext } from '../../infrastructure/tools/tool-result-artifact.js';
import type {
  ApprovalResumeContext,
  ToolExecutionResult,
  ToolRoundInput,
  ToolRoundResult,
} from '../../agent-runtime/tooling/tool-round-contracts.js';
import { getErrorMessage } from '../../utils/typeGuards.js';
import type { RuntimeContext } from '../../agent-runtime/tooling/runtime-context.js';
import { ToolRetryableError } from '../../agent-runtime/tooling/tool-errors.js';

const log = createLogger('tool-loop');

export type {
  ToolExecutionResult,
  ToolRoundInput,
  ToolRoundResult,
} from '../../agent-runtime/tooling/tool-round-contracts.js';

// ── 模型流解析（无 Express 依赖） ──
// AI SDK 已负责 Provider 协议解析，这里只累加统一 chunk 并转发 Mint 事件。

export async function parseSSEStream(
  stream: AdapterStream,
  _adapter?: ApiAdapter,
  sink?: Sink,
  options?: {
    eventType?: string;
    signal?: AbortSignal;
    emitEvent?: (event: ReactEventPayload) => void;
  },
): Promise<ToolRoundResult> {
  let fullContent = '';
  let fullReasoning = '';
  const toolCalls: (ToolCall | null)[] = [];
  let usage: TokenUsage | undefined;

  for await (const chunk of stream) {
    if (options?.signal?.aborted) break;
    if (chunk.isFinished) {
      usage = chunk.usage;
      break;
    }

    if (chunk.toolCallDelta) {
      appendToolCall(toolCalls, chunk.toolCallDelta);
    }

    if (chunk.content) {
      fullContent += chunk.content;
      writeChunk(
        { content: chunk.content, ...(options?.eventType ? { type: options.eventType } : {}) },
        sink,
        options,
      );
    }

    if (chunk.reasoning) {
      fullReasoning += chunk.reasoning;
      writeChunk(
        { reasoning: chunk.reasoning, ...(options?.eventType ? { type: options.eventType } : {}) },
        sink,
        options,
      );
    }
  }

  const hasToolCalls = toolCalls.length > 0;
  return {
    content: fullContent,
    reasoning: fullReasoning,
    toolCalls: hasToolCalls
      ? toolCalls.filter((toolCall): toolCall is ToolCall => toolCall !== null)
      : null,
    usage,
  };
}

function appendToolCall(toolCalls: (ToolCall | null)[], delta: ParsedChunk['toolCallDelta']): void {
  if (!delta) return;
  if (!toolCalls[delta.index]) {
    toolCalls[delta.index] = {
      id: '',
      type: 'function',
      function: { name: '', arguments: '' },
    };
  }
  const toolCall = toolCalls[delta.index]!;
  if (delta.id) toolCall.id = delta.id;
  if (delta.type) toolCall.type = delta.type;
  if (delta.function?.name) toolCall.function.name += delta.function.name;
  if (delta.function?.arguments) toolCall.function.arguments += delta.function.arguments;
}

function writeChunk(
  event: { content?: string; reasoning?: string; type?: string },
  sink: Sink | undefined,
  options: { eventType?: string; emitEvent?: (event: ReactEventPayload) => void } | undefined,
): void {
  if (options?.emitEvent && options.eventType === 'thought') {
    options.emitEvent({
      type: 'thought',
      ...(event.content ? { content: event.content } : {}),
      ...(event.reasoning ? { reasoning: event.reasoning } : {}),
    });
    return;
  }
  if (options?.emitEvent && options.eventType === 'answer') {
    options.emitEvent({
      type: 'answer',
      ...(event.content ? { content: event.content } : {}),
      ...(event.reasoning ? { reasoning: event.reasoning } : {}),
    });
    return;
  }
  sink?.write(JSON.stringify(event));
}

// ── Tool 循环引擎 ──

export class ToolLoopEngine {
  // 执行一轮工具调用：构建请求 → fetch → 解析 SSE → 返回结构化结果
  async executeRound(input: ToolRoundInput, sink?: Sink): Promise<ToolRoundResult> {
    const { messages, settings, tools, signal, label } = input;
    const { apiUrl, apiKey } = settings;

    if (!apiUrl || !apiKey) {
      throw Object.assign(new Error('API URL or API Key not configured'), { status: 400 });
    }

    const adapter = input.adapter || getAdapter(settings.apiType || 'openai-chat');
    if (!adapter) {
      throw new Error(`Unsupported API type: ${settings.apiType}`);
    }

    log.debug('executeRound', { label: label || 'unnamed', toolCount: tools?.length || 0 });

    const stream = await adapter.stream(messages, settings, apiUrl, apiKey, tools, { signal });

    const eventType =
      label === 'react-answer' ? 'answer' : label === 'react-thought' ? 'thought' : undefined;
    return await parseSSEStream(stream, adapter, sink, {
      eventType,
      signal,
      emitEvent: input.emitEvent,
    });
  }

  // 执行工具并返回拼接用的 message 对
  async executeToolCall(
    tc: ToolCall,
    reasoning?: string,
    conversationId = '',
  ): Promise<ToolExecutionResult> {
    let toolResult: unknown;
    try {
      toolResult = await executeTool(tc, conversationId);
      log.debug('tool executed', {
        name: tc.function.name,
        resultPreview: JSON.stringify(toolResult).substring(0, 200),
      });
    } catch (err) {
      toolResult = { error: (err as Error).message };
    }

    const resultStr = await serializeToolResultForContext(toolResult, {
      summary: getToolResultSummary(tc, toolResult),
      conversationId,
      skipArtifact: tc.function.name === 'read_artifact',
    });
    const assistantMsg: HistoryMessage = {
      role: 'assistant',
      content: '',
      tool_calls: [tc],
      reasoning: reasoning || undefined,
    };
    const toolMsg: HistoryMessage = {
      role: 'tool',
      tool_call_id: tc.id,
      content: resultStr,
    };

    return { assistantMsg, toolMsg, succeeded: true, rawResult: toolResult };
  }

  // 执行工具并支持重试（用于 reactChat 场景）
  async executeToolCallWithRetry(
    tc: ToolCall,
    reasoning: string | undefined,
    maxRetries: number,
    onRetry?: (attempt: number, error: Error) => void,
    conversationId = '',
    options: {
      runId?: string;
      signal?: AbortSignal;
      approvalGranted?: boolean;
      approvalContext?: ApprovalResumeContext;
      runtimeContext?: RuntimeContext;
    } = {},
  ): Promise<ToolExecutionResult> {
    const stableCall = tc.id ? tc : { ...tc, id: randomUUID() };
    const runId = options.runId ?? randomUUID();
    const retryLimit = Math.max(0, Math.min(maxRetries, 10));
    let retries = 0;
    let execution: Awaited<ReturnType<typeof executeToolDetailed>>;
    while (true) {
      try {
        execution = await executeToolDetailed(stableCall, conversationId, { ...options, runId });
      } catch (error) {
        execution = {
          success: false,
          error: getErrorMessage(error),
          errorCode: 'TOOL_FAILED',
          retryable: false,
          duration: 0,
        };
      }
      if (
        execution.success ||
        execution.approvalRequired ||
        !execution.retryable ||
        retries >= retryLimit ||
        options.signal?.aborted
      ) {
        break;
      }
      retries += 1;
      onRetry?.(
        retries,
        new ToolRetryableError(execution.error || 'Tool execution failed', execution.errorCode),
      );
      await waitForRetry(Math.min(1000 * 2 ** (retries - 1), 16_000), options.signal);
      if (options.signal?.aborted) break;
    }

    const succeeded = execution.success;
    const approvalRequired = execution.approvalRequired;
    const toolResult = succeeded
      ? execution.data
      : {
          error: execution.error,
          errorCode: execution.errorCode,
          retryable: execution.retryable,
          ...(execution.outcomeUnknown ? { outcomeUnknown: true } : {}),
          ...(approvalRequired ? { approvalRequired } : {}),
        };

    const resultStr = await serializeToolResultForContext(toolResult, {
      summary: succeeded ? getToolResultSummary(stableCall, toolResult) : undefined,
      conversationId,
      skipArtifact: tc.function.name === 'read_artifact',
    });
    const assistantMsg: HistoryMessage = {
      role: 'assistant',
      content: '',
      tool_calls: [stableCall],
      reasoning: reasoning || undefined,
    };
    const toolMsg: HistoryMessage = {
      role: 'tool',
      tool_call_id: stableCall.id,
      content: resultStr,
    };

    return {
      assistantMsg,
      toolMsg,
      succeeded,
      errorCode: execution.errorCode,
      retryable: execution.retryable,
      resultSummary: succeeded ? getToolResultSummary(stableCall, toolResult) : undefined,
      approvalRequired,
      rawResult: toolResult,
    };
  }
}

/** Waits between explicitly retryable tool attempts and releases abort listeners. */
function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => finish();
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// 单例
export const toolLoopEngine = new ToolLoopEngine();
