// ── Tool 调用循环引擎 ──
// 将"一轮工具调用往返"（构建请求 → fetch → 解析 SSE → 返回结构化结果）抽象为统一引擎
// 不依赖 Express，可单元测试

import type { HistoryMessage, AiSettings, TokenUsage, ToolCall, ToolDefinition } from '../types.js';
import type { AdapterStream, ApiAdapter, ParsedChunk } from './adapters/apiAdapter.js';
import { getAdapter } from './adapters/apiAdapter.js';
import { executeTool, getToolResultSummary } from './toolOrchestration.js';
import { createLogger } from '../utils/logger.js';
import type { Sink } from './sink.js';
import { retry } from './utils/retryWrapper.js';
import type { ReactEventPayload } from './reactEvents.js';
import { serializeToolResultForContext } from './utils/toolResultArtifact.js';
import type { ApprovalResumeContext } from './tools/approvalStore.js';
import { getErrorMessage } from '../utils/typeGuards.js';
import type { RuntimeContext } from './runtime/runtimeContext.js';

// 导入 Adapter 实现
import './adapters/openaiChatAdapter.js';
import './adapters/anthropicAdapter.js';
import './adapters/openaiResponsesAdapter.js';

const log = createLogger('tool-loop');

// ── 类型定义 ──

export interface ToolRoundInput {
  messages: HistoryMessage[];
  settings: AiSettings;
  tools?: ToolDefinition[];
  adapter?: ApiAdapter; // 可选注入，不传则从 settings 自动获取
  signal?: AbortSignal;
  conversationId?: string;
  label?: string; // 日志标签
  emitEvent?: (event: ReactEventPayload) => void;
  runtimeContext?: RuntimeContext;
}

export interface ToolRoundResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[] | null; // null 或空数组表示无需继续
  usage?: TokenUsage;
}

// 工具执行结果（包含拼接用的 message 和成功标志）
export interface ToolExecutionResult {
  assistantMsg: HistoryMessage;
  toolMsg: HistoryMessage;
  succeeded: boolean;
  resultSummary?: string;
  approvalRequired?: { approvalId?: string; reason: string };
  rawResult?: unknown;
}

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
      approvalGranted?: boolean;
      approvalContext?: ApprovalResumeContext;
      runtimeContext?: RuntimeContext;
    } = {},
  ): Promise<ToolExecutionResult> {
    let toolResult: unknown;
    let succeeded = true;
    let approvalRequired: ToolExecutionResult['approvalRequired'];
    try {
      toolResult = await retry(() => executeTool(tc, conversationId, options), {
        maxRetries,
        baseDelay: 1000,
        maxDelay: 16000,
        onRetry: onRetry || (() => {}),
      });
      if (isApprovalResult(toolResult)) {
        succeeded = false;
        approvalRequired = toolResult.approvalRequired;
      }
    } catch (err) {
      toolResult = { error: `All retries failed: ${getErrorMessage(err)}` };
      succeeded = false;
    }

    const resultStr = await serializeToolResultForContext(toolResult, {
      summary: succeeded ? getToolResultSummary(tc, toolResult) : undefined,
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

    return {
      assistantMsg,
      toolMsg,
      succeeded,
      resultSummary: succeeded ? getToolResultSummary(tc, toolResult) : undefined,
      approvalRequired,
      rawResult: toolResult,
    };
  }
}

function isApprovalResult(
  value: unknown,
): value is { approvalRequired: { approvalId?: string; reason: string } } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'approvalRequired' in value &&
    typeof (value as { approvalRequired?: unknown }).approvalRequired === 'object' &&
    (value as { approvalRequired: { reason?: unknown } }).approvalRequired.reason !== undefined
  );
}

// 单例
export const toolLoopEngine = new ToolLoopEngine();
