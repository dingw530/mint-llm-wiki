import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../../migrations/index.js';
import { AgentRunEventRepository } from '../../../infrastructure/persistence/agent-run-event-repository.js';
import { ToolInvocationRepository } from '../../../infrastructure/persistence/tool-invocation-repository.js';
import { initializeToolRegistry } from '../../../bootstrap/tool-registry.js';
import {
  buildToolRecoveryMessages,
  listRecoverableRuns,
  recoverOpenAgentRuns,
  reduceAgentRunEvents,
  resolveRecoveryAction,
} from '../agent-run-recovery-service.js';

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

  it('restores original call IDs and arguments with a synthetic unknown result', () => {
    const argumentsJson = '{ "path": "report.md", "content": "expected full body" }';
    const recovered = {
      runId: 'origin-run',
      phase: 'running' as const,
      sequence: 3,
      round: 1,
      toolCalls: [
        { callId: 'origin-call', toolName: 'write_file', status: 'tool_outcome_unknown' as const },
      ],
      terminal: false,
      recovery: 'interrupted' as const,
      unknownToolCalls: ['origin-call'],
    };
    const invocationReader = {
      get: () => ({
        runId: 'origin-run',
        callId: 'origin-call',
        invocationId: 'origin-invocation',
        toolName: 'write_file',
        inputHash: 'origin-hash',
        retrySafety: 'never' as const,
        status: 'outcome_unknown' as const,
        attempt: 1,
        retryable: false,
        startedAt: '2026-10-20T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:01.000Z',
      }),
      getArguments: () => argumentsJson,
    };

    const messages = buildToolRecoveryMessages(recovered, invocationReader);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 'origin-call',
          function: { name: 'write_file', arguments: argumentsJson },
        },
      ],
    });
    expect(messages[1]).toMatchObject({ role: 'tool', tool_call_id: 'origin-call' });
    expect(messages[1].content).toContain('originalRunId');
    expect(messages[1].content).toContain('outcome_unknown');
    expect(messages[1].content).toContain('externalStateVerified');
    expect(messages[1].content).toContain('Do not replay blindly');
  });

  it('blocks retry and offers reconciliation when the invocation ledger says succeeded', () => {
    const repository = createRepository();
    repository.append({
      sequence: 1,
      event: {
        type: 'run_started',
        runId: 'run-ledger-succeeded',
        conversationId: 'conversation-ledger-succeeded',
        originMessageId: 'message-ledger-succeeded',
        executionMode: 'react',
      },
    });
    repository.append({
      sequence: 2,
      event: {
        type: 'tool_call_started',
        runId: 'run-ledger-succeeded',
        callId: 'call-ledger-succeeded',
        toolName: 'write_file',
        round: 1,
      },
    });
    const succeededInvocation = {
      runId: 'run-ledger-succeeded',
      callId: 'call-ledger-succeeded',
      invocationId: 'invocation-ledger-succeeded',
      toolName: 'write_file',
      inputHash: 'hash-ledger-succeeded',
      retrySafety: 'never' as const,
      argumentsAvailable: true,
      status: 'succeeded' as const,
      attempt: 1,
      retryable: false,
      startedAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:01.000Z',
    };
    const invocations = {
      get: () => succeededInvocation,
      getArguments: () => '{"path":"report.md","content":"body"}',
    };

    const [recoverable] = listRecoverableRuns(
      'conversation-ledger-succeeded',
      repository,
      invocations,
    );

    expect(recoverable?.unknownTools[0]?.ledgerStatus).toBe('succeeded');
    expect(recoverable?.actions).toEqual(['continue', 'abandon']);
    expect(() =>
      resolveRecoveryAction(
        {
          conversationId: 'conversation-ledger-succeeded',
          runId: 'run-ledger-succeeded',
          action: 'retry',
          idempotencyKey: 'retry-already-succeeded',
          confirmation: true,
        },
        repository,
        invocations,
      ),
    ).toThrow(/Ledger already records success/);
    expect(
      resolveRecoveryAction(
        {
          conversationId: 'conversation-ledger-succeeded',
          runId: 'run-ledger-succeeded',
          action: 'continue',
          idempotencyKey: 'verify-already-succeeded',
        },
        repository,
        invocations,
      ).action,
    ).toBe('continue');
  });

  it('hides and rejects retry when the old Ledger has no original arguments', () => {
    const repository = createRepository();
    repository.append({
      sequence: 1,
      event: {
        type: 'run_started',
        runId: 'run-arguments-missing',
        conversationId: 'conversation-arguments-missing',
        originMessageId: 'message-arguments-missing',
        executionMode: 'react',
      },
    });
    repository.append({
      sequence: 2,
      event: {
        type: 'tool_call_started',
        runId: 'run-arguments-missing',
        callId: 'call-arguments-missing',
        toolName: 'write_file',
        round: 1,
      },
    });
    const invocationReader = {
      get: () => ({
        runId: 'run-arguments-missing',
        callId: 'call-arguments-missing',
        invocationId: 'invocation-arguments-missing',
        toolName: 'write_file',
        inputHash: 'hash-arguments-missing',
        retrySafety: 'never' as const,
        argumentsAvailable: false,
        status: 'outcome_unknown' as const,
        attempt: 1,
        retryable: false,
        startedAt: '2026-10-20T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:01.000Z',
      }),
      getArguments: () => undefined,
    };

    const [recoverable] = listRecoverableRuns(
      'conversation-arguments-missing',
      repository,
      invocationReader,
    );

    expect(recoverable?.unknownTools[0]?.argumentsAvailable).toBe(false);
    expect(recoverable?.actions).toEqual(['continue', 'abandon']);
    expect(() =>
      resolveRecoveryAction(
        {
          conversationId: 'conversation-arguments-missing',
          runId: 'run-arguments-missing',
          action: 'retry',
          idempotencyKey: 'retry-without-arguments',
          confirmation: true,
        },
        repository,
        invocationReader,
      ),
    ).toThrow(/Original tool arguments are unavailable/);
  });

  it('marks placeholder arguments when an old invocation has no recoverable snapshot', () => {
    const recovered = {
      runId: 'legacy-run',
      phase: 'running' as const,
      sequence: 2,
      round: 1,
      toolCalls: [
        { callId: 'legacy-call', toolName: 'write_file', status: 'tool_outcome_unknown' as const },
      ],
      terminal: false,
      recovery: 'interrupted' as const,
      unknownToolCalls: ['legacy-call'],
    };
    const invocationReader = {
      get: () => undefined,
      getArguments: () => undefined,
    };

    const messages = buildToolRecoveryMessages(recovered, invocationReader);

    expect(messages[0]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'legacy-call', function: { arguments: '{}' } }],
    });
    expect(messages[1].content).toContain('argumentsRestored');
    expect(messages[1].content).toContain('false');
    expect(messages[1].content).toContain('Do not execute or retry it');
  });

  it('rebuilds a provider-valid recovery transcript from the SQLite ledgers', () => {
    const database = createMigrationFixture(new Database(':memory:'));
    runMigrations(database);
    const runRepository = new AgentRunEventRepository(database);
    const invocationRepository = new ToolInvocationRepository(database);
    const argumentsJson = '{ "path": "report.md", "content": "the complete intended text" }';
    runRepository.append({
      sequence: 1,
      event: {
        type: 'run_started',
        runId: 'run-recovery-transcript',
        conversationId: 'conversation-recovery-transcript',
      },
    });
    runRepository.append({
      sequence: 2,
      event: { type: 'round_started', runId: 'run-recovery-transcript', round: 1 },
    });
    runRepository.append({
      sequence: 3,
      event: {
        type: 'tool_call_started',
        runId: 'run-recovery-transcript',
        callId: 'call-recovery-transcript',
        toolName: 'write_file',
        round: 1,
      },
    });
    invocationRepository.begin({
      runId: 'run-recovery-transcript',
      callId: 'call-recovery-transcript',
      invocationId: 'invocation-recovery-transcript',
      toolName: 'write_file',
      inputHash: 'hash-recovery-transcript',
      retrySafety: 'never',
      argumentsJson,
    });
    invocationRepository.markInterruptedUnknown();

    const recovered = reduceAgentRunEvents(runRepository.read('run-recovery-transcript'));
    const messages = buildToolRecoveryMessages(recovered, invocationRepository);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.tool_calls?.[0]).toMatchObject({
      id: 'call-recovery-transcript',
      function: { name: 'write_file', arguments: argumentsJson },
    });
    expect(messages[1]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-recovery-transcript',
    });
    expect(messages[1]?.content).toContain('run-recovery-transcript');
    expect(messages[1]?.content).toContain('OUTCOME_UNKNOWN');
    expect(
      invocationRepository.get('run-recovery-transcript', 'call-recovery-transcript'),
    ).toMatchObject({ status: 'outcome_unknown', retryable: false });
    expect(
      invocationRepository.getArguments('run-recovery-transcript', 'call-recovery-transcript'),
    ).toBe(argumentsJson);
    database.close();
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
    initializeToolRegistry();
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
    const retryableInvocations = {
      get: () => ({
        runId: 'run-recovery-action',
        callId: 'call-recovery',
        invocationId: 'invocation-recovery-action',
        toolName: 'bash',
        inputHash: 'hash-recovery-action',
        retrySafety: 'never' as const,
        argumentsAvailable: true,
        status: 'outcome_unknown' as const,
        attempt: 1,
        retryable: false,
        startedAt: '2026-10-20T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:01.000Z',
      }),
      getArguments: () => '{"command":"ls"}',
    };

    expect(
      listRecoverableRuns('conversation-recovery', repository, retryableInvocations),
    ).toMatchObject([
      {
        runId: 'run-recovery-action',
        unknownTools: [{ callId: 'call-recovery', recoveryLevel: 'requires_confirmation' }],
        actions: ['continue', 'retry', 'abandon'],
      },
    ]);
    const continuationRepository = createRepository();
    continuationRepository.append({
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
    continuationRepository.append({
      sequence: 2,
      event: {
        type: 'tool_call_started',
        runId: 'run-recovery-action',
        callId: 'call-recovery',
        toolName: 'bash',
        round: 1,
      },
    });
    const continueAction = resolveRecoveryAction(
      {
        conversationId: 'conversation-recovery',
        runId: 'run-recovery-action',
        action: 'continue',
        idempotencyKey: 'continue-after-unknown',
      },
      continuationRepository,
      retryableInvocations,
    );
    expect(continueAction).toMatchObject({
      action: 'continue',
      successorRunId: expect.any(String),
    });
    expect(() =>
      resolveRecoveryAction(
        {
          conversationId: 'conversation-recovery',
          runId: 'run-recovery-action',
          action: 'retry',
          idempotencyKey: 'recovery-key',
        },
        repository,
        retryableInvocations,
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
      retryableInvocations,
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
      retryableInvocations,
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
      retryableInvocations,
    );
    expect(recoveredReservation).toEqual(action);
    expect(action.successorRunId).toBeTruthy();
    expect(repository.read('run-recovery-action')).toHaveLength(2);
  });
});
