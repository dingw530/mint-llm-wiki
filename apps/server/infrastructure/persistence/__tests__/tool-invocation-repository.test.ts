import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../migrations/index.js';
import { ToolInvocationRepository } from '../tool-invocation-repository.js';

describe('ToolInvocationRepository', () => {
  let db: Database.Database;
  let repository: ToolInvocationRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const addMigration = db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)');
    for (let id = 1; id <= 32; id += 1) addMigration.run(id, `migration-${id}`);
    runMigrations(db);
    repository = new ToolInvocationRepository(db);
  });

  afterEach(() => db.close());

  const input = {
    runId: 'run-idempotency',
    callId: 'call-1',
    invocationId: 'invocation-hash',
    toolName: 'write_file',
    inputHash: 'input-hash',
    retrySafety: 'safe' as const,
  };

  it('claims an invocation once and blocks replay after success', () => {
    expect(repository.begin(input)).toEqual({ allowed: true, attempt: 1 });
    repository.finish({ ...input, status: 'succeeded', retryable: false });

    expect(repository.begin(input)).toMatchObject({
      allowed: false,
      errorCode: 'INVOCATION_ALREADY_COMPLETED',
    });
    expect(repository.get(input.runId, input.callId)).toMatchObject({ status: 'succeeded', attempt: 1 });
  });

  it('allows a new attempt only after a known retryable failure with matching input', () => {
    expect(repository.begin(input).allowed).toBe(true);
    repository.finish({
      runId: input.runId,
      callId: input.callId,
      status: 'failed',
      retryable: true,
      errorCode: 'TOOL_FAILED',
    });

    expect(repository.begin(input)).toEqual({ allowed: true, attempt: 2 });
    expect(repository.begin({ ...input, inputHash: 'different-input' })).toMatchObject({
      allowed: false,
      errorCode: 'INVOCATION_CONFLICT',
    });
  });

  it('persists unknown outcomes and does not replay them', () => {
    expect(repository.begin(input).allowed).toBe(true);
    expect(repository.markInterruptedUnknown('2026-10-08T00:00:00.000Z')).toBe(1);

    expect(repository.get(input.runId, input.callId)).toMatchObject({
      status: 'outcome_unknown',
      retryable: false,
      errorCode: 'OUTCOME_UNKNOWN',
    });
    expect(repository.begin(input)).toMatchObject({ allowed: false, errorCode: 'OUTCOME_UNKNOWN' });
  });
});
