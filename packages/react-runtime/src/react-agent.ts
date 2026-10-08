import type {
  ReActEvent,
  ReActModel,
  ReActModelResponse,
  ReActPolicy,
  ReActRunRequest,
  ReActRunResult,
  ReActToolDefinition,
  ReActToolCall,
  ReActToolExecutor,
  ReActToolResult,
} from './contracts.js';

const DEFAULT_MAX_STEPS = 8;
const MAX_ALLOWED_STEPS = 100;

export interface CreateReactAgentOptions<
  Message,
  ToolDefinition extends ReActToolDefinition,
  Usage = unknown,
> {
  model: ReActModel<Message, ToolDefinition, Usage>;
  toolExecutor: ReActToolExecutor<Message, Usage>;
  policy?: ReActPolicy;
}

export interface ReActAgent<Message, ToolDefinition extends ReActToolDefinition, Usage = unknown> {
  run(request: ReActRunRequest<Message, ToolDefinition>): Promise<ReActRunResult<Message, Usage>>;
}

/** Creates a bounded ReAct loop around host supplied model and tool ports. */
export function createReactAgent<
  Message,
  ToolDefinition extends ReActToolDefinition,
  Usage = unknown,
>(
  options: CreateReactAgentOptions<Message, ToolDefinition, Usage>,
): ReActAgent<Message, ToolDefinition, Usage> {
  const maxSteps = normalizeMaxSteps(options.policy?.maxSteps);
  const continueOnToolError = options.policy?.continueOnToolError ?? false;

  return {
    async run(request) {
      const messages = [...request.messages];
      const usage: Usage[] = [];
      let lastStep = 0;

      for (let step = 1; step <= maxSteps; step += 1) {
        lastStep = step;
        if (request.signal?.aborted) {
          emit(request.onEvent, { type: 'run_cancelled', step: step - 1 });
          return { messages, status: 'cancelled', steps: step - 1, usage };
        }

        emit(request.onEvent, { type: 'step_started', step });
        try {
          const availableTools = request.resolveTools
            ? await request.resolveTools(step, messages)
            : request.tools;
          const response = await options.model.generate({
            messages: [...messages],
            tools: step === maxSteps ? [] : [...availableTools],
            step,
            signal: request.signal,
          });
          if (response.usage !== undefined) usage.push(response.usage);
          if (request.signal?.aborted) {
            emit(request.onEvent, { type: 'run_cancelled', step });
            return { messages, status: 'cancelled', steps: step, usage };
          }

          const calls = [...response.toolCalls];
          emit(request.onEvent, {
            type: 'model_completed',
            step,
            toolCallCount: calls.length,
          });

          if (calls.length === 0) {
            messages.push(response.assistantMessage);
            emit(request.onEvent, { type: 'run_completed', step });
            return { messages, status: 'completed', steps: step, usage };
          }

          if (step === maxSteps) {
            emit(request.onEvent, { type: 'step_limit', step });
            return { messages, status: 'step_limit', steps: step, usage };
          }

          const knownToolNames = new Set(availableTools.map((tool) => tool.name));
          const results = await executeCalls(
            options.toolExecutor,
            calls,
            response,
            step,
            request,
            knownToolNames,
          );
          const paused = results.some((result) => result.status === 'paused');
          await request.onToolBatch?.({ calls, results, step, messages: [...messages] });
          if (paused) {
            emit(request.onEvent, { type: 'run_paused', step });
            return { messages, status: 'paused', steps: step, usage };
          }
          for (const result of results) {
            messages.push(...result.messages);
            if (
              result.status === 'failed' &&
              (!continueOnToolError || result.messages.length === 0)
            ) {
              const error = result.error || 'Tool execution failed';
              emit(request.onEvent, { type: 'run_failed', step, error });
              return { messages, status: 'failed', steps: step, usage, error };
            }
          }
        } catch (error) {
          if (request.signal?.aborted) {
            emit(request.onEvent, { type: 'run_cancelled', step });
            return { messages, status: 'cancelled', steps: step, usage };
          }
          const message = error instanceof Error ? error.message : String(error);
          emit(request.onEvent, { type: 'run_failed', step, error: message });
          return { messages, status: 'failed', steps: step, usage, error: message };
        }
      }

      emit(request.onEvent, { type: 'step_limit', step: lastStep });
      return { messages, status: 'step_limit', steps: lastStep, usage };
    },
  };
}

async function executeCalls<Message, ToolDefinition, Usage>(
  executor: ReActToolExecutor<Message, Usage>,
  calls: readonly ReActToolCall[],
  response: ReActModelResponse<Message, Usage>,
  step: number,
  request: ReActRunRequest<Message, ToolDefinition>,
  knownToolNames: ReadonlySet<string>,
): Promise<ReActToolResult<Message>[]> {
  return Promise.all(
    calls.map(async (call) => {
      emit(request.onEvent, { type: 'tool_started', step, callId: call.id, toolName: call.name });
      if (!knownToolNames.has(call.name)) {
        const result: ReActToolResult<Message> = {
          messages: [],
          status: 'failed',
          error: `Unknown tool: ${call.name}`,
        };
        emitToolCompleted(request.onEvent, step, call.id, call.name, result);
        return result;
      }
      try {
        const result = await executor.execute({ call, response, step, signal: request.signal });
        emitToolCompleted(request.onEvent, step, call.id, call.name, result);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const result: ReActToolResult<Message> = { messages: [], status: 'failed', error: message };
        emitToolCompleted(request.onEvent, step, call.id, call.name, result);
        return result;
      }
    }),
  );
}

function emitToolCompleted<Message>(
  onEvent: ReActRunRequest<Message, unknown>['onEvent'],
  step: number,
  callId: string,
  toolName: string,
  result: ReActToolResult<Message>,
): void {
  emit(onEvent, {
    type: 'tool_completed',
    step,
    callId,
    toolName,
    status: result.status,
    ...(result.error ? { error: result.error } : {}),
  });
}

function emit<Message>(
  onEvent: ReActRunRequest<Message, unknown>['onEvent'],
  event: ReActEvent<Message>,
): void {
  onEvent?.(event);
}

function normalizeMaxSteps(value: number | undefined): number {
  const maxSteps = value ?? DEFAULT_MAX_STEPS;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_ALLOWED_STEPS) {
    throw new RangeError(`maxSteps must be an integer between 1 and ${MAX_ALLOWED_STEPS}`);
  }
  return maxSteps;
}
