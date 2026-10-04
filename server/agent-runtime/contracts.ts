import type { AgentRun, AgentRunOptions } from './agent-run.js';
import type { ApiAdapter } from '../services/adapters/apiAdapter.js';
import type { A2UIComposer } from '../services/a2ui/composer.js';
import type { ContextPreparationOptions } from '../services/utils/contextWindow.js';
import type { RuntimeContext } from '../services/runtime/runtimeContext.js';
import type { Sink } from './output-sink.js';
import type {
  ToolLoopEngine,
  ToolRoundInput,
  ToolRoundResult,
} from '../services/toolRoundEngine.js';
import type {
  HistoryMessage,
  AiSettings,
  StreamResult,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from '../types.js';

/** Explicit capabilities required by the sink independent ReAct loop. */
export interface AgentRuntimePorts {
  getAdapter(apiType: string): ApiAdapter | undefined;
  getToolDefinitions(agentId?: string): Promise<ToolDefinition[]>;
  executeRound(input: ToolRoundInput, sink?: Sink): Promise<ToolRoundResult>;
  executeToolCallWithRetry: ToolLoopEngine['executeToolCallWithRetry'];
  getToolCallSummary(toolCall: ToolCall): string | undefined;
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
