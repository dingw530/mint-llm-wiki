import { randomUUID } from 'node:crypto';
import type { AgentRunApproval, AgentRunPhase, AgentRunToolState } from './agentRun.js';
import {
  AGENT_RUN_EVENT_SCHEMA_VERSION,
  agentRunEventRepository,
} from '../repositories/agentRunEventRepository.js';
import { toolRegistry } from './tools/index.js';
import type {
  AgentRunEventRecord,
  AgentRunPersistence,
  RecoveryAction,
  RecoveryActionRecord,
} from './agentRunPersistence.js';

export interface RecoveredAgentRun {
  runId: string;
  conversationId?: string;
  originMessageId?: string;
  agentId?: string;
  executionMode?: 'react' | 'stream';
  phase: AgentRunPhase;
  sequence: number;
  round: number;
  toolCalls: AgentRunToolState[];
  terminal: boolean;
  approval?: AgentRunApproval;
  recovery: 'clean' | 'interrupted' | 'corrupt';
  unknownToolCalls: string[];
}

interface RecoveryState extends RecoveredAgentRun {
  started: boolean;
  finishedToolCalls: Set<string>;
}

export type ToolRecoveryLevel = 'never' | 'requires_confirmation' | 'safe_idempotent';

export interface RecoverableAgentRun extends RecoveredAgentRun {
  unknownTools: Array<{ callId: string; toolName: string; recoveryLevel: ToolRecoveryLevel }>;
  actions: RecoveryAction[];
}

export interface RecoveryActionRequest {
  conversationId: string;
  runId: string;
  action: RecoveryAction;
  idempotencyKey: string;
  confirmation?: boolean;
}

/** Rebuilds a run from durable events without invoking a model, tool, or database write. */
export function reduceAgentRunEvents(events: readonly AgentRunEventRecord[]): RecoveredAgentRun {
  if (events.length === 0) throw new Error('Cannot recover AgentRun from an empty event log');
  const first = events[0];
  const state: RecoveryState = {
    runId: first.runId,
    phase: 'running',
    sequence: 0,
    round: 0,
    toolCalls: [],
    terminal: false,
    recovery: 'clean',
    unknownToolCalls: [],
    started: false,
    finishedToolCalls: new Set(),
  };

  events.forEach((record, index) => {
    if (record.schemaVersion !== AGENT_RUN_EVENT_SCHEMA_VERSION) {
      throw new Error(`Unsupported AgentRun event schema version: ${record.schemaVersion}`);
    }
    if (record.runId !== state.runId || record.sequence !== index + 1) {
      throw new Error(`Invalid AgentRun event sequence at ${record.runId}#${record.sequence}`);
    }
    if (state.terminal)
      throw new Error(
        `AgentRun event appears after terminal state: ${record.runId}#${record.sequence}`,
      );
    applyEvent(state, record.event);
    state.sequence = record.sequence;
  });

  if (!state.started) throw new Error(`AgentRun ${state.runId} is missing run_started`);
  if (!state.terminal) {
    state.recovery = 'interrupted';
    state.toolCalls.forEach((tool) => {
      if (state.finishedToolCalls.has(tool.callId)) return;
      tool.status = 'tool_outcome_unknown';
      state.unknownToolCalls.push(tool.callId);
    });
  }
  return copyRecoveredState(state);
}

/** Reads one run and reduces it; kept separate so the reducer remains a pure function. */
export function recoverAgentRun(
  runId: string,
  repository: AgentRunPersistence = agentRunEventRepository,
): RecoveredAgentRun {
  return reduceAgentRunEvents(repository.read(runId));
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
): RecoverableAgentRun[] {
  return recoverOpenAgentRuns(repository)
    .filter((run) => run.conversationId === conversationId)
    .filter((run) => {
      const action = repository.getRecoveryActionForOrigin(run.runId);
      return action === undefined || action.status === 'reserved';
    })
    .map(toRecoverableRun);
}

/** Reserves an idempotent user recovery action; tool execution remains deferred to the stream endpoint. */
export function resolveRecoveryAction(
  request: RecoveryActionRequest,
  repository: AgentRunPersistence = agentRunEventRepository,
): RecoveryActionRecord {
  const run = recoverAgentRun(request.runId, repository);
  if (run.conversationId !== request.conversationId) {
    throw recoveryError('AgentRun does not belong to this conversation', 404);
  }
  if (run.recovery !== 'interrupted') {
    throw recoveryError('AgentRun is not recoverable', 409);
  }
  const recoverable = toRecoverableRun(run);
  const hasUnknownTool = recoverable.unknownTools.length > 0;
  if (request.action === 'continue' && run.toolCalls.length > 0) {
    throw recoveryError('Cannot continue a run that has tool history', 409);
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

/** Marks a claimed recovery action settled after its successor run reaches a stream terminal state. */
export function completeRecoveryAction(
  actionId: string,
  repository: AgentRunPersistence = agentRunEventRepository,
): RecoveryActionRecord {
  return repository.completeRecoveryAction(actionId);
}

function applyEvent(state: RecoveryState, event: AgentRunEventRecord['event']): void {
  switch (event.type) {
    case 'run_started':
      if (state.started) throw new Error(`Duplicate run_started for ${state.runId}`);
      state.started = true;
      state.conversationId = event.conversationId;
      state.originMessageId = event.originMessageId;
      state.agentId = event.agentId;
      state.executionMode = event.executionMode;
      return;
    case 'round_started':
      requireStarted(state);
      requirePositiveRound(event.round);
      state.round = Math.max(state.round, event.round);
      return;
    case 'tool_call_started':
      requireStarted(state);
      requirePositiveRound(event.round);
      if (state.toolCalls.some((tool) => tool.callId === event.callId))
        throw new Error(`Duplicate tool call: ${event.callId}`);
      state.round = Math.max(state.round, event.round);
      state.toolCalls.push({ callId: event.callId, toolName: event.toolName, status: 'running' });
      return;
    case 'approval_required': {
      requireStarted(state);
      const tool = findTool(state, event.callId);
      if (state.finishedToolCalls.has(event.callId))
        throw new Error(`Approval follows finished tool: ${event.callId}`);
      tool.status = 'approval_required';
      state.phase = 'paused_for_approval';
      state.approval = {
        approvalId: event.approvalId,
        callId: event.callId,
        toolName: tool.toolName,
        reason: 'approval required',
      };
      return;
    }
    case 'tool_call_finished': {
      requireStarted(state);
      const tool = findTool(state, event.callId);
      if (state.finishedToolCalls.has(event.callId))
        throw new Error(`Duplicate tool completion: ${event.callId}`);
      if (event.toolName && event.toolName !== tool.toolName)
        throw new Error(`Tool name mismatch for ${event.callId}`);
      tool.status = event.status === 'success' ? 'success' : 'failed';
      state.finishedToolCalls.add(event.callId);
      if (state.approval?.callId === event.callId) state.approval = undefined;
      if (!state.terminal) state.phase = 'running';
      return;
    }
    case 'run_terminal':
      requireStarted(state);
      state.terminal = true;
      state.approval = undefined;
      state.phase = event.outcome;
      return;
    default:
      throw new Error(`Unknown required AgentRun event type: ${(event as { type: string }).type}`);
  }
}

function toRecoverableRun(run: RecoveredAgentRun): RecoverableAgentRun {
  const unknownTools = run.toolCalls
    .filter((tool) => tool.status === 'tool_outcome_unknown')
    .map((tool) => ({
      callId: tool.callId,
      toolName: tool.toolName,
      recoveryLevel: getToolRecoveryLevel(tool.toolName),
    }));
  return {
    ...run,
    unknownTools,
    actions:
      unknownTools.length === 0 && run.toolCalls.length === 0
        ? ['continue', 'retry', 'abandon']
        : ['retry', 'abandon'],
  };
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

function requireStarted(state: RecoveryState): void {
  if (!state.started) throw new Error(`AgentRun event precedes run_started: ${state.runId}`);
}

function requirePositiveRound(round: number): void {
  if (!Number.isSafeInteger(round) || round < 1)
    throw new Error(`Invalid AgentRun round: ${round}`);
}

function findTool(state: RecoveryState, callId: string): AgentRunToolState {
  const tool = state.toolCalls.find((candidate) => candidate.callId === callId);
  if (!tool) throw new Error(`Unknown tool call: ${callId}`);
  return tool;
}

function copyRecoveredState(state: RecoveryState): RecoveredAgentRun {
  return {
    runId: state.runId,
    ...(state.conversationId ? { conversationId: state.conversationId } : {}),
    ...(state.originMessageId ? { originMessageId: state.originMessageId } : {}),
    ...(state.agentId ? { agentId: state.agentId } : {}),
    ...(state.executionMode ? { executionMode: state.executionMode } : {}),
    phase: state.phase,
    sequence: state.sequence,
    round: state.round,
    toolCalls: state.toolCalls.map((tool) => ({ ...tool })),
    terminal: state.terminal,
    ...(state.approval ? { approval: { ...state.approval } } : {}),
    recovery: state.recovery,
    unknownToolCalls: [...state.unknownToolCalls],
  };
}
