import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../migrations/index.js';
import { ToolRetryableError } from '../../../agent-runtime/tooling/tool-errors.js';
import type {
  ToolAuditEvent,
  ToolHandler,
  ToolInvocationControl,
} from '../../../agent-runtime/tooling/tool-contracts.js';
import { ToolInvocationRepository } from '../../../infrastructure/persistence/tool-invocation-repository.js';
import { ToolExecutor } from '../tooling/tool-executor.js';
import { ToolRegistry } from '../tooling/tool-registry.js';

describe('tool retry policy', () => {
  let database: Database.Database;
  let repository: ToolInvocationRepository;

  beforeEach(() => {
    database = new Database(':memory:');
    database.exec(`
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const addMigration = database.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)');
    for (let id = 1; id <= 32; id += 1) addMigration.run(id, `migration-${id}`);
    runMigrations(database);
    repository = new ToolInvocationRepository(database);
  });

  afterEach(() => database.close());

  it('retries only an explicitly retryable failure on a safe tool', async () => {
    let executionCount = 0;
    const registry = new ToolRegistry();
    registry.register(
      createTool({
        name: 'safe_retry',
        sideEffect: 'none',
        retrySafety: 'safe',
        execute: async () => {
          executionCount += 1;
          if (executionCount === 1) throw new ToolRetryableError('temporary provider failure');
          return 'ok';
        },
      }),
    );
    const context = createInvocationContext(repository, 'safe-run', 'safe-call');
    const auditEvents: ToolAuditEvent[] = [];

    const result = await new ToolExecutor(registry).execute(
      'safe_retry',
      { value: 'x' },
      { ...context, audit: (event) => auditEvents.push(event) },
      { retries: 1, retryDelay: 0 },
    );

    expect(result).toMatchObject({ success: true, retries: 1 });
    expect(executionCount).toBe(2);
    expect(repository.get('safe-run', 'safe-call')?.status).toBe('succeeded');
    expect(auditEvents.at(-1)).toMatchObject({ event: 'completed', retryCount: 1 });
  });

  it('blocks replay of a non-idempotent call after timeout makes its outcome unknown', async () => {
    let executionCount = 0;
    const registry = new ToolRegistry();
    registry.register(
      createTool({
        name: 'external_write',
        sideEffect: 'external',
        retrySafety: 'never',
        execute: async () => {
          executionCount += 1;
          await new Promise((resolve) => setTimeout(resolve, 30));
          return 'late result';
        },
      }),
    );
    const executor = new ToolExecutor(registry);
    const context = createInvocationContext(repository, 'unknown-run', 'unknown-call');

    const first = await executor.execute('external_write', { value: 'x' }, context, { timeout: 5 });
    const replay = await executor.execute('external_write', { value: 'x' }, context, {
      timeout: 5,
    });

    expect(first).toMatchObject({
      success: false,
      outcomeUnknown: true,
      errorCode: 'OUTCOME_UNKNOWN',
    });
    expect(replay).toMatchObject({ success: false, errorCode: 'OUTCOME_UNKNOWN' });
    expect(executionCount).toBe(1);
  });
});

function createTool(input: {
  name: string;
  sideEffect: 'none' | 'external';
  retrySafety: 'safe' | 'never';
  execute: () => Promise<string>;
}): ToolHandler<{ value: string }, string> {
  return {
    name: input.name,
    description: input.name,
    executionMode: 'sync',
    isEnabled: () => true,
    isReadOnly: () => input.sideEffect === 'none',
    isIdempotent: () => input.retrySafety === 'safe',
    isConcurrencySafe: () => true,
    getMetadata: () => ({
      source: 'builtin',
      riskLevel: input.sideEffect === 'none' ? 'low' : 'high',
      sideEffect: input.sideEffect,
      approvalMode: 'none',
      retrySafety: input.retrySafety,
    }),
    validate: () => ({ valid: true }),
    checkPermission: () => ({ allowed: true }),
    execute: input.execute,
    getDefinition: () => ({
      type: 'function',
      function: { name: input.name, description: input.name, parameters: {} },
    }),
    getCallSummary: () => undefined,
    getResultSummary: () => undefined,
  };
}

function createInvocationContext(
  invocations: ToolInvocationRepository,
  runId: string,
  callId: string,
): { conversationId: string; invocationId: string; invocation: ToolInvocationControl } {
  const invocationId = `${runId}:${callId}`;
  return {
    conversationId: 'retry-test',
    invocationId,
    invocation: {
      invocationId,
      claim: (claim) => invocations.begin({ ...claim, runId, callId, invocationId }),
      finish: (finish) => invocations.finish({ ...finish, runId, callId }),
    },
  };
}
