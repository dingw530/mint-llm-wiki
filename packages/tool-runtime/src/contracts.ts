export interface ToolRuntimeValidation {
  valid: boolean;
  error?: string;
}

export type ToolRuntimeAuthorization =
  | { action: 'allow' }
  | { action: 'deny'; code: string; message: string }
  | { action: 'approval_required'; reason: string; approvalId?: string };

export interface ToolRuntimeToolReference {
  name: string;
}

export interface ToolRuntimeHooks<Tool extends ToolRuntimeToolReference, Context> {
  isEnabled(tool: Tool): boolean;
  validateInput(tool: Tool, input: unknown): ToolRuntimeValidation;
  authorize(
    tool: Tool,
    input: unknown,
    context: Context,
  ): ToolRuntimeAuthorization | Promise<ToolRuntimeAuthorization>;
  execute(tool: Tool, input: unknown, context: Context, signal: AbortSignal): Promise<unknown>;
}

export type ToolRuntimePrepareResult<Tool extends ToolRuntimeToolReference, Context> =
  | {
      status: 'ready';
      tool: Tool;
      input: unknown;
      context: Context;
    }
  | {
      status: 'failed' | 'cancelled';
      error: string;
      errorCode: string;
      durationMs: number;
    }
  | {
      status: 'approval_required';
      reason: string;
      approvalId?: string;
      errorCode: 'APPROVAL_REQUIRED';
      durationMs: number;
    };

export type ToolRuntimeExecutionResult =
  | { status: 'succeeded'; data: unknown; durationMs: number }
  | {
      status: 'failed' | 'cancelled' | 'timed_out';
      error: string;
      cause: unknown;
      durationMs: number;
    };

export interface ToolRuntimePrepareOptions<
  Tool extends ToolRuntimeToolReference = ToolRuntimeToolReference,
  Context = unknown,
> {
  signal?: AbortSignal;
  validateInput?: boolean;
  authorize?: (
    tool: Tool,
    input: unknown,
    context: Context,
  ) => ToolRuntimeAuthorization | Promise<ToolRuntimeAuthorization>;
}

export interface ToolRuntimeExecuteOptions<Context> {
  signal?: AbortSignal;
  timeoutMs: number;
  /** Host adapters can add invocation identity or other trusted per-attempt context. */
  context?: Context;
  input?: unknown;
}
