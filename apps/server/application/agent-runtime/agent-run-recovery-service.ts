import { randomUUID } from 'node:crypto';
import {
  reduceAgentRunEvents,
  type RecoveredAgentRun,
} from '../../agent-runtime/agent-run-recovery-reducer.js';
export { reduceAgentRunEvents } from '../../agent-runtime/agent-run-recovery-reducer.js';
import { agentRunEventRepository } from '../../infrastructure/persistence/agent-run-event-repository.js';
import { toolRegistry } from './tooling/tool-registry.js';
import type {
  AgentRunPersistence,
  RecoveryAction,
  RecoveryActionRecord,
} from '../../agent-runtime/agent-run-persistence.js';

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
