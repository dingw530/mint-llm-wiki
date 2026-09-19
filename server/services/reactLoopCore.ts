import type {
  HistoryMessage,
  AiSettings,
  StreamResult,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from '../types.js';
import { getAdapter } from './adapters/apiAdapter.js';
import { toolLoopEngine } from './toolRoundEngine.js';
import { getAllToolDefinitions, getToolCallSummary } from './toolOrchestration.js';
import type { Sink } from './sink.js';
import {
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  DEFAULT_OUTPUT_TOKEN_RESERVE,
  prepareContext,
} from './utils/contextWindow.js';
import { v4 as uuidv4 } from 'uuid';
import { ReactEventEmitter, subscribeReactEvents } from './reactEvents.js';
import type { ReactEventPayload } from './reactEvents.js';
import { type AgentRun, agentRunRegistry } from './agentRun.js';
import { createDurableAgentRun } from './agentRunFactory.js';
import { estimateMessagesTokens } from './utils/tokenEstimator.js';
import {
  buildAgentStatusMessage,
  removeAgentStatusMessages,
  type AgentToolBudget,
  type AgentStatusSnapshot,
} from './agentStatusBar.js';
import { A2UIComposer } from './a2ui/composer.js';
import { withLangfuseAgentContext, withLangfuseRoundContext } from './observability/langfuse.js';

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
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
  settings: AiSettings,
  apiUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<HistoryMessage[]> {
  return prepareContext(messages, {
    maxTokens: DEFAULT_CONTEXT_TOKEN_BUDGET - DEFAULT_OUTPUT_TOKEN_RESERVE,
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

/** 并发执行本轮工具调用，同时保留原始索引以便恢复 assistant/tool 消息顺序。 */
async function executeToolCalls(
  toolCalls: ToolCall[],
  result: StreamResult,
  context: {
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
  },
): Promise<ToolExecutionResult[]> {
  const { state, events } = context;
  return Promise.all(
    toolCalls.map(async (originalCall, index) => {
      const callId = originalCall.id || `${context.runId}:r${context.round}:c${index}`;
      const toolCall = { ...originalCall, id: callId };
      const startedAt = Date.now();
      const canExecute = reserveToolCall(
        toolCall.function.name,
        state,
        context.executionPolicy,
        context.round,
      );
      events.emit({
        type: 'tool_call_start',
        state: 'executing_tools',
        round: context.round,
        callId,
        toolName: toolCall.function.name,
        arguments: parseToolArguments(toolCall.function.arguments),
        summary: getToolCallSummary(toolCall),
      });
      state.currentTool = toolCall.function.name;
      events.emit({
        type: 'agent_status',
        ...getAgentStatus(
          state,
          'executing_tools',
          context.round,
          context.maxRounds,
          context.runStartedAt,
          context.executionPolicy,
        ),
      });

      if (!canExecute) {
        const message = `评测工具预算已用尽，已拦截 ${toolCall.function.name}。请基于已有结果直接回答，不要继续调用工具。`;
        events.emit({
          type: 'tool_call_end',
          round: context.round,
          callId,
          toolName: toolCall.function.name,
          result: message,
          duration: Date.now() - startedAt,
          status: 'success',
          summary: '已达到评测工具预算，未执行该调用',
        });
        state.forceFinalAnswer = true;
        state.budgetExhausted = true;
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

      let attempts = 0;
      const execution = await toolLoopEngine.executeToolCallWithRetry(
        toolCall,
        result.reasoning,
        context.maxRetries,
        (attempt, error) => {
          attempts = attempt;
          state.retryCount += 1;
          state.lastError = error.message.substring(0, 200);
          events.emit({
            type: 'tool_call_error',
            round: context.round,
            callId,
            toolName: toolCall.function.name,
            error: error.message.substring(0, 200),
            retryCount: attempt,
            maxRetries: context.maxRetries,
            phase: 'retrying',
            status: 'retrying',
          });
          events.emit({
            type: 'agent_status',
            ...getAgentStatus(
              state,
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
        },
      );
      // 工具可能并发完成；事件按完成时间发送，但消息稍后按 index 排序回填上下文。
      const duration = Date.now() - startedAt;
      const resultStr = execution.toolMsg.content.substring(0, 2000);

      if (execution.approvalRequired) {
        events.emit({
          type: 'approval_required',
          round: context.round,
          callId,
          toolName: toolCall.function.name,
          approvalId: execution.approvalRequired.approvalId,
          reason: execution.approvalRequired.reason,
        });
        events.emit({
          type: 'tool_call_error',
          round: context.round,
          callId,
          toolName: toolCall.function.name,
          error: execution.approvalRequired.reason,
          retryCount: attempts,
          phase: 'final',
          status: 'approval_required',
        });
      } else if (execution.succeeded) {
        state.lastError = undefined;
        events.emit({
          type: 'tool_call_end',
          round: context.round,
          callId,
          toolName: toolCall.function.name,
          result: resultStr,
          duration,
          status: 'success',
          summary: execution.resultSummary,
        });
      } else {
        state.lastError = resultStr;
        events.emit({
          type: 'tool_call_error',
          round: context.round,
          callId,
          toolName: toolCall.function.name,
          error: resultStr,
          retryCount: attempts,
          phase: 'final',
          status: 'failed',
        });
      }
      return {
        index,
        assistantMsg: execution.assistantMsg,
        toolMsg: execution.toolMsg,
        approvalRequired: execution.approvalRequired,
        rawResult: execution.rawResult,
      };
    }),
  );
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

// ── ReAct 循环引擎 ──
/** Executes the ReAct loop against an AgentRun without depending on any transport sink. */
export async function executeReactRun(
  messages: HistoryMessage[],
  settings: AiSettings,
  run: AgentRun,
  agent?: string,
  signal?: AbortSignal,
  conversationId?: string,
  executionPolicy?: ReactExecutionPolicy,
): Promise<StreamResult> {
  const runId = run.runId;
  const events = new ReactEventEmitter(run);
  const a2uiComposer = new A2UIComposer();
  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    events.emit({ type: 'run_failed', state: 'failed', error: message });
  };

  const { apiUrl, apiKey } = settings;
  if (!apiUrl || !apiKey) {
    fail(new Error('API URL or API Key not configured'));
    return { content: '', reasoning: '', toolCalls: null, uiBlocks: [], wikiReferences: [] };
  }

  const adapter = getAdapter(settings.apiType || 'openai-chat');
  if (!adapter) {
    fail(new Error(`Unsupported API type: ${settings.apiType}`));
    return { content: '', reasoning: '', toolCalls: null, uiBlocks: [], wikiReferences: [] };
  }

  const maxIterations = Math.max(1, Math.min(20, settings.reactMaxIterations ?? 5));
  const maxRetries = Math.max(0, Math.min(10, settings.toolMaxRetries ?? 5));

  let tools: ToolDefinition[] = [];
  try {
    tools = await getAllToolDefinitions(agent);
  } catch (error) {
    fail(error);
    return { content: '', reasoning: '', toolCalls: null, uiBlocks: [], wikiReferences: [] };
  }

  let currentMessages: HistoryMessage[] = [...messages];
  const state = createRunState();
  let iteration = 0;
  let totalUsage: TokenUsage | undefined;
  const recentCallSignatures: string[] = [];
  const runStartedAt = Date.now();

  while (iteration < maxIterations && !events.isTerminal) {
    const round = iteration + 1;
    if (hasExhaustedToolBudget(state, executionPolicy)) {
      state.forceFinalAnswer = true;
      state.budgetExhausted = true;
    }
    if (signal?.aborted) {
      events.emit({ type: 'run_cancelled', state: 'cancelled' });
      break;
    }

    currentMessages = await prepareRoundContext(
      currentMessages,
      adapter,
      settings,
      apiUrl,
      apiKey,
      signal,
    );

    // 检测到重复调用或预算耗尽后，将下一次模型请求标记为最终回答，避免继续消耗工具轮次。
    const isLast = state.forceFinalAnswer || iteration === maxIterations - 1;
    // 模型的 content 统一作为回答流输出；reasoning 仍作为思考事件输出。
    // 这样首轮无工具调用时也能保留回答的增量输出，避免 thought/answer 重复发送正文。
    const isAnswerRound = isLast || state.toolCount > 0;
    const label = isAnswerRound ? 'react-answer' : 'react-thought';
    currentMessages = [
      ...removeAgentStatusMessages(currentMessages),
      buildAgentStatusMessage(
        getAgentStatus(
          state,
          'awaiting_model',
          round,
          maxIterations,
          runStartedAt,
          executionPolicy,
        ),
      ),
    ];
    events.emit({
      type: 'agent_status',
      ...getAgentStatus(
        state,
        'awaiting_model',
        round,
        maxIterations,
        runStartedAt,
        executionPolicy,
      ),
    });
    events.emit({ type: 'round_started', state: 'awaiting_model', round });

    let result: StreamResult;
    let answerStreamedThisRound = false;
    try {
      result = await withLangfuseRoundContext(run, round, () =>
        toolLoopEngine.executeRound(
          {
            messages: currentMessages,
            settings,
            tools: isLast ? undefined : tools,
            adapter,
            signal,
            label,
            emitEvent: (event: ReactEventPayload) => {
              if (event.type === 'answer' && event.content) {
                answerStreamedThisRound = true;
                emitComposedAnswer(a2uiComposer, events, runId, round, event.content);
                return;
              }
              if (event.type === 'thought' && event.content) {
                answerStreamedThisRound = true;
                emitComposedAnswer(a2uiComposer, events, runId, round, event.content);
                return;
              }
              events.emit({
                ...event,
                ...(event.type === 'thought' || event.type === 'answer' ? { round } : {}),
              } as ReactEventPayload);
            },
          },
          undefined,
        ),
      );
    } catch (error) {
      console.error('[reactChat] executeRound failed:', error);
      fail(error);
      break;
    }
    totalUsage = addUsage(totalUsage, result.usage);

    const toolCalls =
      result.toolCalls?.filter((toolCall): toolCall is ToolCall => Boolean(toolCall)) || null;

    if (!toolCalls || toolCalls.length === 0) {
      if (!answerStreamedThisRound && result.content) {
        emitComposedAnswer(a2uiComposer, events, runId, round, result.content);
      }
      emitComposedAnswer(a2uiComposer, events, runId, round, '', true);
      state.finalContent = a2uiComposer.sanitizeContent(result.content);
      state.finalReasoning = result.reasoning;
      state.streamedAsAnswer = true;
      events.emit({
        type: 'agent_status',
        ...getAgentStatus(state, 'completed', round, maxIterations, runStartedAt, executionPolicy),
      });
      events.emit({
        type: 'run_completed',
        state: 'completed',
        content: state.finalContent,
        reasoning: state.finalReasoning,
        ...(totalUsage?.totalTokens === undefined
          ? {
              estimatedTokens: estimateMessagesTokens([
                ...currentMessages,
                { role: 'assistant', content: state.finalContent, reasoning: state.finalReasoning },
              ]),
            }
          : totalUsage),
      });
      break;
    }

    const toolResults = await executeToolCalls(toolCalls, result, {
      runId,
      round,
      currentMessages,
      settings,
      agent,
      conversationId,
      maxRetries,
      signal,
      events,
      state,
      maxRounds: maxIterations,
      runStartedAt,
      executionPolicy,
    });

    if (toolResults.some((result) => result.approvalRequired)) {
      // 审批请求需要由外部流程恢复，当前运行不能继续追加工具结果或再次请求模型。
      state.awaitingApproval = true;
      break;
    }

    toolResults
      .sort((left, right) => left.index - right.index)
      .forEach((toolResult) => {
        const toolCall = toolCalls[toolResult.index];
        const uiResult = a2uiComposer.handle({
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
          a2uiComposer.captureToolResult(toolCall.function.name, toolResult.rawResult, {
            runId,
            round,
            toolCallId: toolCall.id,
          });
        }
        if (uiResult.contextResult) toolResult.toolMsg.content = uiResult.contextResult;
        currentMessages.push(toolResult.assistantMsg, toolResult.toolMsg);
      });

    // discover/load 工具可能在本轮改变可用 MCP 工具集；下一轮使用最新定义。
    tools = await getAllToolDefinitions(agent);

    if (signal?.aborted) {
      events.emit({ type: 'run_cancelled', state: 'cancelled' });
      break;
    }

    const signature = toolCalls
      .map((tc) => `${tc.function.name}:${tc.function.arguments}`)
      .sort()
      .join('|');
    recentCallSignatures.push(signature);

    if (recentCallSignatures.length >= 3) {
      const last3 = recentCallSignatures.slice(-3);
      // 参数可能只发生小幅变化，因此使用相似度而非字符串完全相等来识别循环。
      if (last3.every((s) => levenshteinSimilarity(s, last3[0]) > 0.7)) {
        state.forceFinalAnswer = true;
        events.emit({
          type: 'agent_status',
          ...getAgentStatus(
            state,
            'finalizing',
            round,
            maxIterations,
            runStartedAt,
            executionPolicy,
          ),
        });
        events.emit({
          type: 'loop_detected',
          state: 'finalizing',
          round,
          message: '检测到重复工具调用，强制生成最终答案',
        });
      }
    }

    iteration++;
  }

  if (!events.isTerminal) {
    if (signal?.aborted) {
      events.emit({ type: 'run_cancelled', state: 'cancelled' });
    } else if (!state.streamedAsAnswer && !state.awaitingApproval) {
      if (state.finalReasoning) events.emit({ type: 'thought', reasoning: state.finalReasoning });
      events.emit({ type: 'answer_ready' });
      events.emit({
        type: 'run_completed',
        state: 'completed',
        content: a2uiComposer.sanitizeContent(state.finalContent),
        reasoning: state.finalReasoning,
        ...(totalUsage?.totalTokens === undefined ? {} : totalUsage),
      });
    }
  }

  return {
    content: state.finalContent,
    reasoning: state.finalReasoning,
    toolCalls: null,
    uiBlocks: a2uiComposer.getBlocks(),
    wikiReferences: a2uiComposer.getDisplayReferences(),
    usage: totalUsage,
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
  agent?: string,
  signal?: AbortSignal,
  conversationId?: string,
  executionPolicy?: ReactExecutionPolicy,
  existingRun?: AgentRun,
): Promise<StreamResult> {
  const run = existingRun || createDurableAgentRun({ runId: uuidv4(), conversationId });
  if (!existingRun) agentRunRegistry.register(run);
  const detachSink = subscribeReactEvents(run, sink);
  if (run.getSnapshot().sequence === 0)
    new ReactEventEmitter(run).emit({ type: 'run_started', state: 'running' });
  try {
    return await withLangfuseAgentContext(run, () =>
      executeReactRun(messages, settings, run, agent, signal, conversationId, executionPolicy),
    );
  } finally {
    detachSink();
    if (!sink.writableEnded) sink.end();
  }
}
