import type { ApiAdapter } from '../../infrastructure/ai/adapters/api-adapter.js';
import type { ReactEventPayload } from '../react-events.js';
import type { RuntimeContext } from './runtime-context.js';
import type {
  AiSettings,
  HistoryMessage,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from '../../types.js';

export interface ToolRoundInput {
  messages: HistoryMessage[];
  settings: AiSettings;
  tools?: ToolDefinition[];
  adapter?: ApiAdapter;
  signal?: AbortSignal;
  conversationId?: string;
  label?: string;
  emitEvent?: (event: ReactEventPayload) => void;
  runtimeContext?: RuntimeContext;
}

export interface ToolRoundResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[] | null;
  usage?: TokenUsage;
}

export interface ToolExecutionResult {
  assistantMsg: HistoryMessage;
  toolMsg: HistoryMessage;
  succeeded: boolean;
  errorCode?: string;
  retryable?: boolean;
  resultSummary?: string;
  approvalRequired?: { approvalId?: string; reason: string };
  rawResult?: unknown;
}

export interface ApprovalResumeContext {
  runId?: string;
  messages: HistoryMessage[];
  settings: AiSettings;
  agent?: string;
  reasoning?: string;
}

export interface ToolExecutionOptions {
  runId?: string;
  signal?: AbortSignal;
  approvalGranted?: boolean;
  approvalContext?: ApprovalResumeContext;
  runtimeContext?: RuntimeContext;
}

export type ExecuteToolCallWithRetry = (
  toolCall: ToolCall,
  reasoning: string | undefined,
  maxRetries: number,
  onRetry?: (attempt: number, error: Error) => void,
  conversationId?: string,
  options?: ToolExecutionOptions,
) => Promise<ToolExecutionResult>;
