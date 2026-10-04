import type {
  HistoryMessage,
  AiSettings,
  StreamResult,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from '../types.js';
import type { AgentRuntimePorts } from './contracts.js';
import type { A2UIComposer } from '../services/a2ui/composer.js';
import type { Sink } from './output-sink.js';
import { v4 as uuidv4 } from 'uuid';
import { ReactEventEmitter, subscribeReactEvents } from './react-events.js';
import type { ReactEventPayload } from './react-events.js';
import type { AgentRun } from './agent-run.js';
import {
  buildAgentStatusMessage,
  removeAgentStatusMessages,
  type AgentToolBudget,
  type AgentStatusSnapshot,
} from './agent-status.js';
import type { RuntimeContext } from '../services/runtime/runtimeContext.js';

// ── 编辑距离相似度（用于循环检测） ──
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0 || lenB === 0) return 0;

  const maxLen = Math.max(lenA, lenB);
  const matrix: number[][] = Array.from({ length: lenA + 1 }, () => Array(lenB + 1).fill(0));

  for (let i = 0; i <= lenA; i++) matrix[i][0] = i;
  for (let j = 0; j <= lenB; j++) matrix[0][j] = j;

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  const distance = matrix[lenA][lenB];
  return 1 - distance / maxLen;
}

interface ReactRunState {
  finalContent: string;
  finalReasoning: string;
  streamedAsAnswer: boolean;
  awaitingApproval: boolean;
  forceFinalAnswer: boolean;
  budgetExhausted: boolean;
  toolCounts: Record<string, number>;
  toolCountsByRound: Record<string, Record<string, number>>;
  toolCount: number;
  currentTool?: string;
  retryCount: number;
  lastError?: string;
}

interface ToolExecutionResult {
  index: number;
  assistantMsg: HistoryMessage;
  toolMsg: HistoryMessage;
  approvalRequired?: { approvalId?: string; reason: string };
  rawResult?: unknown;
}

export interface ReactExecutionPolicy {
  maxToolCalls?: number;
  maxToolCallsByName?: Record<string, number>;
  maxToolCallsPerRoundByName?: Record<string, number>;
}

/** 创建一次 ReAct 运行的可变状态，避免把状态散落在主循环的多个闭包变量中。 */
function createRunState(): ReactRunState {
  return {
    finalContent: '',
    finalReasoning: '',
    streamedAsAnswer: false,
    awaitingApproval: false,
    forceFinalAnswer: false,
    budgetExhausted: false,
    toolCounts: {},
    toolCountsByRound: {},
    toolCount: 0,
    retryCount: 0,
  };
}

/** 将模型答案交给 Composer，并把文本与 A2UI 输出转发到 ReactEvent 流。 */
function emitComposedAnswer(
  composer: A2UIComposer,
  events: ReactEventEmitter,
  runId: string,
  round: number,
  content: string,
  completed = false,
): void {
  const output = composer.handle({
    runId,
    round,
    event: { kind: completed ? 'answer_completed' : 'answer_chunk', content },
  });
  for (const item of output.outputs) {
    if (item.kind === 'text') {
      events.emit({ type: 'answer', content: item.content, round });
      continue;
    }
    for (const message of item.emission.messages) {
      events.emit({
        type: 'a2ui',
        segmentId: item.emission.segmentId,
        surfaceId: item.emission.surfaceId,
        message,
        round,
      });
    }
  }
}

/** 从运行状态生成状态栏快照；快照中的计数器必须复制，避免后续轮次改变已发送事件。 */
function getAgentStatus(
  state: ReactRunState,
  phase: AgentStatusSnapshot['phase'],
  round: number,
  maxRounds: number,
  runStartedAt: number,
  executionPolicy?: ReactExecutionPolicy,
): AgentStatusSnapshot {
  return {
    round,
    maxRounds,
    elapsedMs: Date.now() - runStartedAt,
    toolCount: state.toolCount,
    toolCounts: { ...state.toolCounts },
    toolBudgets: getToolBudgets(state, executionPolicy),
    totalToolBudget: getTotalToolBudget(state, executionPolicy),
    currentTool: state.currentTool,
    retryCount: state.retryCount,
    lastError: state.lastError,
    loopDetected: state.forceFinalAnswer && !state.budgetExhausted,
    phase,
  };
}

function getToolBudgets(
  state: ReactRunState,
  executionPolicy?: ReactExecutionPolicy,
): Record<string, AgentToolBudget> {
  const limits = executionPolicy?.maxToolCallsByName || {};
  return Object.fromEntries(
    Object.entries(limits).map(([name, limit]) => {
      const used = Math.min(state.toolCounts[name] || 0, limit);
      return [name, { limit, used, remaining: Math.max(0, limit - used) }];
    }),
  );
}

function getTotalToolBudget(
  state: ReactRunState,
  executionPolicy?: ReactExecutionPolicy,
): AgentToolBudget | undefined {
  const limit = executionPolicy?.maxToolCalls;
  if (limit === undefined) return undefined;
  const used = Math.min(state.toolCount, limit);
  return { limit, used, remaining: Math.max(0, limit - used) };
}

function hasExhaustedToolBudget(
  state: ReactRunState,
  executionPolicy?: ReactExecutionPolicy,
): boolean {
  if (
    executionPolicy?.maxToolCalls !== undefined &&
    state.toolCount >= executionPolicy.maxToolCalls
  )
    return true;
  return Object.entries(executionPolicy?.maxToolCallsByName || {}).some(
    ([name, limit]) => (state.toolCounts[name] || 0) >= limit,
  );
}

/** 在每轮请求模型前压缩上下文，摘要提示词明确要求保留后续工具执行所需的事实。 */
async function prepareRoundContext(
  messages: HistoryMessage[],
  adapter: NonNullable<ReturnType<AgentRuntimePorts['getAdapter']>>,
  settings: AiSettings,
  apiUrl: string,
  apiKey: string,
  ports: AgentRuntimePorts,
  signal?: AbortSignal,
): Promise<HistoryMessage[]> {
  return ports.prepareContext(messages, {
    maxTokens: ports.contextTokenBudget - ports.outputTokenReserve,
    summarize: async (olderMessages) => {
      const source = olderMessages
        .map((message) => {
          const tools = message.tool_calls?.map((call) => call.function.name).join(', ');
          return `${message.role}${tools ? ` [${tools}]` : ''}: ${message.content || ''}`;
        })
        .join('\n');
      return adapter.call(
        [
          {
            role: 'system',
            content:
              '将 Agent 的较早轨迹压缩成结构化摘要。必须保留架构决策、约束、已修改文件、验证 pass/fail、失败路径、TODO、文件名、URL、UUID 和 hash。不要添加原文没有的事实。',
          },
          { role: 'user', content: source },
        ],
        { modelId: settings.modelId },
        apiUrl,
        apiKey,
        { maxTokens: 2_000, temperature: 0.1, signal },
      );
    },
  });
}

interface ToolCallExecutionContext {
  runId: string;
  round: number;
  currentMessages: HistoryMessage[];
  settings: AiSettings;
  agent?: string;
  conversationId?: string;
  maxRetries: number;
  signal?: AbortSignal;
  events: ReactEventEmitter;
  state: ReactRunState;
  maxRounds: number;
  runStartedAt: number;
  executionPolicy?: ReactExecutionPolicy;
  runtimeContext?: RuntimeContext;
  ports: AgentRuntimePorts;
}

/** Run tool calls concurrently while retaining their original context order. */
async function executeToolCalls(
  toolCalls: ToolCall[],
  result: StreamResult,
  context: ToolCallExecutionContext,
): Promise<ToolExecutionResult[]> {
  return Promise.all(
    toolCalls.map((toolCall, index) => executeOneToolCall(toolCall, index, result, context)),
  );
}

async function executeOneToolCall(
  originalCall: ToolCall,
  index: number,
  result: StreamResult,
  context: ToolCallExecutionContext,
): Promise<ToolExecutionResult> {
  const callId = originalCall.id || `${context.runId}:r${context.round}:c${index}`;
  const toolCall = { ...originalCall, id: callId };
  const startedAt = Date.now();
  const allowed = reserveToolCall(
    toolCall.function.name,
    context.state,
    context.executionPolicy,
    context.round,
  );
  emitToolCallStarted(toolCall, callId, context);
  if (!allowed)
    return budgetRejectedToolResult(toolCall, callId, index, result, startedAt, context);

  const { execution, attempts } = await executeToolCallWithRetries(toolCall, result, context);
  emitToolCallOutcome(toolCall, callId, attempts, execution, startedAt, context);
  return {
    index,
    assistantMsg: execution.assistantMsg,
    toolMsg: execution.toolMsg,
    approvalRequired: execution.approvalRequired,
    rawResult: execution.rawResult,
  };
}

function emitToolCallStarted(
  toolCall: ToolCall,
  callId: string,
  context: ToolCallExecutionContext,
): void {
  const { state, events, round } = context;
  events.emit({
    type: 'tool_call_start',
    state: 'executing_tools',
    round,
    callId,
    toolName: toolCall.function.name,
    arguments: parseToolArguments(toolCall.function.arguments),
    summary: context.ports.getToolCallSummary(toolCall),
  });
  state.currentTool = toolCall.function.name;
  events.emit({
    type: 'agent_status',
    ...getAgentStatus(
      state,
      'executing_tools',
      round,
      context.maxRounds,
      context.runStartedAt,
      context.executionPolicy,
    ),
  });
}

function budgetRejectedToolResult(
  toolCall: ToolCall,
  callId: string,
  index: number,
  result: StreamResult,
  startedAt: number,
  context: ToolCallExecutionContext,
): ToolExecutionResult {
  const message = `评测工具预算已用尽，已拦截 ${toolCall.function.name}。请基于已有结果直接回答，不要继续调用工具。`;
  context.events.emit({
    type: 'tool_call_end',
    round: context.round,
    callId,
    toolName: toolCall.function.name,
    result: message,
    duration: Date.now() - startedAt,
    status: 'success',
    summary: '已达到评测工具预算，未执行该调用',
  });
  context.state.forceFinalAnswer = true;
  context.state.budgetExhausted = true;
  return {
    index,
    assistantMsg: {
      role: 'assistant',
      content: '',
      tool_calls: [toolCall],
      reasoning: result.reasoning || undefined,
    },
    toolMsg: { role: 'tool', tool_call_id: toolCall.id, content: message },
  };
}

async function executeToolCallWithRetries(
  toolCall: ToolCall,
  result: StreamResult,
  context: ToolCallExecutionContext,
): Promise<{
  execution: Awaited<ReturnType<AgentRuntimePorts['executeToolCallWithRetry']>>;
  attempts: number;
}> {
  let attempts = 0;
  const execution = await context.ports.executeToolCallWithRetry(
    toolCall,
    result.reasoning,
    context.maxRetries,
    (attempt, error) => {
      attempts = attempt;
      context.state.retryCount += 1;
      context.state.lastError = error.message.substring(0, 200);
      context.events.emit({
        type: 'tool_call_error',
        round: context.round,
        callId: toolCall.id,
        toolName: toolCall.function.name,
        error: error.message.substring(0, 200),
        retryCount: attempt,
        maxRetries: context.maxRetries,
        phase: 'retrying',
        status: 'retrying',
      });
      context.events.emit({
        type: 'agent_status',
        ...getAgentStatus(
          context.state,
          'executing_tools',
          context.round,
          context.maxRounds,
          context.runStartedAt,
          context.executionPolicy,
        ),
      });
    },
    context.conversationId,
    {
      approvalContext: {
        runId: context.events.runId,
        messages: cloneMessages(context.currentMessages),
        settings: context.settings,
        agent: context.agent,
        reasoning: result.reasoning,
      },
      runtimeContext: context.runtimeContext,
    },
  );
  return { execution, attempts };
}

function emitToolCallOutcome(
  toolCall: ToolCall,
  callId: string,
  attempts: number,
  execution: Awaited<ReturnType<AgentRuntimePorts['executeToolCallWithRetry']>>,
  startedAt: number,
  context: ToolCallExecutionContext,
): void {
  const duration = Date.now() - startedAt;
  const result = execution.toolMsg.content.substring(0, 2000);
  if (execution.approvalRequired) {
    context.events.emit({
      type: 'approval_required',
      round: context.round,
      callId,
      toolName: toolCall.function.name,
      approvalId: execution.approvalRequired.approvalId,
      reason: execution.approvalRequired.reason,
    });
    context.events.emit({
      type: 'tool_call_error',
      round: context.round,
      callId,
      toolName: toolCall.function.name,
      error: execution.approvalRequired.reason,
      retryCount: attempts,
      phase: 'final',
      status: 'approval_required',
    });
    return;
  }
  if (execution.succeeded) {
    context.state.lastError = undefined;
    context.events.emit({
      type: 'tool_call_end',
      round: context.round,
      callId,
      toolName: toolCall.function.name,
      result,
      duration,
      status: 'success',
      summary: execution.resultSummary,
    });
    return;
  }
  context.state.lastError = result;
  context.events.emit({
    type: 'tool_call_error',
    round: context.round,
    callId,
    toolName: toolCall.function.name,
    error: result,
    retryCount: attempts,
    phase: 'final',
    status: 'failed',
  });
}

/** 预留一次工具调用名额；被拒绝的调用不计入已消耗预算。 */
function reserveToolCall(
  toolName: string,
  state: ReactRunState,
  policy?: ReactExecutionPolicy,
  round?: number,
): boolean {
  const totalAllowed = policy?.maxToolCalls === undefined || state.toolCount < policy.maxToolCalls;
  const nameLimit = policy?.maxToolCallsByName?.[toolName];
  const nameAllowed = nameLimit === undefined || (state.toolCounts[toolName] || 0) < nameLimit;
  const roundKey = String(round ?? 0);
  const roundCounts = state.toolCountsByRound[roundKey] || {};
  const roundLimit = policy?.maxToolCallsPerRoundByName?.[toolName];
  const roundAllowed = roundLimit === undefined || (roundCounts[toolName] || 0) < roundLimit;
  if (!totalAllowed || !nameAllowed || !roundAllowed) return false;
  state.toolCount += 1;
  state.toolCounts[toolName] = (state.toolCounts[toolName] || 0) + 1;
  roundCounts[toolName] = (roundCounts[toolName] || 0) + 1;
  state.toolCountsByRound[roundKey] = roundCounts;
  return true;
}

/** 兼容适配器返回的 JSON 参数和无法解析的原始参数字符串。 */
function parseToolArguments(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson);
  } catch {
    return argumentsJson;
  }
}

/** 为审批上下文创建浅层消息副本，避免工具执行过程修改当前对话轨迹。 */
function cloneMessages(messages: HistoryMessage[]): HistoryMessage[] {
  return messages.map((message) => ({
    ...message,
    ...(message.tool_calls
      ? {
          tool_calls: message.tool_calls.map((call) => ({
            ...call,
            function: { ...call.function },
          })),
        }
      : {}),
  }));
}

interface PreparedModelExecution {
  adapter: NonNullable<ReturnType<AgentRuntimePorts['getAdapter']>>;
  tools: ToolDefinition[];
}

interface ModelRoundInput {
  messages: HistoryMessage[];
  settings: AiSettings;
  tools?: ToolDefinition[];
  adapter: NonNullable<ReturnType<AgentRuntimePorts['getAdapter']>>;
  signal?: AbortSignal;
  runtimeContext?: RuntimeContext;
  label: string;
  run: AgentRun;
  runId: string;
  round: number;
  events: ReactEventEmitter;
  composer: A2UIComposer;
  ports: AgentRuntimePorts;
}

interface ModelRoundOutput {
  result: StreamResult;
  answerStreamedThisRound: boolean;
}

function emitRunFailure(events: ReactEventEmitter, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  events.emit({ type: 'run_failed', state: 'failed', error: message });
}

/** Resolve the model adapter and tool catalog before entering the round loop. */
async function prepareModelExecution(
  settings: AiSettings,
  agent: string | undefined,
  ports: AgentRuntimePorts,
  events: ReactEventEmitter,
): Promise<PreparedModelExecution | undefined> {
  if (!settings.apiUrl || !settings.apiKey) {
    emitRunFailure(events, new Error('API URL or API Key not configured'));
    return undefined;
  }
  const adapter = ports.getAdapter(settings.apiType || 'openai-chat');
  if (!adapter) {
    emitRunFailure(events, new Error(`Unsupported API type: ${settings.apiType}`));
    return undefined;
  }
  try {
    return { adapter, tools: await ports.getToolDefinitions(agent) };
  } catch (error) {
    emitRunFailure(events, error);
    return undefined;
  }
}

function prepareRoundMessages(
  messages: HistoryMessage[],
  state: ReactRunState,
  round: number,
  maxRounds: number,
  runStartedAt: number,
  executionPolicy: ReactExecutionPolicy | undefined,
  events: ReactEventEmitter,
): HistoryMessage[] {
  const status = getAgentStatus(
    state,
    'awaiting_model',
    round,
    maxRounds,
    runStartedAt,
    executionPolicy,
  );
  const nextMessages = [...removeAgentStatusMessages(messages), buildAgentStatusMessage(status)];
  events.emit({ type: 'agent_status', ...status });
  events.emit({ type: 'round_started', state: 'awaiting_model', round });
  return nextMessages;
}

async function executeModelRound(input: ModelRoundInput): Promise<ModelRoundOutput | undefined> {
  let answerStreamedThisRound = false;
  try {
    const result = await input.ports.withRoundContext(input.run, input.round, () =>
      input.ports.executeRound({
        messages: input.messages,
        settings: input.settings,
        tools: input.tools,
        adapter: input.adapter,
        signal: input.signal,
        runtimeContext: input.runtimeContext,
        label: input.label,
        emitEvent: (event: ReactEventPayload) => {
          if ((event.type === 'answer' || event.type === 'thought') && event.content) {
            answerStreamedThisRound = true;
            emitComposedAnswer(
              input.composer,
              input.events,
              input.runId,
              input.round,
              event.content,
            );
            return;
          }
          input.events.emit({
            ...event,
            ...(event.type === 'thought' || event.type === 'answer' ? { round: input.round } : {}),
          } as ReactEventPayload);
        },
      }),
    );
    return { result, answerStreamedThisRound };
  } catch (error) {
    console.error('[reactChat] executeRound failed:', error);
    emitRunFailure(input.events, error);
    return undefined;
  }
}

function completeAnswerRound(
  result: StreamResult,
  currentMessages: HistoryMessage[],
  totalUsage: TokenUsage | undefined,
  state: ReactRunState,
  maxRounds: number,
  round: number,
  runStartedAt: number,
  executionPolicy: ReactExecutionPolicy | undefined,
  composer: A2UIComposer,
  events: ReactEventEmitter,
  runId: string,
  answerStreamed: boolean,
  ports: AgentRuntimePorts,
): void {
  if (!answerStreamed && result.content)
    emitComposedAnswer(composer, events, runId, round, result.content);
  emitComposedAnswer(composer, events, runId, round, '', true);
  state.finalContent = composer.sanitizeContent(result.content);
  state.finalReasoning = result.reasoning;
  state.streamedAsAnswer = true;
  events.emit({
    type: 'agent_status',
    ...getAgentStatus(state, 'completed', round, maxRounds, runStartedAt, executionPolicy),
  });
  events.emit({
    type: 'run_completed',
    state: 'completed',
    content: state.finalContent,
    reasoning: state.finalReasoning,
    ...(totalUsage?.totalTokens === undefined
      ? {
          estimatedTokens: ports.estimateMessagesTokens([
            ...currentMessages,
            { role: 'assistant', content: state.finalContent, reasoning: state.finalReasoning },
          ]),
        }
      : totalUsage),
  });
}

function appendToolResultsToContext(
  toolCalls: ToolCall[],
  toolResults: ToolExecutionResult[],
  composer: A2UIComposer,
  runId: string,
  round: number,
  currentMessages: HistoryMessage[],
): void {
  toolResults
    .sort((left, right) => left.index - right.index)
    .forEach((toolResult) => {
      const toolCall = toolCalls[toolResult.index];
      const uiResult = composer.handle({
        runId,
        round,
        event: {
          kind: 'tool_result',
          toolName: toolCall.function.name,
          toolCallId: toolCall.id,
          result: toolResult.toolMsg.content,
        },
      });
      if (toolResult.rawResult !== undefined) {
        composer.captureToolResult(toolCall.function.name, toolResult.rawResult, {
          runId,
          round,
          toolCallId: toolCall.id,
        });
      }
      if (uiResult.contextResult) toolResult.toolMsg.content = uiResult.contextResult;
      currentMessages.push(toolResult.assistantMsg, toolResult.toolMsg);
    });
}

function markRepeatedToolLoop(
  toolCalls: ToolCall[],
  recentCallSignatures: string[],
  state: ReactRunState,
  events: ReactEventEmitter,
  round: number,
  maxRounds: number,
  runStartedAt: number,
  executionPolicy: ReactExecutionPolicy | undefined,
): void {
  const signature = toolCalls
    .map((toolCall) => `${toolCall.function.name}:${toolCall.function.arguments}`)
    .sort()
    .join('|');
  recentCallSignatures.push(signature);
  if (recentCallSignatures.length < 3) return;
  const lastThree = recentCallSignatures.slice(-3);
  if (!lastThree.every((item) => levenshteinSimilarity(item, lastThree[0]) > 0.7)) return;
  state.forceFinalAnswer = true;
  events.emit({
    type: 'agent_status',
    ...getAgentStatus(state, 'finalizing', round, maxRounds, runStartedAt, executionPolicy),
  });
  events.emit({
    type: 'loop_detected',
    state: 'finalizing',
    round,
    message: '检测到重复工具调用，强制生成最终答案',
  });
}

function finishReactRun(
  signal: AbortSignal | undefined,
  state: ReactRunState,
  totalUsage: TokenUsage | undefined,
  composer: A2UIComposer,
  events: ReactEventEmitter,
): void {
  if (events.isTerminal) return;
  if (signal?.aborted) {
    events.emit({ type: 'run_cancelled', state: 'cancelled' });
    return;
  }
  if (state.streamedAsAnswer || state.awaitingApproval) return;
  if (state.finalReasoning) events.emit({ type: 'thought', reasoning: state.finalReasoning });
  events.emit({ type: 'answer_ready' });
  events.emit({
    type: 'run_completed',
    state: 'completed',
    content: composer.sanitizeContent(state.finalContent),
    reasoning: state.finalReasoning,
    ...(totalUsage?.totalTokens === undefined ? {} : totalUsage),
  });
}

interface ReactExecutionState {
  currentMessages: HistoryMessage[];
  totalUsage?: TokenUsage;
}

interface ReactLoopContext {
  settings: AiSettings;
  run: AgentRun;
  runId: string;
  agent?: string;
  signal?: AbortSignal;
  conversationId?: string;
  executionPolicy?: ReactExecutionPolicy;
  runtimeContext?: RuntimeContext;
  ports: AgentRuntimePorts;
  events: ReactEventEmitter;
  composer: A2UIComposer;
  state: ReactRunState;
  prepared: PreparedModelExecution;
  execution: ReactExecutionState;
}

/** Process one model round, preserving model/tool/terminal event ordering. */
async function executeReactRound(
  context: ReactLoopContext,
  round: number,
  maxRounds: number,
  maxRetries: number,
  runStartedAt: number,
  recentCallSignatures: string[],
): Promise<boolean> {
  if (hasExhaustedToolBudget(context.state, context.executionPolicy)) {
    context.state.forceFinalAnswer = true;
    context.state.budgetExhausted = true;
  }
  if (context.signal?.aborted) {
    context.events.emit({ type: 'run_cancelled', state: 'cancelled' });
    return true;
  }
  context.execution.currentMessages = await prepareRoundContext(
    context.execution.currentMessages,
    context.prepared.adapter,
    context.settings,
    context.settings.apiUrl,
    context.settings.apiKey,
    context.ports,
    context.signal,
  );
  const isLast = context.state.forceFinalAnswer || round === maxRounds;
  const isAnswerRound = isLast || context.state.toolCount > 0;
  context.execution.currentMessages = prepareRoundMessages(
    context.execution.currentMessages,
    context.state,
    round,
    maxRounds,
    runStartedAt,
    context.executionPolicy,
    context.events,
  );
  const output = await executeModelRound({
    messages: context.execution.currentMessages,
    settings: context.settings,
    tools: isLast ? undefined : context.prepared.tools,
    adapter: context.prepared.adapter,
    signal: context.signal,
    runtimeContext: context.runtimeContext,
    label: isAnswerRound ? 'react-answer' : 'react-thought',
    run: context.run,
    runId: context.runId,
    round,
    events: context.events,
    composer: context.composer,
    ports: context.ports,
  });
  if (!output) return true;

  context.execution.totalUsage = addUsage(context.execution.totalUsage, output.result.usage);
  const toolCalls =
    output.result.toolCalls?.filter((toolCall): toolCall is ToolCall => Boolean(toolCall)) || null;
  if (!toolCalls?.length) {
    completeAnswerRound(
      output.result,
      context.execution.currentMessages,
      context.execution.totalUsage,
      context.state,
      maxRounds,
      round,
      runStartedAt,
      context.executionPolicy,
      context.composer,
      context.events,
      context.runId,
      output.answerStreamedThisRound,
      context.ports,
    );
    return true;
  }
  return executeReactToolRound(
    context,
    toolCalls,
    output.result,
    round,
    maxRounds,
    maxRetries,
    runStartedAt,
    recentCallSignatures,
  );
}

/** Execute the tool round and decide whether the model loop should continue. */
async function executeReactToolRound(
  context: ReactLoopContext,
  toolCalls: ToolCall[],
  result: StreamResult,
  round: number,
  maxRounds: number,
  maxRetries: number,
  runStartedAt: number,
  recentCallSignatures: string[],
): Promise<boolean> {
  const toolResults = await executeToolCalls(toolCalls, result, {
    runId: context.runId,
    round,
    currentMessages: context.execution.currentMessages,
    settings: context.settings,
    agent: context.agent,
    conversationId: context.conversationId,
    maxRetries,
    signal: context.signal,
    events: context.events,
    state: context.state,
    maxRounds,
    runStartedAt,
    executionPolicy: context.executionPolicy,
    runtimeContext: context.runtimeContext,
    ports: context.ports,
  });
  if (toolResults.some((toolResult) => toolResult.approvalRequired)) {
    context.state.awaitingApproval = true;
    return true;
  }
  appendToolResultsToContext(
    toolCalls,
    toolResults,
    context.composer,
    context.runId,
    round,
    context.execution.currentMessages,
  );
  context.prepared.tools = await context.ports.getToolDefinitions(context.agent);
  if (context.signal?.aborted) {
    context.events.emit({ type: 'run_cancelled', state: 'cancelled' });
    return true;
  }
  markRepeatedToolLoop(
    toolCalls,
    recentCallSignatures,
    context.state,
    context.events,
    round,
    maxRounds,
    runStartedAt,
    context.executionPolicy,
  );
  return false;
}

// ── ReAct 循环引擎 ──
/** Executes the ReAct loop against an AgentRun without depending on any transport sink. */
export async function executeReactRun(
  messages: HistoryMessage[],
  settings: AiSettings,
  run: AgentRun,
  ports: AgentRuntimePorts,
  agent?: string,
  signal?: AbortSignal,
  conversationId?: string,
  executionPolicy?: ReactExecutionPolicy,
  runtimeContext?: RuntimeContext,
): Promise<StreamResult> {
  const runId = run.runId;
  const events = new ReactEventEmitter(run);
  const composer = ports.createComposer();
  const prepared = await prepareModelExecution(settings, agent, ports, events);
  if (!prepared)
    return { content: '', reasoning: '', toolCalls: null, uiBlocks: [], wikiReferences: [] };

  const maxRounds = Math.max(1, Math.min(20, settings.reactMaxIterations ?? 5));
  const maxRetries = Math.max(0, Math.min(10, settings.toolMaxRetries ?? 5));
  const state = createRunState();
  const context: ReactLoopContext = {
    settings,
    run,
    runId,
    agent,
    signal,
    conversationId,
    executionPolicy,
    runtimeContext,
    ports,
    events,
    composer,
    state,
    prepared,
    execution: { currentMessages: [...messages] },
  };
  const recentCallSignatures: string[] = [];
  const runStartedAt = Date.now();

  for (let iteration = 0; iteration < maxRounds && !events.isTerminal; iteration += 1) {
    const shouldStop = await executeReactRound(
      context,
      iteration + 1,
      maxRounds,
      maxRetries,
      runStartedAt,
      recentCallSignatures,
    );
    if (shouldStop) break;
  }

  finishReactRun(signal, state, context.execution.totalUsage, composer, events);
  return {
    content: state.finalContent,
    reasoning: state.finalReasoning,
    toolCalls: null,
    uiBlocks: composer.getBlocks(),
    wikiReferences: composer.getDisplayReferences(),
    usage: context.execution.totalUsage,
  };
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

/**
 * Compatibility adapter that connects the Sink transport to the sink-independent ReAct runtime.
 */
export async function reactChat(
  messages: HistoryMessage[],
  settings: AiSettings,
  sink: Sink,
  ports: AgentRuntimePorts,
  agent?: string,
  signal?: AbortSignal,
  conversationId?: string,
  executionPolicy?: ReactExecutionPolicy,
  existingRun?: AgentRun,
  runtimeContext?: RuntimeContext,
): Promise<StreamResult> {
  const run = existingRun || ports.createRun({ runId: uuidv4(), conversationId });
  if (!existingRun) ports.registerRun(run);
  const detachSink = subscribeReactEvents(run, sink);
  if (run.getSnapshot().sequence === 0)
    new ReactEventEmitter(run).emit({ type: 'run_started', state: 'running' });
  try {
    return await ports.withRunContext(run, () =>
      executeReactRun(
        messages,
        settings,
        run,
        ports,
        agent,
        signal,
        conversationId,
        executionPolicy,
        runtimeContext,
      ),
    );
  } finally {
    detachSink();
    if (!sink.writableEnded) sink.end();
  }
}
