/** A tool call returned by a model, with provider details kept out of the core. */
export interface ReActToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ReActToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface ReActModelRequest<Message, ToolDefinition extends ReActToolDefinition> {
  messages: readonly Message[];
  tools: readonly ToolDefinition[];
  step: number;
  signal?: AbortSignal;
}

export interface ReActModelResponse<Message, Usage = unknown> {
  assistantMessage: Message;
  toolCalls: readonly ReActToolCall[];
  usage?: Usage;
  metadata?: unknown;
}

/** Host supplied model boundary. The framework does not depend on a model SDK. */
export interface ReActModel<Message, ToolDefinition extends ReActToolDefinition, Usage = unknown> {
  generate(
    request: ReActModelRequest<Message, ToolDefinition>,
  ): Promise<ReActModelResponse<Message, Usage>>;
}

export interface ReActToolRequest<Message, Usage> {
  call: ReActToolCall;
  response: ReActModelResponse<Message, Usage>;
  step: number;
  signal?: AbortSignal;
}

export interface ReActToolResult<Message> {
  messages: readonly Message[];
  status: 'success' | 'failed' | 'paused';
  error?: string;
  metadata?: unknown;
}

/** Executes one validated tool call. Authorization and schema validation belong to the host. */
export interface ReActToolExecutor<Message, Usage = unknown> {
  execute(request: ReActToolRequest<Message, Usage>): Promise<ReActToolResult<Message>>;
}

export interface ReActPolicy {
  maxSteps?: number;
  continueOnToolError?: boolean;
}

export type ReActEvent<Message> =
  | { type: 'step_started'; step: number }
  | { type: 'model_completed'; step: number; toolCallCount: number }
  | { type: 'tool_started'; step: number; callId: string; toolName: string }
  | {
      type: 'tool_completed';
      step: number;
      callId: string;
      toolName: string;
      status: ReActToolResult<Message>['status'];
      error?: string;
    }
  | { type: 'run_paused'; step: number }
  | { type: 'run_completed'; step: number }
  | { type: 'run_cancelled'; step: number }
  | { type: 'run_failed'; step: number; error: string }
  | { type: 'step_limit'; step: number };

export interface ReActRunRequest<Message, ToolDefinition> {
  messages: readonly Message[];
  tools: readonly ToolDefinition[];
  signal?: AbortSignal;
  onEvent?: (event: ReActEvent<Message>) => void;
  resolveTools?: (step: number, messages: readonly Message[]) => Promise<readonly ToolDefinition[]>;
  onToolBatch?: (input: {
    calls: readonly ReActToolCall[];
    results: readonly ReActToolResult<Message>[];
    step: number;
    messages: readonly Message[];
  }) => Promise<void> | void;
}

export interface ReActRunResult<Message, Usage = unknown> {
  messages: Message[];
  status: 'completed' | 'paused' | 'cancelled' | 'failed' | 'step_limit';
  steps: number;
  usage: Usage[];
  error?: string;
}
