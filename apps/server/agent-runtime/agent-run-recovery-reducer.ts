import type { AgentRunApproval, AgentRunPhase, AgentRunToolState } from './agent-run.js';
import {
  AGENT_RUN_EVENT_SCHEMA_VERSION,
  type AgentRunEventRecord,
} from './agent-run-persistence.js';

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
