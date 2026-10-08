import { getDb } from '../../db.js';
import type Database from 'better-sqlite3';
import type { RetrySafety, ToolErrorCode } from '../../agent-runtime/tooling/tool-contracts.js';

export type ToolInvocationStatus = 'executing' | 'succeeded' | 'failed' | 'outcome_unknown';

export interface ToolInvocationInput {
  runId: string;
  callId: string;
  invocationId: string;
  toolName: string;
  inputHash: string;
  retrySafety: RetrySafety;
  now?: string;
}

export interface ToolInvocationRecord extends Omit<ToolInvocationInput, 'now'> {
  status: ToolInvocationStatus;
  attempt: number;
  retryable: boolean;
  errorCode?: ToolErrorCode;
  startedAt: string;
  updatedAt: string;
}

export type ToolInvocationClaim =
  | { allowed: true; attempt: number }
  | {
      allowed: false;
      errorCode:
        'INVOCATION_CONFLICT' | 'INVOCATION_ALREADY_COMPLETED' | 'OUTCOME_UNKNOWN' | 'TOOL_FAILED';
      message: string;
    };

export interface ToolInvocationFinish {
  runId: string;
  callId: string;
  status: Exclude<ToolInvocationStatus, 'executing'>;
  retryable: boolean;
  errorCode?: ToolErrorCode;
  now?: string;
}

interface InvocationRow {
  run_id: string;
  call_id: string;
  invocation_id: string;
  tool_name: string;
  input_hash: string;
  retry_safety: RetrySafety;
  status: ToolInvocationStatus;
  attempt: number;
  retryable: number;
  error_code: string | null;
  started_at: string;
  updated_at: string;
}

/** Persists the at-most-once boundary for one AgentRun tool-call identity. */
export class ToolInvocationRepository {
  private recoveryChecked = false;

  constructor(private readonly database?: Database.Database) {}

  /** Claims a call identity or allows a retry after a known retryable failure. */
  begin(input: ToolInvocationInput): ToolInvocationClaim {
    validateInvocationInput(input);
    this.ensureRecoveryChecked();
    const db = this.getDatabase();
    const now = input.now ?? new Date().toISOString();
    return db
      .transaction((): ToolInvocationClaim => {
        const current = db
          .prepare('SELECT * FROM agent_tool_invocations WHERE run_id = ? AND call_id = ?')
          .get(input.runId, input.callId) as InvocationRow | undefined;

        if (!current) {
          db.prepare(
            `INSERT INTO agent_tool_invocations
            (run_id, call_id, invocation_id, tool_name, input_hash, retry_safety, status,
             attempt, retryable, error_code, started_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'executing', 1, 0, NULL, ?, ?)`,
          ).run(
            input.runId,
            input.callId,
            input.invocationId,
            input.toolName,
            input.inputHash,
            input.retrySafety,
            now,
            now,
          );
          return { allowed: true, attempt: 1 };
        }

        if (
          current.invocation_id !== input.invocationId ||
          current.tool_name !== input.toolName ||
          current.input_hash !== input.inputHash
        ) {
          return {
            allowed: false,
            errorCode: 'INVOCATION_CONFLICT',
            message: 'Tool call identity was reused with different input',
          };
        }

        if (
          current.status === 'failed' &&
          current.retryable === 1 &&
          current.retry_safety === input.retrySafety &&
          input.retrySafety !== 'never'
        ) {
          const attempt = current.attempt + 1;
          db.prepare(
            `UPDATE agent_tool_invocations
           SET status = 'executing', attempt = ?, retryable = 0, error_code = NULL, updated_at = ?
           WHERE run_id = ? AND call_id = ?`,
          ).run(attempt, now, input.runId, input.callId);
          return { allowed: true, attempt };
        }

        if (current.status === 'executing') {
          db.prepare(
            `UPDATE agent_tool_invocations
           SET status = 'outcome_unknown', error_code = 'OUTCOME_UNKNOWN', updated_at = ?
           WHERE run_id = ? AND call_id = ? AND status = 'executing'`,
          ).run(now, input.runId, input.callId);
        }

        if (current.status === 'succeeded') {
          return {
            allowed: false,
            errorCode: 'INVOCATION_ALREADY_COMPLETED',
            message: 'This tool call already completed and will not be replayed',
          };
        }
        if (current.status === 'executing' || current.status === 'outcome_unknown') {
          return {
            allowed: false,
            errorCode: 'OUTCOME_UNKNOWN',
            message:
              'The previous tool attempt may have completed; verify its outcome before retrying',
          };
        }
        return {
          allowed: false,
          errorCode: 'TOOL_FAILED',
          message: 'The previous tool attempt failed and is not safe to retry',
        };
      })
      .immediate();
  }

  /** Records the known or unknown result without storing the raw tool input or output. */
  finish(input: ToolInvocationFinish): void {
    const now = input.now ?? new Date().toISOString();
    const result = this.getDatabase()
      .prepare(
        `UPDATE agent_tool_invocations
         SET status = ?, retryable = ?, error_code = ?, updated_at = ?
         WHERE run_id = ? AND call_id = ? AND status IN ('executing', 'outcome_unknown')`,
      )
      .run(
        input.status,
        input.retryable ? 1 : 0,
        input.errorCode ?? null,
        now,
        input.runId,
        input.callId,
      );
    if (result.changes !== 1) {
      throw new Error(
        `Tool invocation state is missing or terminal: ${input.runId}/${input.callId}`,
      );
    }
  }

  /** Converts unfinished calls left by a prior process into a durable unknown outcome. */
  markInterruptedUnknown(now = new Date().toISOString()): number {
    const result = this.getDatabase()
      .prepare(
        `UPDATE agent_tool_invocations
         SET status = 'outcome_unknown', retryable = 0, error_code = 'OUTCOME_UNKNOWN', updated_at = ?
         WHERE status = 'executing'`,
      )
      .run(now);
    this.recoveryChecked = true;
    return result.changes;
  }

  /** Reads one invocation for tests and recovery diagnostics. */
  get(runId: string, callId: string): ToolInvocationRecord | undefined {
    const row = this.getDatabase()
      .prepare('SELECT * FROM agent_tool_invocations WHERE run_id = ? AND call_id = ?')
      .get(runId, callId) as InvocationRow | undefined;
    return row ? decodeInvocation(row) : undefined;
  }

  private getDatabase(): Database.Database {
    return this.database ?? getDb();
  }

  /** Recovers prior-process calls before allowing the first new invocation. */
  private ensureRecoveryChecked(): void {
    if (this.recoveryChecked) return;
    this.markInterruptedUnknown();
  }
}

/** Process singleton used by the ToolExecutionService composition root. */
export const toolInvocationRepository = new ToolInvocationRepository();

function validateInvocationInput(input: ToolInvocationInput): void {
  for (const [key, value] of Object.entries({
    runId: input.runId,
    callId: input.callId,
    invocationId: input.invocationId,
    toolName: input.toolName,
    inputHash: input.inputHash,
  })) {
    if (!value.trim()) throw new Error(`${key} must not be empty`);
  }
}

function decodeInvocation(row: InvocationRow): ToolInvocationRecord {
  return {
    runId: row.run_id,
    callId: row.call_id,
    invocationId: row.invocation_id,
    toolName: row.tool_name,
    inputHash: row.input_hash,
    retrySafety: row.retry_safety,
    status: row.status,
    attempt: row.attempt,
    retryable: row.retryable === 1,
    ...(isToolErrorCode(row.error_code) ? { errorCode: row.error_code } : {}),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
}

function isToolErrorCode(value: string | null): value is ToolErrorCode {
  return (
    value === 'UNKNOWN_TOOL' ||
    value === 'TOOL_DISABLED' ||
    value === 'INVALID_TOOL_INPUT' ||
    value === 'PERMISSION_DENIED' ||
    value === 'APPROVAL_REQUIRED' ||
    value === 'POLICY_DENIED' ||
    value === 'TIMEOUT' ||
    value === 'CANCELLED' ||
    value === 'TOOL_FAILED' ||
    value === 'OUTCOME_UNKNOWN' ||
    value === 'INVOCATION_CONFLICT' ||
    value === 'INVOCATION_ALREADY_COMPLETED' ||
    value === 'INVOCATION_STATE_UNAVAILABLE'
  );
}
