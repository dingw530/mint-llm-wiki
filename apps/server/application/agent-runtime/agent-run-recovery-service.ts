import { randomUUID } from 'node:crypto';
import {
  reduceAgentRunEvents,
  type RecoveredAgentRun,
} from '../../agent-runtime/agent-run-recovery-reducer.js';
export { reduceAgentRunEvents } from '../../agent-runtime/agent-run-recovery-reducer.js';
import { agentRunEventRepository } from '../../infrastructure/persistence/agent-run-event-repository.js';
import {
  toolInvocationRepository,
  type ToolInvocationRecord,
  type ToolInvocationRepository,
  type ToolInvocationStatus,
} from '../../infrastructure/persistence/tool-invocation-repository.js';
import type { HistoryMessage, ToolCall } from '../../types.js';
import { toolRegistry } from './tooling/tool-registry.js';
import type {
  AgentRunPersistence,
  RecoveryAction,
  RecoveryActionRecord,
} from '../../agent-runtime/agent-run-persistence.js';

export type ToolRecoveryLevel = 'never' | 'requires_confirmation' | 'safe_idempotent';

export interface RecoverableAgentRun extends RecoveredAgentRun {
  unknownTools: Array<{
    callId: string;
    toolName: string;
    recoveryLevel: ToolRecoveryLevel;
    ledgerStatus: ToolInvocationStatus | 'missing';
    argumentsAvailable: boolean;
  }>;
  actions: RecoveryAction[];
}

export interface RecoveryActionRequest {
  conversationId: string;
  runId: string;
  action: RecoveryAction;
  idempotencyKey: string;
  confirmation?: boolean;
}

type RecoveryInvocationReader = Pick<ToolInvocationRepository, 'get' | 'getArguments'>;

/** Reads one run and reduces it; kept separate so the reducer remains a pure function. */
export function recoverAgentRun(
  runId: string,
  repository: AgentRunPersistence = agentRunEventRepository,
): RecoveredAgentRun {
  return reduceAgentRunEvents(repository.read(runId));
}

/**
 * 为恢复后的新运行重建中断的工具调用及其合成未知结果。
 * @param run 已持久化的原始中断运行。
 * @param invocations 用于读取调用元数据和加密参数的仓库。
 * @returns 配对的 assistant 工具调用和要求核对外部状态的工具结果。
 */
export function buildToolRecoveryMessages(
  run: RecoveredAgentRun,
  invocations: RecoveryInvocationReader = toolInvocationRepository,
): HistoryMessage[] {
  const unknownTools = run.toolCalls.filter((tool) => tool.status === 'tool_outcome_unknown');
  if (unknownTools.length === 0) return [];

  const toolCalls = unknownTools.map((tool) =>
    restoreToolCall(run.runId, tool.callId, tool.toolName, invocations),
  );
  return [
    { role: 'assistant', content: '', tool_calls: toolCalls.map(({ call }) => call) },
    ...toolCalls.map(({ result }) => result),
  ];
}

/** Scans durable open runs and returns stable interruption diagnostics. */
export function recoverOpenAgentRuns(
  repository: AgentRunPersistence = agentRunEventRepository,
): RecoveredAgentRun[] {
  return repository.listOpenRuns().map((runId) => recoverAgentRun(runId, repository));
}

/** Lists recoverable runs for one conversation without executing a model or tool. */
export function listRecoverableRuns(
  conversationId: string,
  repository: AgentRunPersistence = agentRunEventRepository,
  invocations: RecoveryInvocationReader = toolInvocationRepository,
): RecoverableAgentRun[] {
  return recoverOpenAgentRuns(repository)
    .filter((run) => run.conversationId === conversationId)
    .filter((run) => {
      const action = repository.getRecoveryActionForOrigin(run.runId);
      return action === undefined || action.status === 'reserved';
    })
    .map((run) => toRecoverableRun(run, invocations));
}

/** Reserves an idempotent user recovery action; tool execution remains deferred to the stream endpoint. */
export function resolveRecoveryAction(
  request: RecoveryActionRequest,
  repository: AgentRunPersistence = agentRunEventRepository,
  invocations: RecoveryInvocationReader = toolInvocationRepository,
): RecoveryActionRecord {
  const run = recoverAgentRun(request.runId, repository);
  if (run.conversationId !== request.conversationId) {
    throw recoveryError('AgentRun does not belong to this conversation', 404);
  }
  if (run.recovery !== 'interrupted') {
    throw recoveryError('AgentRun is not recoverable', 409);
  }
  const recoverable = toRecoverableRun(run, invocations);
  const hasUnknownTool = recoverable.unknownTools.length > 0;
  if (request.action === 'retry' && run.toolCalls.length > 0 && !hasUnknownTool) {
    throw recoveryError(
      'Tool calls already have recorded results; continue from history instead of replaying the run',
      409,
    );
  }
  if (request.action === 'retry' && hasSucceededUnknownTool(recoverable.unknownTools)) {
    throw recoveryError(
      'Tool invocation Ledger already records success; continue to verify external state instead of retrying',
      409,
    );
  }
  if (
    request.action === 'retry' &&
    hasUnknownTool &&
    hasMissingArguments(recoverable.unknownTools)
  ) {
    throw recoveryError(
      'Original tool arguments are unavailable; retry is blocked until a new request supplies them',
      409,
    );
  }
  if (request.action === 'retry' && hasUnknownTool && request.confirmation !== true) {
    throw recoveryError('Retrying an unknown tool outcome requires confirmation', 409);
  }
  if (request.action !== 'abandon' && !run.originMessageId) {
    throw recoveryError('AgentRun has no recoverable message reference', 409);
  }
  return repository.reserveRecoveryAction({
    id: randomUUID(),
    originRunId: request.runId,
    conversationId: request.conversationId,
    action: request.action,
    idempotencyKey: request.idempotencyKey,
    ...(request.action === 'abandon' ? {} : { successorRunId: randomUUID() }),
  });
}

/** Claims one reserved action for stream execution; a second transport retry fails closed. */
export function claimRecoveryAction(
  actionId: string,
  repository: AgentRunPersistence = agentRunEventRepository,
): RecoveryActionRecord {
  const action = repository.getRecoveryAction(actionId);
  if (!action) throw recoveryError('AgentRun recovery action was not found', 404);
  if (action.action === 'abandon') throw recoveryError('Abandoned runs cannot be streamed', 409);
  return repository.claimRecoveryAction(actionId);
}

/** 在消费前校验恢复动作归属，避免错误会话先占用一次性动作。 */
export function claimRecoveryActionForConversation(
  actionId: string,
  conversationId: string,
  repository: AgentRunPersistence = agentRunEventRepository,
): RecoveryActionRecord {
  const action = repository.getRecoveryAction(actionId);
  if (!action || action.conversationId !== conversationId) {
    throw recoveryError('AgentRun recovery action was not found', 404);
  }
  return claimRecoveryAction(actionId, repository);
}

/** Marks a claimed recovery action settled after its successor run reaches a stream terminal state. */
export function completeRecoveryAction(
  actionId: string,
  repository: AgentRunPersistence = agentRunEventRepository,
): RecoveryActionRecord {
  return repository.completeRecoveryAction(actionId);
}

function toRecoverableRun(
  run: RecoveredAgentRun,
  invocations: RecoveryInvocationReader = toolInvocationRepository,
): RecoverableAgentRun {
  const unknownTools = run.toolCalls
    .filter((tool) => tool.status === 'tool_outcome_unknown')
    .map((tool) => {
      const invocation = invocations.get(run.runId, tool.callId);
      const ledgerStatus: ToolInvocationStatus | 'missing' = invocation?.status ?? 'missing';
      return {
        callId: tool.callId,
        toolName: tool.toolName,
        recoveryLevel: getToolRecoveryLevel(tool.toolName),
        ledgerStatus,
        argumentsAvailable: invocation?.argumentsAvailable ?? false,
      };
    });
  return {
    ...run,
    unknownTools,
    actions: getRecoveryActions(run, unknownTools),
  };
}

/** Returns the actions that cannot blindly replay an invocation recorded as successful. */
function getRecoveryActions(
  run: RecoveredAgentRun,
  unknownTools: RecoverableAgentRun['unknownTools'],
): RecoveryAction[] {
  if (run.toolCalls.length === 0) return ['continue', 'retry', 'abandon'];
  if (unknownTools.length === 0) return ['continue', 'abandon'];
  if (hasSucceededUnknownTool(unknownTools) || hasMissingArguments(unknownTools)) {
    return ['continue', 'abandon'];
  }
  return ['continue', 'retry', 'abandon'];
}

/** Checks whether any unfinished call must be protected from a user-confirmed retry. */
function hasSucceededUnknownTool(unknownTools: RecoverableAgentRun['unknownTools']): boolean {
  return unknownTools.some((tool) => tool.ledgerStatus === 'succeeded');
}

/** Checks whether at least one unfinished call cannot be replayed from stored arguments. */
function hasMissingArguments(unknownTools: RecoverableAgentRun['unknownTools']): boolean {
  return unknownTools.some((tool) => !tool.argumentsAvailable);
}

function getToolRecoveryLevel(toolName: string): ToolRecoveryLevel {
  const metadata = toolRegistry.get(toolName)?.getMetadata();
  if (!metadata) return 'never';
  if (metadata.requiresApproval || metadata.sideEffect !== 'none') {
    return 'requires_confirmation';
  }
  return 'never';
}

function recoveryError(message: string, status: number): Error {
  const error = new Error(message);
  Object.assign(error, { status });
  return error;
}

/**
 * 还原一次原始工具调用，并为它配对一条明确标记未知状态的合成结果。
 * @param runId 原始运行 ID。
 * @param callId 原始工具调用 ID。
 * @param toolName 恢复事件中记录的工具名称。
 * @param invocations 工具调用 Ledger 读取器。
 * @returns 符合模型接口格式的 assistant 工具调用及对应恢复结果。
 */
function restoreToolCall(
  runId: string,
  callId: string,
  toolName: string,
  invocations: RecoveryInvocationReader,
): { call: ToolCall; result: HistoryMessage } {
  const invocation = invocations.get(runId, callId);
  const originalArguments = readOriginalArguments(invocations, runId, callId);
  const call: ToolCall = {
    id: callId,
    type: 'function',
    function: { name: toolName, arguments: originalArguments ?? '{}' },
  };
  return {
    call,
    result: {
      role: 'tool',
      tool_call_id: callId,
      content: formatRecoveryResult(runId, callId, invocation, originalArguments !== undefined),
    },
  };
}

/**
 * 读取原始参数；密文损坏或不可用时返回空值，不中断恢复流程。
 * @param invocations 工具调用 Ledger 读取器。
 * @param runId 原始运行 ID。
 * @param callId 原始工具调用 ID。
 * @returns 可恢复时返回原始 JSON 字符串，否则返回 undefined。
 */
function readOriginalArguments(
  invocations: RecoveryInvocationReader,
  runId: string,
  callId: string,
): string | undefined {
  try {
    return invocations.getArguments(runId, callId);
  } catch {
    return undefined;
  }
}

/**
 * 将 Ledger 状态和安全恢复指引编码为合成工具结果。
 * @param runId 原始运行 ID。
 * @param callId 原始工具调用 ID。
 * @param invocation 可读取到的持久化调用元数据。
 * @param argumentsRestored 是否成功还原原始参数 JSON。
 * @returns 写入模型 tool-result 消息的 JSON 文本。
 */
function formatRecoveryResult(
  runId: string,
  callId: string,
  invocation: ToolInvocationRecord | undefined,
  argumentsRestored: boolean,
): string {
  const guidance = getRecoveryGuidance(invocation, argumentsRestored);
  return JSON.stringify({
    errorCode: 'OUTCOME_UNKNOWN',
    originalRunId: runId,
    originalCallId: callId,
    ledgerStatus: invocation?.status ?? 'missing',
    argumentsRestored,
    toolResultStored: false,
    externalStateVerified: false,
    guidance,
  });
}

/**
 * Selects guidance that accounts for a successful Ledger status and missing parameters.
 * @param invocation Durable invocation metadata, if present.
 * @param argumentsRestored Whether the original argument JSON was recovered.
 * @returns Instructions that never treat Ledger success as a substitute for external verification.
 */
function getRecoveryGuidance(
  invocation: ToolInvocationRecord | undefined,
  argumentsRestored: boolean,
): string {
  if (!argumentsRestored) {
    return 'The original arguments are unavailable; the empty arguments on this synthetic call are only a placeholder. Do not execute or retry it. Ask the user for the target details or verify the state using independent information.';
  }
  if (invocation?.status === 'succeeded') {
    return 'The tool invocation Ledger records this handler as succeeded, but its result was not attached to the conversation and external state is not verified. Do not invoke the same operation again. Use a read-only tool to verify the target state before deciding what to do next.';
  }
  return 'The original call is restored, but its result was not durably recorded. Do not replay blindly. Use a read-only tool or ask the user to verify the external state before deciding the next action.';
}
