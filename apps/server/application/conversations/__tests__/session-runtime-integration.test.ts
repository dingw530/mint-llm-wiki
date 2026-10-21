import Database from 'better-sqlite3';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { deriveModelHistory } from '@mint/session';
import { projectTrace } from '@mint/session/trace';
import { BaseTool } from '../../../agent-runtime/tooling/base-tool.js';
import { createRuntimeContext } from '../../../agent-runtime/tooling/runtime-context.js';
import { ToolExecutionService } from '../../agent-runtime/tool-execution-service.js';
import { ToolExecutor } from '../../agent-runtime/tooling/tool-executor.js';
import { ToolRegistry } from '../../agent-runtime/tooling/tool-registry.js';
import { ToolApprovalStore } from '../../agent-runtime/tooling/tool-approval-store.js';
import { runMigrations } from '../../../migrations/index.js';
import { ConversationSessionRepository } from '../../../infrastructure/persistence/conversation-session-repository.js';
import { ToolInvocationRepository } from '../../../infrastructure/persistence/tool-invocation-repository.js';
import { ConversationSessionRunWriter } from '../session-run-writer.js';

const conversationId = 'session-runtime-integration';
const runId = 'session-runtime-run';
const callId = 'session-runtime-call';

class AppendIntegrationTool extends BaseTool<{ path: string; content: string }, { bytes: number }> {
  readonly name = 'append_integration_file';
  readonly description = '写入会话 Runtime 集成探针文件';
  readonly inputSchema = z.object({ path: z.string(), content: z.string() });

  override getMetadata() {
    return {
      source: 'builtin' as const,
      riskLevel: 'high' as const,
      sideEffect: 'external' as const,
      approvalMode: 'none' as const,
      retrySafety: 'never' as const,
    };
  }

  async execute(input: { path: string; content: string }): Promise<{ bytes: number }> {
    appendFileSync(input.path, input.content, 'utf8');
    return { bytes: Buffer.byteLength(input.content) };
  }
}

describe('session runtime integration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('commits tool intent, Ledger, result and next model history in order', async () => {
    vi.stubEnv('AI_CHAT_ENCRYPTION_KEY', 'session-runtime-integration-key');
    const resources = {
      database: new Database(':memory:'),
      temporaryDirectory: mkdtempSync(path.join(os.tmpdir(), 'mint-session-runtime-')),
      handlerCalls: 0,
    };
    try {
      initializeDatabase(resources.database);
      const targetPath = path.join(resources.temporaryDirectory, 'result.txt');
      const repository = new ConversationSessionRepository(resources.database);
      const initial = repository.ensureConversation(conversationId);
      const lease = repository.claimOwner(conversationId, runId, 30_000);
      const writer = new ConversationSessionRunWriter(
        repository,
        conversationId,
        runId,
        'session-runtime-turn',
        lease,
        initial.lastSequence,
      );
      writer.startUserTurn('session-runtime-user', '请写入测试内容', new Date().toISOString());
      writer.recordContextSnapshot({
        round: 1,
        scope: 'system',
        operation: 'replace',
        source: 'integration-system',
        messages: [{ role: 'system', content: '集成测试系统提示' }],
      });
      writer.recordToolCatalog(1, []);
      const argumentsJson = JSON.stringify({ path: targetPath, content: 'runtime-result' });
      writer.recordModelMessage(1, [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: callId,
              type: 'function',
              function: { name: 'append_integration_file', arguments: argumentsJson },
            },
          ],
        },
      ]);

      const registry = new ToolRegistry();
      registry.register(
        new (class extends AppendIntegrationTool {
          override async execute(input: { path: string; content: string }) {
            resources.handlerCalls += 1;
            return super.execute(input);
          }
        })(),
      );
      const invocations = new ToolInvocationRepository(resources.database);
      const service = new ToolExecutionService(
        registry,
        new ToolExecutor(registry),
        new ToolApprovalStore(),
        undefined,
        () => undefined,
        invocations,
      );
      const context = createRuntimeContext({ sessionRecorder: writer });
      const execution = await service.executeToolDetailed(
        {
          id: callId,
          type: 'function',
          function: { name: 'append_integration_file', arguments: argumentsJson },
        },
        conversationId,
        { runId, approvalGranted: true, runtimeContext: context },
      );

      expect(execution.success).toBe(true);
      expect(resources.handlerCalls).toBe(1);
      expect(invocations.get(runId, callId)).toMatchObject({
        status: 'succeeded',
        attempt: 1,
        argumentsAvailable: true,
      });
      const dispatch = repository
        .readAll(conversationId)
        .find((event) => event.type === 'tool_dispatch_committed' && event.callId === callId);
      expect(dispatch).toMatchObject({ argumentsJson, retrySafety: 'never' });

      writer.recordToolResult({
        callId,
        toolName: 'append_integration_file',
        status: 'success',
        message: {
          role: 'tool',
          tool_call_id: callId,
          content: JSON.stringify(execution.data),
        },
      });
      const beforeNextModel = repository.readAll(conversationId);
      expect(beforeNextModel.some((event) => event.type === 'tool_result')).toBe(true);
      writer.recordModelMessage(2, [{ role: 'assistant', content: '写入已完成' }]);
      writer.recordRunTerminal('completed');
      writer.close();

      const events = repository.readAll(conversationId);
      const history = deriveModelHistory(events);
      const toolCallIndex = history.findIndex(
        (message) => message.role === 'assistant' && message.tool_calls?.[0]?.id === callId,
      );
      const resultIndex = history.findIndex(
        (message) => message.role === 'tool' && message.tool_call_id === callId,
      );
      expect(toolCallIndex).toBeGreaterThanOrEqual(0);
      expect(resultIndex).toBeGreaterThan(toolCallIndex);
      expect(history.at(-1)).toMatchObject({ role: 'assistant', content: '写入已完成' });
      expect(readFileSync(targetPath, 'utf8')).toBe('runtime-result');

      const projection = projectTrace(events);
      expect(projection.events.some((event) => event.type === 'tool_dispatch_committed')).toBe(
        true,
      );
      expect(projection.runs[0]).toMatchObject({ runId, status: 'completed' });
      expect(JSON.stringify(projection.events)).not.toContain('runtime-result');
    } finally {
      resources.database.close();
      rmSync(resources.temporaryDirectory, { recursive: true, force: true });
    }
  });
});

/** 初始化会话 Runtime 探针需要的 SQLite schema 和迁移。 */
function initializeDatabase(database: Database.Database): void {
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat'
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE agent_tool_invocations (
      run_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      invocation_id TEXT NOT NULL UNIQUE,
      tool_name TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      retry_safety TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      retryable INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      arguments_encrypted TEXT,
      PRIMARY KEY (run_id, call_id)
    );
  `);
  const markApplied = database.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)');
  for (let id = 1; id <= 34; id += 1) markApplied.run(id, 'integration-seed');
  runMigrations(database);
  database
    .prepare('INSERT INTO conversations (id, title) VALUES (?, ?)')
    .run(conversationId, 'Runtime');
}
