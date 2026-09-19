/** Version of the media-neutral AgentRun persistence contract. */
export const AGENT_RUN_EVENT_SCHEMA_VERSION = 1;

/** The deliberately small, non-sensitive event vocabulary used for recovery. */
export type PersistedAgentRunEvent =
  | {
      type: 'run_started';
      runId: string;
      conversationId?: string;
      originMessageId?: string;
      agentId?: string;
      executionMode?: 'react' | 'stream';
    }
  | { type: 'round_started'; runId: string; round: number }
  | { type: 'tool_call_started'; runId: string; callId: string; toolName: string; round: number }
  | {
      type: 'tool_call_finished';
      runId: string;
      callId: string;
      toolName?: string;
      status: 'success' | 'failed' | 'cancelled';
    }
  | { type: 'approval_required'; runId: string; callId: string; approvalId?: string }
  | { type: 'run_terminal'; runId: string; outcome: 'completed' | 'failed' | 'cancelled' };

export interface AgentRunEventInput {
  sequence: number;
  event: PersistedAgentRunEvent;
  schemaVersion?: number;
  createdAt?: string;
}

export interface AgentRunEventRecord {
  runId: string;
  sequence: number;
  schemaVersion: number;
  event: PersistedAgentRunEvent;
  createdAt: string;
}

/** Minimum durable operations used by AgentRun and recovery domain services. */
export interface AgentRunPersistence {
  append(input: AgentRunEventInput): AgentRunEventRecord;
  read(runId: string): AgentRunEventRecord[];
  listOpenRuns(): string[];
  reserveRecoveryAction(input: RecoveryActionInput): RecoveryActionRecord;
  claimRecoveryAction(actionId: string): RecoveryActionRecord;
  completeRecoveryAction(actionId: string): RecoveryActionRecord;
  getRecoveryAction(actionId: string): RecoveryActionRecord | undefined;
  getRecoveryActionForOrigin(originRunId: string): RecoveryActionRecord | undefined;
}

/** Compatibility name for dependencies that only append lifecycle facts. */
export type AgentRunEventWriter = Pick<AgentRunPersistence, 'append'>;

export type RecoveryAction = 'continue' | 'retry' | 'abandon';
export type RecoveryActionStatus = 'reserved' | 'started' | 'completed';

export interface RecoveryActionInput {
  id: string;
  originRunId: string;
  conversationId: string;
  action: RecoveryAction;
  idempotencyKey: string;
  successorRunId?: string;
  createdAt?: string;
}

export interface RecoveryActionRecord extends RecoveryActionInput {
  status: RecoveryActionStatus;
  completedAt?: string;
}
