import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunEventRecord } from '../../../agent-runtime/agent-run-persistence.js';
import { GetToolInvocationTool } from '../../tools/agents/get-tool-invocation-tool.js';
import { ToolCatalogService } from '../tool-catalog-service.js';
import { ToolRegistry } from '../tooling/tool-registry.js';
import { runMigrations } from '../../../migrations/index.js';
import { ToolInvocationRepository } from '../../../infrastructure/persistence/tool-invocation-repository.js';

const runId = 'run-reconcile';
const callId = 'call-reconcile';
const conversationId = 'conversation-reconcile';
const argumentsJson = '{ "path": "report.md", "content": "secret body" }';

describe('get_tool_invocation', () => {
  let database: Database.Database;
  let invocations: ToolInvocationRepository;
  let tool: GetToolInvocationTool;
  let events: AgentRunEventRecord[];

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
    invocations = new ToolInvocationRepository(database);
    events = [
      {
        runId,
        sequence: 1,
        schemaVersion: 1,
        event: { type: 'run_started', runId, conversationId },
        createdAt: '2026-10-20T00:00:00.000Z',
      },
    ];
    tool = new GetToolInvocationTool(invocations, { read: vi.fn(() => events) });
    invocations.begin({
      runId,
      callId,
      invocationId: 'invocation-reconcile',
      toolName: 'write_file',
      inputHash: 'hash-reconcile',
      retrySafety: 'never',
      argumentsJson,
    });
    invocations.markInterruptedUnknown();
  });

  afterEach(() => database.close());

  it('is visible in the Agent catalog', async () => {
    const registry = new ToolRegistry();
    registry.register(tool);
    const catalog = new ToolCatalogService({
      registry,
      mcpCatalog: {},
      findAgent: () => undefined,
      createMcpTool: () => tool,
      isLegacyMcpEnabled: () => false,
    });

    const definitions = await catalog.getAllToolDefinitions();

    expect(definitions.map((definition) => definition.function.name)).toContain(
      'get_tool_invocation',
    );
  });

  it('returns metadata by default without decrypting arguments', async () => {
    const getArguments = vi.spyOn(invocations, 'getArguments');
    const input = tool.inputSchema.parse({ run_id: runId, call_id: callId });

    const result = await tool.execute(input, { conversationId });

    expect(result).toMatchObject({
      invocation: { status: 'outcome_unknown', toolName: 'write_file' },
      arguments: { status: 'not_requested' },
      toolResultStored: false,
      externalStateVerified: false,
      reconciliationRequired: true,
    });
    expect(getArguments).not.toHaveBeenCalled();
  });

  it('returns exact arguments only when requested and keeps unknown status unchanged', async () => {
    const input = tool.inputSchema.parse({
      run_id: runId,
      call_id: callId,
      include_arguments: true,
    });

    const result = await tool.execute(input, { conversationId });

    expect(result.arguments).toEqual({ status: 'available', json: argumentsJson });
    expect(result.invocation.status).toBe('outcome_unknown');
    expect(invocations.get(runId, callId)?.status).toBe('outcome_unknown');
    expect(result.externalStateVerified).toBe(false);
  });

  it('denies cross-conversation and unverifiable runs before reading invocation data', async () => {
    const get = vi.spyOn(invocations, 'get');
    const input = tool.inputSchema.parse({ run_id: runId, call_id: callId });

    await expect(tool.execute(input, { conversationId: 'another-conversation' })).rejects.toThrow(
      '只能查询当前会话所属运行的工具调用记录',
    );
    events = [];
    await expect(tool.execute(input, { conversationId })).rejects.toThrow(
      '只能查询当前会话所属运行的工具调用记录',
    );
    expect(get).not.toHaveBeenCalled();
  });

  it('reports a legacy snapshot as missing', async () => {
    invocations.begin({
      runId,
      callId: 'legacy-call',
      invocationId: 'legacy-invocation',
      toolName: 'read_file',
      inputHash: 'legacy-hash',
      retrySafety: 'safe',
    });
    const input = tool.inputSchema.parse({
      run_id: runId,
      call_id: 'legacy-call',
      include_arguments: true,
    });

    const result = await tool.execute(input, { conversationId });

    expect(result.arguments).toEqual({ status: 'missing' });
  });
});
