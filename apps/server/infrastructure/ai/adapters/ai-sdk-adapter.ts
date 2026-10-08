import {
  generateText,
  jsonSchema,
  streamText,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type TextStreamPart,
} from 'ai';
import type { HistoryMessage, TokenUsage, ToolCall, ToolDefinition } from '../../../types.js';
import type {
  AdapterStream,
  ApiAdapter,
  CallOptions,
  ModelGenerationSettings,
  ParsedChunk,
} from './api-adapter.js';
import { AI_REQUEST_TIMEOUT_MS } from './api-adapter.js';
import { isLangfuseEnabled, shouldCaptureLangfuseContent } from '../../observability/langfuse.js';

type ModelFactory = (
  apiUrl: string,
  apiKey: string,
  settings: ModelGenerationSettings,
) => LanguageModel;

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue | undefined };
type ProviderOptions = Record<string, JsonObject>;

type ProviderOptionsFactory = (
  settings: ModelGenerationSettings,
  options?: CallOptions,
) => ProviderOptions | undefined;

/**
 * Creates the common ApiAdapter behavior around Vercel AI SDK models.
 *
 * The SDK owns provider protocol parsing. Mint still receives ParsedChunk so
 * the existing ReAct and approval layers remain the only tool executors.
 */
export function createAiSdkAdapter(
  createModel: ModelFactory,
  createProviderOptions?: ProviderOptionsFactory,
): ApiAdapter {
  return {
    createModel,
    toModelMessages,
    toModelTools,

    async stream(messages, settings, apiUrl, apiKey, tools, options): Promise<AdapterStream> {
      const result = streamText({
        model: createModel(apiUrl, apiKey, settings),
        messages: toModelMessages(messages, settings.systemPrompt || ''),
        tools: toModelTools(tools),
        toolChoice: tools && tools.length > 0 ? 'auto' : undefined,
        abortSignal: options?.signal ?? AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
        providerOptions: createProviderOptions?.(settings),
        experimental_telemetry: {
          isEnabled: isLangfuseEnabled(),
          functionId: 'mint-llm-call',
          recordInputs: shouldCaptureLangfuseContent(),
          recordOutputs: shouldCaptureLangfuseContent(),
          metadata: { modelId: settings.modelId },
        },
      });

      return mapAiSdkStream(result.fullStream);
    },

    async call(messages, settings, apiUrl, apiKey, options): Promise<string> {
      const result = await generateText({
        model: createModel(apiUrl, apiKey, settings),
        messages: toModelMessages(messages, settings.systemPrompt || ''),
        maxOutputTokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature,
        abortSignal: options?.signal ?? AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
        providerOptions: createProviderOptions?.(settings, options),
        experimental_telemetry: {
          isEnabled: isLangfuseEnabled(),
          functionId: 'mint-generate-text',
          recordInputs: shouldCaptureLangfuseContent(),
          recordOutputs: shouldCaptureLangfuseContent(),
          metadata: { modelId: settings.modelId },
        },
      });

      return result.text;
    },
  };
}

/** Converts Mint's OpenAI-shaped history into AI SDK model messages. */
export function toModelMessages(messages: HistoryMessage[], systemPrompt: string): ModelMessage[] {
  const modelMessages: ModelMessage[] = [];
  const toolNames = new Map<string, string>();
  const hasSystemMessage = messages.some((message) => message.role === 'system');

  if (systemPrompt && !hasSystemMessage) {
    modelMessages.push({ role: 'system', content: systemPrompt });
  }

  for (const message of messages) {
    if (message.role === 'system') {
      modelMessages.push({ role: 'system', content: message.content });
      continue;
    }

    if (message.role === 'assistant') {
      modelMessages.push(toAssistantMessage(message, toolNames));
      continue;
    }

    if (message.role === 'tool') {
      const toolCallId = message.tool_call_id || 'unknown-tool-call';
      modelMessages.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId,
            toolName: toolNames.get(toolCallId) || 'unknown-tool',
            output: { type: 'text', value: message.content },
          },
        ],
      });
      continue;
    }

    modelMessages.push({ role: 'user', content: message.content });
  }

  return modelMessages;
}

/** Converts one assistant message while preserving reasoning and tool calls. */
function toAssistantMessage(message: HistoryMessage, toolNames: Map<string, string>): ModelMessage {
  if (!message.tool_calls || message.tool_calls.length === 0) {
    if (!message.reasoning) {
      return { role: 'assistant', content: message.content };
    }

    const content: Array<{ type: 'reasoning'; text: string } | { type: 'text'; text: string }> = [
      { type: 'reasoning', text: message.reasoning },
    ];
    if (message.content) content.push({ type: 'text', text: message.content });
    return {
      role: 'assistant',
      content,
    };
  }

  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  > = [];

  if (message.reasoning) content.push({ type: 'reasoning', text: message.reasoning });
  if (message.content) content.push({ type: 'text', text: message.content });

  for (const toolCall of message.tool_calls) {
    toolNames.set(toolCall.id, toolCall.function.name);
    content.push({
      type: 'tool-call',
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      input: parseToolArguments(toolCall),
    });
  }

  return { role: 'assistant', content };
}

/** Converts OpenAI-shaped tool definitions without registering an executor. */
export function toModelTools(tools?: ToolDefinition[]): ToolSet | undefined {
  if (!tools || tools.length === 0) return undefined;

  return Object.fromEntries(
    tools.map(({ function: definition }) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: jsonSchema(definition.parameters),
      }),
    ]),
  );
}

/** Adapts AI SDK fullStream parts to the project's existing stream contract. */
async function* mapAiSdkStream(
  stream: AsyncIterable<TextStreamPart<ToolSet>>,
): AsyncGenerator<ParsedChunk> {
  let toolIndex = 0;

  for await (const part of stream) {
    switch (part.type) {
      case 'text-delta':
        if (part.text) yield { content: part.text };
        break;
      case 'reasoning-delta':
        if (part.text) yield { reasoning: part.text };
        break;
      case 'tool-call':
        yield {
          toolCallDelta: {
            index: toolIndex++,
            id: part.toolCallId,
            type: 'function',
            function: {
              name: part.toolName,
              arguments: JSON.stringify(part.input),
            },
          },
        };
        break;
      case 'finish':
        yield {
          isFinished: true,
          ...(normalizeUsage(part.totalUsage) ? { usage: normalizeUsage(part.totalUsage) } : {}),
        };
        break;
      case 'error':
        throw normalizeSdkError(part.error);
      default:
        break;
    }
  }
}

/** 将 AI SDK 用量转换为应用层结构，并省略 Provider 未提供的字段。 */
function normalizeUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): TokenUsage | undefined {
  const normalized: TokenUsage = {};
  if (usage.inputTokens !== undefined) normalized.inputTokens = usage.inputTokens;
  if (usage.outputTokens !== undefined) normalized.outputTokens = usage.outputTokens;
  if (usage.totalTokens !== undefined) normalized.totalTokens = usage.totalTokens;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function parseToolArguments(toolCall: ToolCall): unknown {
  try {
    return JSON.parse(toolCall.function.arguments || '{}');
  } catch {
    return {};
  }
}

function normalizeSdkError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : JSON.stringify(error));
}
