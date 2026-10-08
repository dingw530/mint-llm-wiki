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

class AuditFixtureTool extends BaseTool<{ password: string; values: string[] }, string> {
  readonly name = 'audit_fixture';
  readonly description = 'Fixture for audit logging';
  readonly inputSchema = z.object({ password: z.string(), values: z.array(z.string()) });

  isReadOnly(): boolean {
    return true;
  }

  async execute(): Promise<string> {
    return 'ok';
  }
}

describe('tool audit logging', () => {
  let database: Database.Database;

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
  });

  afterEach(() => database.close());

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
});
