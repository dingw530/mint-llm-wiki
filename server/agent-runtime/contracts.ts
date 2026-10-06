import type { AgentRun, AgentRunOptions } from './agent-run.js';
import type { ApiAdapter } from '../infrastructure/ai/adapters/api-adapter.js';
import type { A2UIComposer } from '../infrastructure/transports/a2ui/composer.js';
import type { ContextPreparationOptions } from './context-window.js';
import type { RuntimeContext } from './tooling/runtime-context.js';
import type { Sink } from './output-sink.js';
import type {
  ExecuteToolCallWithRetry,
  ToolRoundInput,
  ToolRoundResult,
} from './tooling/tool-round-contracts.js';
import type {
  HistoryMessage,
  AiSettings,
  StreamResult,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from '../types.js';

/** Explicit capabilities required by the sink independent ReAct loop. */
export interface ToolCatalogPort {
  getToolDefinitions(agentId?: string): Promise<ToolDefinition[]>;
  getToolCallSummary(toolCall: ToolCall): string | undefined;
}

export interface ToolExecutionPort {
  executeToolCallWithRetry: ExecuteToolCallWithRetry;
}

export interface AgentRuntimePorts extends ToolCatalogPort, ToolExecutionPort {
  getAdapter(apiType: string): ApiAdapter | undefined;
  executeRound(input: ToolRoundInput, sink?: Sink): Promise<ToolRoundResult>;
  prepareContext(
    messages: HistoryMessage[],
    options: ContextPreparationOptions,
  ): Promise<HistoryMessage[]>;
  estimateMessagesTokens(messages: HistoryMessage[]): number;
  contextTokenBudget: number;
  outputTokenReserve: number;
  createRun(options: Omit<AgentRunOptions, 'eventRepository'>): AgentRun;
  registerRun(run: AgentRun): void;
  withRunContext<T>(run: AgentRun, operation: () => T): T;
  withRoundContext<T>(run: AgentRun, round: number, operation: () => T): T;
  createComposer(): A2UIComposer;
}

/** Stable request shape shared by HTTP, IPC, CLI, and eval callers. */
export interface AgentRuntimeRequest {
  messages: HistoryMessage[];
  settings: AiSettings;
  agent?: string;
  signal?: AbortSignal;
  conversationId?: string;
  executionPolicy?: {
    maxToolCalls?: number;
    maxToolCallsByName?: Record<string, number>;
    maxToolCallsPerRoundByName?: Record<string, number>;
  };
  existingRun?: AgentRun;
  runtimeContext?: RuntimeContext;
}

export type AgentRuntimeResult = StreamResult;
export type AgentRuntimeUsage = TokenUsage;
