import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../migrations/index.js';
import { AgentRunEventRepository } from '../../repositories/agentRunEventRepository.js';
import {
  listRecoverableRuns,
  recoverOpenAgentRuns,
  reduceAgentRunEvents,
  resolveRecoveryAction,
} from '../agentRunRecoveryService.js';

/**
 * Creates the current-schema prerequisites needed before the event migrations.
 * @param database The isolated test database.
 * @returns The database prepared for the recovery tests.
 */
function createMigrationFixture(database: Database.Database): Database.Database {
  database.exec(`
    CREATE TABLE messages (id TEXT PRIMARY KEY, reasoning TEXT);
    CREATE TABLE conversations (id TEXT PRIMARY KEY, locked_agent TEXT);
    CREATE TABLE agents (id TEXT PRIMARY KEY);
    CREATE TABLE mcp_servers (id TEXT PRIMARY KEY);
    CREATE TABLE memories (id TEXT PRIMARY KEY);
    CREATE TABLE model_endpoints (id TEXT PRIMARY KEY);
    CREATE TABLE _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const insertMigration = database.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)');
  for (let id = 1; id <= 27; id += 1) insertMigration.run(id, `migration-${id}`);
  return database;
}

function createRepository(): AgentRunEventRepository {
  const db = createMigrationFixture(new Database(':memory:'));
  runMigrations(db);
  return new AgentRunEventRepository(db);
}

describe('agentRunRecoveryService', () => {
  it('rebuilds a completed run without replaying anything', () => {
    const repository = createRepository();
    repository.append({
      sequence: 1,
      event: { type: 'run_started', runId: 'run-1', conversationId: 'c-1' },
    });
    repository.append({ sequence: 2, event: { type: 'round_started', runId: 'run-1', round: 1 } });
    repository.append({
      sequence: 3,
      event: {
        type: 'tool_call_started',
        runId: 'run-1',
        callId: 'call-1',
        toolName: 'bash',
        round: 1,
      },
    });
    repository.append({
      sequence: 4,
      event: { type: 'tool_call_finished', runId: 'run-1', callId: 'call-1', status: 'success' },
    });
    repository.append({
      sequence: 5,
      event: { type: 'run_terminal', runId: 'run-1', outcome: 'completed' },
    });

    const recovered = reduceAgentRunEvents(repository.read('run-1'));
    expect(recovered).toMatchObject({
      runId: 'run-1',
      phase: 'completed',
      sequence: 5,
      round: 1,
      terminal: true,
      recovery: 'clean',
      unknownToolCalls: [],
    });
    expect(recovered.toolCalls).toEqual([
      { callId: 'call-1', toolName: 'bash', status: 'success' },
    ]);
  });

  it('marks unfinished tools unknown after interruption and does not execute them', () => {
    const repository = createRepository();
    repository.append({ sequence: 1, event: { type: 'run_started', runId: 'run-2' } });
    repository.append({
      sequence: 2,
      event: {
        type: 'tool_call_started',
        runId: 'run-2',
        callId: 'call-2',
        toolName: 'write_file',
        round: 1,
      },
    });
    repository.append({
      sequence: 3,
      event: {
        type: 'approval_required',
        runId: 'run-2',
        callId: 'call-2',
        approvalId: 'approval-2',
      },
    });

    const [recovered] = recoverOpenAgentRuns(repository);
    expect(recovered).toMatchObject({
      phase: 'paused_for_approval',
      recovery: 'interrupted',
      unknownToolCalls: ['call-2'],
    });
    expect(recovered.toolCalls[0]).toMatchObject({
      callId: 'call-2',
      status: 'tool_outcome_unknown',
    });
    expect(recovered.approval).toMatchObject({ callId: 'call-2' });
    expect(recoverOpenAgentRuns(repository)).toEqual(recoverOpenAgentRuns(repository));
  });

  it('fails closed for gaps, unknown events, and malformed state', () => {
    const repository = createRepository();
    repository.append({ sequence: 1, event: { type: 'run_started', runId: 'run-3' } });
    repository.append({ sequence: 2, event: { type: 'round_started', runId: 'run-3', round: 1 } });
    const events = repository.read('run-3');
    expect(() => reduceAgentRunEvents([{ ...events[0], sequence: 2 }, events[1]])).toThrow(
      /sequence/,
    );
    expect(() =>
      reduceAgentRunEvents([
        { ...events[0], event: { type: 'unknown_required', runId: 'run-3' } as never },
      ]),
    ).toThrow(/Unknown required/);
    expect(() => reduceAgentRunEvents([{ ...events[0], schemaVersion: 99 }])).toThrow(
      /schema version/,
    );
    expect(() =>
      reduceAgentRunEvents([
        { ...events[0] },
        { ...events[1], event: { ...events[1].event, round: 0 } },
      ]),
    ).toThrow();
  });

  it('reserves a confirmed retry exactly once and never resolves an unknown tool automatically', () => {
    const repository = createRepository();
    repository.append({
      sequence: 1,
      event: {
        type: 'run_started',
        runId: 'run-recovery-action',
        conversationId: 'conversation-recovery',
        originMessageId: 'message-origin',
        agentId: 'general',
        executionMode: 'stream',
      },
    });
    repository.append({
      sequence: 2,
      event: {
        type: 'tool_call_started',
        runId: 'run-recovery-action',
        callId: 'call-recovery',
        toolName: 'bash',
        round: 1,
      },
    });

    expect(listRecoverableRuns('conversation-recovery', repository)).toMatchObject([
      {
        runId: 'run-recovery-action',
        unknownTools: [{ callId: 'call-recovery', recoveryLevel: 'requires_confirmation' }],
        actions: ['retry', 'abandon'],
      },
    ]);
    expect(() =>
      resolveRecoveryAction(
        {
          conversationId: 'conversation-recovery',
          runId: 'run-recovery-action',
          action: 'retry',
          idempotencyKey: 'recovery-key',
        },
        repository,
      ),
    ).toThrow(/requires confirmation/);

    const action = resolveRecoveryAction(
      {
        conversationId: 'conversation-recovery',
        runId: 'run-recovery-action',
        action: 'retry',
        idempotencyKey: 'recovery-key',
        confirmation: true,
      },
      repository,
    );
    const repeated = resolveRecoveryAction(
      {
        conversationId: 'conversation-recovery',
        runId: 'run-recovery-action',
        action: 'retry',
        idempotencyKey: 'recovery-key',
        confirmation: true,
      },
      repository,
    );
    expect(repeated).toEqual(action);
    const recoveredReservation = resolveRecoveryAction(
      {
        conversationId: 'conversation-recovery',
        runId: 'run-recovery-action',
        action: 'retry',
        idempotencyKey: 'new-client-key-after-restart',
        confirmation: true,
      },
      repository,
    );
    expect(recoveredReservation).toEqual(action);
    expect(action.successorRunId).toBeTruthy();
    expect(repository.read('run-recovery-action')).toHaveLength(2);
  });
});
