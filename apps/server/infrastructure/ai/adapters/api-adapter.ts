import type { HistoryMessage, TokenUsage, ToolCallDelta, ToolDefinition } from '../../../types.js';
import type { LanguageModel, ModelMessage, ToolSet } from 'ai';

/** 应用层单次 LLM 请求的默认超时时间（毫秒）。 */
export const AI_REQUEST_TIMEOUT_MS = 180_000;

export interface ParsedChunk {
  content?: string;
  reasoning?: string;
  toolCallDelta?: ToolCallDelta;
  isFinished?: boolean;
  usage?: TokenUsage;
}

export type AdapterStream = AsyncIterable<ParsedChunk>;

export interface ModelGenerationSettings {
  modelId: string;
  thinkingMode?: boolean;
  systemPrompt?: string;
}

export interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  /** OpenAI-compatible reasoning models may expose a provider-specific thinking switch. */
  thinking?: boolean;
  signal?: AbortSignal;
}

export interface StreamOptions {
  signal?: AbortSignal;
}

export interface ApiAdapter {
  /**
   * 创建 AI SDK 使用的模型实例。
   *
   * 该方法只负责 Provider 和 endpoint 配置，不执行模型调用。
   */
  createModel(apiUrl: string, apiKey: string, settings: ModelGenerationSettings): LanguageModel;

  /** 将项目消息和工具定义转换为 AI SDK prompt。 */
  toModelMessages(messages: HistoryMessage[], systemPrompt: string): ModelMessage[];

  /** 将项目工具定义转换为 AI SDK 工具描述。 */
  toModelTools(tools?: ToolDefinition[]): ToolSet | undefined;

  /** 发起一次流式 AI 调用，返回项目内部的标准化流。 */
  stream(
    messages: HistoryMessage[],
    settings: ModelGenerationSettings,
    apiUrl: string,
    apiKey: string,
    tools?: ToolDefinition[],
    options?: StreamOptions,
  ): Promise<AdapterStream>;

  /** 非流式单次调用 AI，返回纯文本响应内容 */
  call(
    messages: { role: string; content: string }[],
    settings: ModelGenerationSettings,
    apiUrl: string,
    apiKey: string,
    options?: CallOptions,
  ): Promise<string>;
}

/** 注册表：apiType -> Adapter 实例 */
const registry = new Map<string, ApiAdapter>();

export function registerAdapter(apiType: string, adapter: ApiAdapter): void {
  registry.set(apiType, adapter);
}

export function getAdapter(apiType: string): ApiAdapter | undefined {
  return registry.get(apiType);
}
