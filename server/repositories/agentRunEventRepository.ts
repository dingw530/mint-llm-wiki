import { getDb } from '../db.js';
import type Database from 'better-sqlite3';
import {
  AGENT_RUN_EVENT_SCHEMA_VERSION,
  type AgentRunEventInput,
  type AgentRunEventRecord,
  type AgentRunPersistence,
  type PersistedAgentRunEvent,
  type RecoveryActionInput,
  type RecoveryActionRecord,
} from '../agentRunPersistence.js';

export {
  AGENT_RUN_EVENT_SCHEMA_VERSION,
  type AgentRunEventInput,
  type AgentRunEventRecord,
  type AgentRunEventWriter,
  type PersistedAgentRunEvent,
  type RecoveryAction,
  type RecoveryActionInput,
  type RecoveryActionRecord,
} from '../agentRunPersistence.js';

interface AgentRunEventRow {
  run_id: string;
  sequence: number;
  schema_version: number;
  event_type: string;
  payload_json: string;
  created_at: string;
}

interface RecoveryActionRow {
  action_id: string;
  origin_run_id: string;
  conversation_id: string;
  action: string;
  idempotency_key: string;
  status: string;
  successor_run_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export class AgentRunEventRepository implements AgentRunPersistence {
  private readonly database?: Database.Database;

  constructor(database?: Database.Database) {
    this.database = database;
  }

  /** Appends one event atomically, enforcing ordering, terminal, and idempotency rules. */
  append(input: AgentRunEventInput): AgentRunEventRecord {
    const event = sanitizeEvent(input.event);
    validateInput(input, event);
    const schemaVersion = input.schemaVersion ?? AGENT_RUN_EVENT_SCHEMA_VERSION;
    if (schemaVersion !== AGENT_RUN_EVENT_SCHEMA_VERSION) {
      throw new Error(`Unsupported AgentRun event schema version: ${schemaVersion}`);
    }
    const createdAt = input.createdAt ?? new Date().toISOString();
    const db = this.getDatabase();
    const append = db.transaction(() => {
      const existing = db
        .prepare('SELECT * FROM agent_run_events WHERE run_id = ? AND sequence = ?')
        .get(event.runId, input.sequence) as AgentRunEventRow | undefined;
      if (existing) {
        const existingEvent = decodeRow(existing);
        if (
          existing.schema_version === schemaVersion &&
          existing.event_type === event.type &&
          existing.payload_json === JSON.stringify(toPayload(event))
        )
          return existingEvent;
        throw new Error(`Conflicting AgentRun event at ${event.runId}#${input.sequence}`);
      }

      const last = db
        .prepare('SELECT * FROM agent_run_events WHERE run_id = ? ORDER BY sequence DESC LIMIT 1')
        .get(event.runId) as AgentRunEventRow | undefined;
      if (last) {
        if (last.event_type === 'run_terminal') {
          throw new Error(`Cannot append AgentRun event after terminal state: ${event.runId}`);
        }
        if (input.sequence !== last.sequence + 1) {
          throw new Error(
            `AgentRun event sequence must be ${last.sequence + 1}, received ${input.sequence}`,
          );
        }
      } else if (input.sequence !== 1) {
        throw new Error(`AgentRun event sequence must start at 1, received ${input.sequence}`);
      } else if (event.type !== 'run_started') {
        throw new Error(`AgentRun must start with run_started, received ${event.type}`);
      }

      db.prepare(
        `
        INSERT INTO agent_run_events
          (run_id, sequence, schema_version, event_type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(
        event.runId,
        input.sequence,
        schemaVersion,
        event.type,
        JSON.stringify(toPayload(event)),
        createdAt,
      );
      return {
        runId: event.runId,
        sequence: input.sequence,
        schemaVersion,
        event,
        createdAt,
      };
    });
    return append();
  }

  /** Reads an immutable, sequence-ordered event log and fails on malformed JSON. */
  read(runId: string): AgentRunEventRecord[] {
    const rows = this.getDatabase()
      .prepare('SELECT * FROM agent_run_events WHERE run_id = ? ORDER BY sequence ASC')
      .all(runId) as AgentRunEventRow[];
    return rows.map(decodeRow);
  }

  /** Lists runs whose latest durable event is not terminal. */
  listOpenRuns(): string[] {
    const rows = this.getDatabase()
      .prepare(
        `
      SELECT run_id
      FROM agent_run_events
      GROUP BY run_id
      HAVING MAX(sequence) FILTER (WHERE event_type = 'run_terminal') IS NULL
      ORDER BY run_id ASC
    `,
      )
      .all() as Array<{ run_id: string }>;
    return rows.map((row) => row.run_id);
  }

  /** Reserves one recovery action, returning an existing unstarted reservation after a client restart. */
  reserveRecoveryAction(input: RecoveryActionInput): RecoveryActionRecord {
    validateRecoveryAction(input);
    const db = this.getDatabase();
    return db.transaction(() => {
      const existing = db
        .prepare(
          `
        SELECT * FROM agent_run_recovery_actions
        WHERE origin_run_id = ? AND action = ? AND idempotency_key = ?
      `,
        )
        .get(input.originRunId, input.action, input.idempotencyKey) as
        RecoveryActionRow | undefined;
      if (existing) return decodeRecoveryAction(existing);

      const resolved = db
        .prepare(
          `
        SELECT * FROM agent_run_recovery_actions
        WHERE origin_run_id = ?
      `,
        )
        .get(input.originRunId) as RecoveryActionRow | undefined;
      if (resolved?.status === 'reserved') return decodeRecoveryAction(resolved);
      if (resolved) {
        throw new Error(`AgentRun recovery is already resolved: ${input.originRunId}`);
      }

      const createdAt = input.createdAt ?? new Date().toISOString();
      db.prepare(
        `
        INSERT INTO agent_run_recovery_actions
          (action_id, origin_run_id, conversation_id, action, idempotency_key, status, successor_run_id, created_at)
        VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?)
      `,
      ).run(
        input.id,
        input.originRunId,
        input.conversationId,
        input.action,
        input.idempotencyKey,
        input.successorRunId ?? null,
        createdAt,
      );
      return createReservedRecoveryAction(input, createdAt);
    })();
  }

  /** Marks a reserved action complete once its successor stream has durable ownership. */
  claimRecoveryAction(actionId: string): RecoveryActionRecord {
    const db = this.getDatabase();
    return db.transaction(() => {
      const row = db
        .prepare('SELECT * FROM agent_run_recovery_actions WHERE action_id = ?')
        .get(actionId) as RecoveryActionRow | undefined;
      if (!row) throw new Error(`AgentRun recovery action not found: ${actionId}`);
      if (row.status !== 'reserved') {
        throw new Error(`AgentRun recovery action is already claimed: ${actionId}`);
      }
      db.prepare(
        "UPDATE agent_run_recovery_actions SET status = 'started' WHERE action_id = ?",
      ).run(actionId);
      return decodeRecoveryAction({ ...row, status: 'started' });
    })();
  }

  /** Marks a claimed recovery action as settled after its successor stream finishes. */
  completeRecoveryAction(actionId: string): RecoveryActionRecord {
    const db = this.getDatabase();
    return db.transaction(() => {
      const row = db
        .prepare('SELECT * FROM agent_run_recovery_actions WHERE action_id = ?')
        .get(actionId) as RecoveryActionRow | undefined;
      if (!row) throw new Error(`AgentRun recovery action not found: ${actionId}`);
      if (row.status === 'completed') return decodeRecoveryAction(row);
      if (row.status !== 'started' && row.action !== 'abandon') {
        throw new Error(`AgentRun recovery action has not started: ${actionId}`);
      }
      const completedAt = new Date().toISOString();
      db.prepare(
        `
        UPDATE agent_run_recovery_actions
        SET status = 'completed', completed_at = ?
        WHERE action_id = ?
      `,
      ).run(completedAt, actionId);
      return decodeRecoveryAction({ ...row, status: 'completed', completed_at: completedAt });
    })();
  }

  /** Reads an action by stable ID without changing recovery state. */
  getRecoveryAction(actionId: string): RecoveryActionRecord | undefined {
    const row = this.getDatabase()
      .prepare('SELECT * FROM agent_run_recovery_actions WHERE action_id = ?')
      .get(actionId) as RecoveryActionRow | undefined;
    return row ? decodeRecoveryAction(row) : undefined;
  }

  /** Reads the single recovery decision associated with an origin run. */
  getRecoveryActionForOrigin(originRunId: string): RecoveryActionRecord | undefined {
    const row = this.getDatabase()
      .prepare('SELECT * FROM agent_run_recovery_actions WHERE origin_run_id = ?')
      .get(originRunId) as RecoveryActionRow | undefined;
    return row ? decodeRecoveryAction(row) : undefined;
  }

  private getDatabase(): Database.Database {
    return this.database ?? getDb();
  }
}

function validateRecoveryAction(input: RecoveryActionInput): void {
  requireText(input.id, 'action id');
  requireText(input.originRunId, 'origin run id');
  requireText(input.conversationId, 'conversation id');
  requireText(input.idempotencyKey, 'idempotency key');
  if (!['continue', 'retry', 'abandon'].includes(input.action)) {
    throw new Error(`Invalid AgentRun recovery action: ${input.action}`);
  }
  if (input.action === 'abandon' && input.successorRunId) {
    throw new Error('Abandon recovery action cannot have a successor run');
  }
  if (input.action !== 'abandon' && !input.successorRunId) {
    throw new Error('Continue and retry recovery actions require a successor run');
  }
}

function createReservedRecoveryAction(
  input: RecoveryActionInput,
  createdAt: string,
): RecoveryActionRecord {
  return {
    id: input.id,
    originRunId: input.originRunId,
    conversationId: input.conversationId,
    action: input.action,
    idempotencyKey: input.idempotencyKey,
    ...(input.successorRunId ? { successorRunId: input.successorRunId } : {}),
    createdAt,
    status: 'reserved',
  };
}

function decodeRecoveryAction(row: RecoveryActionRow): RecoveryActionRecord {
  const action = parseRecoveryAction(row.action, row.action_id);
  const status = parseRecoveryActionStatus(row.status, row.action_id);
  return {
    id: row.action_id,
    originRunId: row.origin_run_id,
    conversationId: row.conversation_id,
    action,
    idempotencyKey: row.idempotency_key,
    ...(row.successor_run_id ? { successorRunId: row.successor_run_id } : {}),
    createdAt: row.created_at,
    status,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function parseRecoveryAction(value: string, actionId: string): RecoveryActionRecord['action'] {
  if (value === 'continue' || value === 'retry' || value === 'abandon') return value;
  throw new Error(`Corrupt AgentRun recovery action: ${actionId}`);
}

function parseRecoveryActionStatus(
  value: string,
  actionId: string,
): RecoveryActionRecord['status'] {
  if (value === 'reserved' || value === 'started' || value === 'completed') return value;
  throw new Error(`Corrupt AgentRun recovery action status: ${actionId}`);
}

export const agentRunEventRepository = new AgentRunEventRepository();

function validateInput(input: AgentRunEventInput, event: PersistedAgentRunEvent): void {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new Error(`Invalid AgentRun event sequence: ${input.sequence}`);
  }
  if (!event.runId || !event.runId.trim()) throw new Error('AgentRun event runId is required');
  if (event.type === 'round_started' || event.type === 'tool_call_started') {
    if (!Number.isSafeInteger(event.round) || event.round < 1)
      throw new Error('AgentRun event round is invalid');
  }
}

/** Copies only the recovery-safe fields, dropping arguments, results, and accidental secrets. */
function sanitizeEvent(event: PersistedAgentRunEvent): PersistedAgentRunEvent {
  switch (event.type) {
    case 'run_started': {
      requireText(event.runId, 'runId');
      return {
        type: event.type,
        runId: event.runId,
        ...(event.conversationId ? { conversationId: event.conversationId } : {}),
        ...(event.originMessageId ? { originMessageId: event.originMessageId } : {}),
        ...(event.agentId ? { agentId: event.agentId } : {}),
        ...(event.executionMode ? { executionMode: event.executionMode } : {}),
      };
    }
    case 'round_started':
      requireText(event.runId, 'runId');
      return { type: event.type, runId: event.runId, round: event.round };
    case 'tool_call_started':
      requireText(event.runId, 'runId');
      requireText(event.callId, 'callId');
      requireText(event.toolName, 'toolName');
      return {
        type: event.type,
        runId: event.runId,
        callId: event.callId,
        toolName: event.toolName,
        round: event.round,
      };
    case 'tool_call_finished':
      requireText(event.runId, 'runId');
      requireText(event.callId, 'callId');
      if (!['success', 'failed', 'cancelled'].includes(event.status))
        throw new Error(`Invalid tool outcome: ${String(event.status)}`);
      return {
        type: event.type,
        runId: event.runId,
        callId: event.callId,
        ...(event.toolName ? { toolName: event.toolName } : {}),
        status: event.status,
      };
    case 'approval_required':
      requireText(event.runId, 'runId');
      requireText(event.callId, 'callId');
      return {
        type: event.type,
        runId: event.runId,
        callId: event.callId,
        ...(event.approvalId ? { approvalId: event.approvalId } : {}),
      };
    case 'run_terminal':
      requireText(event.runId, 'runId');
      if (!['completed', 'failed', 'cancelled'].includes(event.outcome))
        throw new Error(`Invalid AgentRun outcome: ${String(event.outcome)}`);
      return { type: event.type, runId: event.runId, outcome: event.outcome };
    default:
      return assertNever(event);
  }
}

function requireText(value: string, field: string): void {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`AgentRun event ${field} is required`);
}

function toPayload(event: PersistedAgentRunEvent): Omit<PersistedAgentRunEvent, 'runId'> {
  const { runId: _runId, ...payload } = event;
  return payload;
}

function decodeRow(row: AgentRunEventRow): AgentRunEventRecord {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch (error) {
    throw new Error(`Corrupt AgentRun event JSON at ${row.run_id}#${row.sequence}`, {
      cause: error,
    });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Corrupt AgentRun event payload at ${row.run_id}#${row.sequence}`);
  }
  const decoded = { runId: row.run_id, type: row.event_type, ...payload } as PersistedAgentRunEvent;
  if (decoded.type !== row.event_type || decoded.runId !== row.run_id) {
    throw new Error(`Corrupt AgentRun event identity at ${row.run_id}#${row.sequence}`);
  }
  const event = sanitizeEvent(decoded);
  return {
    runId: row.run_id,
    sequence: row.sequence,
    schemaVersion: row.schema_version,
    event,
    createdAt: row.created_at,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported AgentRun event type: ${String(value)}`);
}
