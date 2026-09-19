import { getAllToolDefinitions } from './toolOrchestration.js';
import type { HistoryMessage, AiSettings, StreamResult, TokenUsage } from '../types.js';
import type { AdapterStream, ApiAdapter } from './adapters/apiAdapter.js';
import { getAdapter } from './adapters/apiAdapter.js';
import { toolLoopEngine, parseSSEStream } from './toolRoundEngine.js';
import type { Sink } from './sink.js';
import { getErrorMessage } from '../utils/typeGuards.js';
import { type AgentRun, agentRunRegistry } from './agentRun.js';
import { createDurableAgentRun } from './agentRunFactory.js';
import { ReactEventEmitter, subscribeReactEvents } from './reactEvents.js';
import type { ReactEventPayload } from './reactEvents.js';
import { estimateMessagesTokens } from './utils/tokenEstimator.js';
import { randomUUID } from 'node:crypto';
import { withLangfuseAgentContext } from './observability/langfuse.js';

// 导入 Adapter 实现（触发 registerAdapter 自注册）
import './adapters/openaiChatAdapter.js';
import './adapters/anthropicAdapter.js';
import './adapters/openaiResponsesAdapter.js';

function getApiAdapter(settings: AiSettings): ApiAdapter {
  const adapter = getAdapter(settings.apiType || 'openai-chat');
  if (!adapter) {
    throw new Error(`Unsupported API type: ${settings.apiType}`);
  }
  return adapter;
}

// ── 兼容层：读取 SSE 流，可选择实时写入 Sink ──
export async function readStream(
  stream: AdapterStream,
  adapter: ApiAdapter,
  sink?: Sink,
  options?: {
    eventType?: string;
    signal?: AbortSignal;
    emitEvent?: (event: ReactEventPayload) => void;
  },
): Promise<StreamResult> {
  const result = await parseSSEStream(stream, adapter, sink, options);
  return result;
}

// 核心入口：发起 AI 流式对话，支持无工具/有工具两条路径
export async function streamChat(
  messages: HistoryMessage[],
  settings: AiSettings,
  sink: Sink,
  agent?: string,
  conversationId?: string,
  existingRun?: AgentRun,
): Promise<StreamResult> {
  const run = existingRun || createDurableAgentRun({ runId: randomUUID(), conversationId });
  if (!existingRun) agentRunRegistry.register(run);
  const detachSink = subscribeReactEvents(run, sink);
  const events = new ReactEventEmitter(run);
  if (!existingRun) events.emit({ type: 'run_started', state: 'running' });
  const complete = (messages: HistoryMessage[], result: StreamResult) => {
    const estimatedTokens =
      result.usage?.totalTokens === undefined
        ? estimateMessagesTokens([
            ...messages,
            { role: 'assistant', content: result.content, reasoning: result.reasoning },
          ])
        : undefined;
    events.emit({
      type: 'run_completed',
      state: 'completed',
      content: result.content,
      reasoning: result.reasoning,
      ...(estimatedTokens === undefined ? result.usage : { estimatedTokens }),
    });
    detachSink();
    if (!sink.writableEnded) sink.end();
  };
  const fail = (error: unknown) => {
    events.emit({ type: 'run_failed', state: 'failed', error: getErrorMessage(error) });
    detachSink();
    if (!sink.writableEnded) sink.end();
  };
  const { apiUrl, apiKey } = settings;

  if (!apiUrl || !apiKey) {
    fail(new Error('API URL or API Key not configured'));
    return { content: '', reasoning: '', toolCalls: null };
  }

  const adapter = getApiAdapter(settings);
  // 获取 Agent 可用的工具列表
  const tools = await getAllToolDefinitions(agent);
  const hasTools = tools.length > 0;

  // 快速路径：无工具调用，直接将 AI SSE 流透传到前端
  if (!hasTools) {
    const stream = await withLangfuseAgentContext(run, () =>
      adapter.stream(messages, settings, apiUrl, apiKey),
    );
    try {
      const result = await withLangfuseAgentContext(run, () =>
        readStream(stream, adapter, undefined, {
          eventType: 'answer',
          emitEvent: (event) => events.emit(event),
        }),
      );
      complete(messages, result);
      return result;
    } catch (err) {
      fail(err);
      return { content: '', reasoning: '', toolCalls: null };
    }
  }

  // 工具路径：先通过引擎执行首轮，判断是否触发 tool_call
  let result: StreamResult;
  try {
    result = await withLangfuseAgentContext(run, () =>
      toolLoopEngine.executeRound({
        messages,
        settings,
        tools,
        adapter,
        label: 'streamChat-tool1',
      }),
    );
  } catch (err) {
    fail(err);
    return { content: '', reasoning: '', toolCalls: null };
  }

  // 未触发工具调用 → 将缓存内容写入 sink
  if (!result.toolCalls) {
    if (result.content) {
      events.emit({ type: 'answer', content: result.content });
    }
    if (result.reasoning) {
      events.emit({ type: 'answer', reasoning: result.reasoning });
    }
    complete(messages, result);
    return { content: result.content, reasoning: result.reasoning, toolCalls: null };
  }

  // ---- 工具调用路径：执行工具后二次调用 AI ----
  const toolMessages: HistoryMessage[] = [];
  for (const tc of result.toolCalls) {
    const { assistantMsg, toolMsg } = await toolLoopEngine.executeToolCall(
      tc,
      result.reasoning,
      conversationId,
    );
    toolMessages.push(assistantMsg, toolMsg);
  }

  const secondMessages: HistoryMessage[] = [
    ...messages.map((m) => ({ role: m.role, content: m.content, reasoning: m.reasoning })),
    ...toolMessages,
  ];

  let secondResult: StreamResult;
  try {
    secondResult = await withLangfuseAgentContext(run, () =>
      toolLoopEngine.executeRound({
        messages: secondMessages,
        settings,
        adapter,
        label: 'react-answer',
        emitEvent: (event) => events.emit(event),
      }),
    );
  } catch (err) {
    fail(err);
    return { content: '', reasoning: '', toolCalls: null };
  }

  complete(secondMessages, {
    ...secondResult,
    usage: addUsage(result.usage, secondResult.usage),
  });
  return { content: secondResult.content, reasoning: secondResult.reasoning, toolCalls: null };
}

function addUsage(first?: TokenUsage, second?: TokenUsage): TokenUsage | undefined {
  if (!first && !second) return undefined;
  return {
    inputTokens: addDefined(first?.inputTokens, second?.inputTokens),
    outputTokens: addDefined(first?.outputTokens, second?.outputTokens),
    totalTokens: addDefined(first?.totalTokens, second?.totalTokens),
  };
}

function addDefined(first?: number, second?: number): number | undefined {
  if (first === undefined && second === undefined) return undefined;
  return (first || 0) + (second || 0);
}

// 非流式调用 AI 生成对话标题（保持 OpenAI Chat 格式）
export async function generateTitle(
  settings: AiSettings,
  userContent: string,
  assistantContent: string,
): Promise<string> {
  const { apiUrl, apiKey } = settings;
  if (!apiUrl || !apiKey) return '';

  try {
    const adapter = getAdapter(settings.apiType || 'openai-chat');
    if (!adapter) {
      console.error('[generateTitle] Adapter not found');
      return fallbackTitle(userContent);
    }

    const content = await adapter.call(
      [
        {
          role: 'system',
          content:
            '根据对话内容生成一个简短的标题（最多6个汉字或12个英文字符）。只返回标题本身，不要引号、标点和解释。\nGenerate a very short title (max 6 Chinese characters or 12 English characters) for this conversation. Return ONLY the title.',
        },
        { role: 'user', content: userContent },
        { role: 'assistant', content: assistantContent },
      ],
      { modelId: settings.modelId },
      apiUrl,
      apiKey,
      { maxTokens: 60, temperature: 0.5, thinking: false },
    );

    console.log('[generateTitle] raw response:', JSON.stringify(content));

    const title = content.replace(/^["'「「『""]+|["'」」』""]+$/g, '').trim();

    console.log('[generateTitle] result:', JSON.stringify(title));
    if (!title) {
      console.log('[generateTitle] empty result, using fallback');
      return fallbackTitle(userContent);
    }
    return title;
  } catch (err) {
    console.error('[generateTitle] failed:', err);
    return fallbackTitle(userContent);
  }
}

function fallbackTitle(userContent: string): string {
  const cleaned = userContent.replace(/[\n\r]+/g, ' ').trim();
  return cleaned.length > 10 ? cleaned.substring(0, 10) + '...' : cleaned;
}
