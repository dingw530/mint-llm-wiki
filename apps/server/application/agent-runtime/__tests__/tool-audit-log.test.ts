import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BaseTool } from '../../../agent-runtime/tooling/base-tool.js';
import type { ToolAuditEvent } from '../../../agent-runtime/tooling/tool-contracts.js';
import { runMigrations } from '../../../migrations/index.js';
import { ToolInvocationRepository } from '../../../infrastructure/persistence/tool-invocation-repository.js';
import { ToolAuditSink } from '../../../infrastructure/observability/tool-audit-sink.js';
import { ToolExecutionService } from '../tool-execution-service.js';
import { ToolExecutor } from '../tooling/tool-executor.js';
import { ToolRegistry } from '../tooling/tool-registry.js';
import { ToolApprovalStore } from '../tooling/tool-approval-store.js';
import {
  createRuntimeContext,
  type SessionRecordingPort,
} from '../../../agent-runtime/tooling/runtime-context.js';
import { ConversationSessionRepository } from '../../../infrastructure/persistence/conversation-session-repository.js';
import { ConversationSessionRunWriter } from '../../conversations/session-run-writer.js';

class AuditFixtureTool extends BaseTool<{ password: string; values: string[] }, string> {
  readonly name = 'audit_fixture';
  readonly description = 'Fixture for audit logging';
  readonly inputSchema = z.object({ password: z.string(), values: z.array(z.string()) });

  constructor(private readonly onExecute?: () => void) {
    super();
  }

  isReadOnly(): boolean {
    return true;
  }

  async execute(): Promise<string> {
    this.onExecute?.();
    return 'ok';
  }
}

class ApprovalAuditFixtureTool extends BaseTool<{ value: string }, string> {
  readonly name = 'approval_audit_fixture';
  readonly description = 'Fixture for approval logging';
  readonly inputSchema = z.object({ value: z.string() });
  readonly execute = vi.fn(async () => 'executed');

  getMetadata() {
    return {
      source: 'builtin' as const,
      riskLevel: 'high' as const,
      sideEffect: 'external' as const,
      requiresApproval: true,
    };
  }
}

describe('tool audit logging', () => {
  let database: Database.Database;

  beforeEach(() => {
    vi.stubEnv('AI_CHAT_ENCRYPTION_KEY', 'session-dispatch-test-key');
    database = new Database(':memory:');
    database.exec(`
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'New Chat');
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        reasoning TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
    `);
    const addMigration = database.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)');
    for (let id = 1; id <= 32; id += 1) addMigration.run(id, `migration-${id}`);
    runMigrations(database);
  });

  afterEach(() => {
    database.close();
    vi.unstubAllEnvs();
  });

  it('writes whitelisted execution events with stable identity and no input values', async () => {
    const registry = new ToolRegistry();
    registry.register(new AuditFixtureTool());
    const records: ToolAuditEvent[] = [];
    const auditSink: ToolAuditSink = { record: (event) => records.push(event) };
    const service = new ToolExecutionService(
      registry,
      new ToolExecutor(registry),
      new ToolApprovalStore(),
      () => undefined,
      () => {},
      new ToolInvocationRepository(database),
      auditSink,
    );
    const passwordCanary = 'password-canary-9230';

    const result = await service.executeToolDetailed(
      {
        id: 'audit-call-1',
        type: 'function',
        function: {
          name: 'audit_fixture',
          arguments: JSON.stringify({ password: passwordCanary, values: ['body-canary-117'] }),
        },
      },
      'conversation-audit',
      { runId: 'run-audit-1' },
    );

    expect(result.success).toBe(true);
    expect(records.some((record) => record.event === 'started')).toBe(true);
    expect(records.at(-1)).toMatchObject({
      event: 'completed',
      invocationId: expect.any(String),
      runId: 'run-audit-1',
      callId: 'audit-call-1',
      toolName: 'audit_fixture',
      resultCode: 'success',
      retryCount: 0,
    });
    expect(JSON.stringify(records)).not.toContain(passwordCanary);
    expect(JSON.stringify(records)).not.toContain('body-canary-117');
    expect(records.at(-1)?.parameterSummary).toContain('strings=2');
  });

  it('does not let audit sink failures alter tool execution', async () => {
    const registry = new ToolRegistry();
    registry.register(new AuditFixtureTool());
    const auditSink: ToolAuditSink = {
      record: vi.fn(() => {
        throw new Error('sink unavailable');
      }),
    };
    const service = new ToolExecutionService(
      registry,
      new ToolExecutor(registry),
      new ToolApprovalStore(),
      () => undefined,
      () => {},
      new ToolInvocationRepository(database),
      auditSink,
    );

    const result = await service.executeToolDetailed(
      {
        id: 'audit-call-2',
        type: 'function',
        function: { name: 'audit_fixture', arguments: '{"password":"x","values":[]}' },
      },
      'conversation-audit',
      { runId: 'run-audit-2' },
    );

    expect(result.success).toBe(true);
  });

  it('persists the original arguments before entering the tool handler', async () => {
    const repository = new ToolInvocationRepository(database);
    const rawArguments = '{ "password": "persisted-canary", "values": ["complete body"] }';
    let observedArguments: string | undefined;
    const registry = new ToolRegistry();
    registry.register(
      new AuditFixtureTool(() => {
        observedArguments = repository.getArguments(
          'run-audit-before-execute',
          'call-before-execute',
        );
      }),
    );
    const service = new ToolExecutionService(
      registry,
      new ToolExecutor(registry),
      new ToolApprovalStore(),
      () => undefined,
      () => {},
      repository,
      { record: () => {} },
    );

    const result = await service.executeToolDetailed(
      {
        id: 'call-before-execute',
        type: 'function',
        function: { name: 'audit_fixture', arguments: rawArguments },
      },
      'conversation-audit',
      { runId: 'run-audit-before-execute' },
    );

    expect(result.success).toBe(true);
    expect(observedArguments).toBe(rawArguments);
  });

  it('records a pending approval without creating a dispatch or Ledger claim', async () => {
    const repository = new ToolInvocationRepository(database);
    const approvals = new ToolApprovalStore();
    const tool = new ApprovalAuditFixtureTool();
    const registry = new ToolRegistry();
    registry.register(tool);
    const recorder = {
      record: vi.fn(() => []),
      recordModelMessage: vi.fn(),
      recordToolCatalog: vi.fn(),
      recordContextSnapshot: vi.fn(),
      recordToolDispatch: vi.fn(),
      recordToolResult: vi.fn(),
      recordApproval: vi.fn(),
      recordRunTerminal: vi.fn(),
      startHeartbeat: vi.fn(),
      pauseForApproval: vi.fn(),
      close: vi.fn(),
    } as unknown as SessionRecordingPort;
    const service = new ToolExecutionService(
      registry,
      new ToolExecutor(registry),
      approvals,
      () => undefined,
      () => {},
      repository,
      { record: () => {} },
    );

    const result = await service.executeToolDetailed(
      {
        id: 'approval-audit-call',
        type: 'function',
        function: { name: tool.name, arguments: '{"value":"confirm"}' },
      },
      'approval-audit-conversation',
      {
        runId: 'approval-audit-run',
        runtimeContext: createRuntimeContext({ sessionRecorder: recorder }),
      },
    );

    expect(result.approvalRequired).toBeDefined();
    expect(tool.execute).not.toHaveBeenCalled();
    expect(recorder.recordApproval).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'approval-audit-call', status: 'requested' }),
    );
    expect(recorder.pauseForApproval).toHaveBeenCalledOnce();
    expect(recorder.recordToolDispatch).not.toHaveBeenCalled();
    expect(repository.get('approval-audit-run', 'approval-audit-call')).toBeUndefined();
    expect(approvals.size()).toBe(1);
  });

  it('commits the Session dispatch and Ledger claim before entering the tool handler', async () => {
    const conversationId = 'conversation-dispatch-barrier';
    const runId = 'run-dispatch-barrier';
    const callId = 'call-dispatch-barrier';
    database.prepare('INSERT INTO conversations (id) VALUES (?)').run(conversationId);
    const sessions = new ConversationSessionRepository(database);
    const state = sessions.ensureConversation(conversationId);
    const lease = sessions.claimOwner(conversationId, runId, 60_000);
    const writer = new ConversationSessionRunWriter(
      sessions,
      conversationId,
      runId,
      'turn-dispatch-barrier',
      lease,
      state.lastSequence,
    );
    writer.recordModelMessage(1, [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: callId,
            type: 'function',
            function: { name: 'audit_fixture', arguments: '{"password":"safe","values":[]}' },
          },
        ],
      },
    ]);
    let observedDispatch: string | undefined;
    const registry = new ToolRegistry();
    registry.register(
      new AuditFixtureTool(() => {
        observedDispatch = sessions
          .readAll(conversationId)
          .find((event) => event.type === 'tool_dispatch_committed')?.type;
      }),
    );
    const invocations = new ToolInvocationRepository(database);
    const service = new ToolExecutionService(
      registry,
      new ToolExecutor(registry),
      new ToolApprovalStore(),
      () => undefined,
      () => {},
      invocations,
      { record: () => {} },
    );

    const result = await service.executeToolDetailed(
      {
        id: callId,
        type: 'function',
        function: { name: 'audit_fixture', arguments: '{"password":"safe","values":[]}' },
      },
      conversationId,
      { runId, runtimeContext: createRuntimeContext({ sessionRecorder: writer }) },
    );

    expect(result.success).toBe(true);
    expect(observedDispatch).toBe('tool_dispatch_committed');
    expect(invocations.get(runId, callId)?.status).toBe('succeeded');
    expect(sessions.readAll(conversationId).map((event) => event.type)).toEqual([
      'model_message',
      'tool_dispatch_committed',
    ]);
    writer.close();
  });

  it('rolls back the Ledger claim and blocks execution when Session dispatch persistence fails', async () => {
    const conversationId = 'conversation-dispatch-rollback';
    const runId = 'run-dispatch-rollback';
    const callId = 'call-dispatch-rollback';
    let toolExecutions = 0;
    database.prepare('INSERT INTO conversations (id) VALUES (?)').run(conversationId);
    const sessions = new ConversationSessionRepository(database);
    const state = sessions.ensureConversation(conversationId);
    const lease = sessions.claimOwner(conversationId, runId, 60_000);
    sessions.releaseOwner(lease);
    const writer = new ConversationSessionRunWriter(
      sessions,
      conversationId,
      runId,
      'turn-dispatch-rollback',
      lease,
      state.lastSequence,
    );
    const registry = new ToolRegistry();
    registry.register(new AuditFixtureTool(() => (toolExecutions += 1)));
    const invocations = new ToolInvocationRepository(database);
    const service = new ToolExecutionService(
      registry,
      new ToolExecutor(registry),
      new ToolApprovalStore(),
      () => undefined,
      () => {},
      invocations,
      { record: () => {} },
    );

    const result = await service.executeToolDetailed(
      {
        id: callId,
        type: 'function',
        function: { name: 'audit_fixture', arguments: '{"password":"safe","values":[]}' },
      },
      conversationId,
      { runId, runtimeContext: createRuntimeContext({ sessionRecorder: writer }) },
    );

    expect(result.success).toBe(false);
    expect(toolExecutions).toBe(0);
    expect(invocations.get(runId, callId)).toBeUndefined();
    expect(sessions.readAll(conversationId)).toEqual([]);
    writer.close();
  });
});
