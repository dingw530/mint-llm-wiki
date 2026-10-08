import { createHash, randomUUID } from 'node:crypto';
import type {
  ToolContext,
  ToolInvocationControl,
} from '../../agent-runtime/tooling/tool-contracts.js';
import type { ApprovalResumeContext } from '../../agent-runtime/tooling/tool-round-contracts.js';
import type { RuntimeContext } from '../../agent-runtime/tooling/runtime-context.js';
import type { ToolCall } from '../../types.js';
import { getApprovalScopePath, toolApprovalStore } from './tooling/tool-approval-store.js';
import { toolExecutor } from './tooling/tool-executor.js';
import type { ExecutionResult, ToolExecutor } from './tooling/tool-executor.js';
import { toolRegistry } from './tooling/tool-registry.js';
import { getWikiPath } from '../wiki/wiki-path.js';
import { getMintWorkspacePath } from '../../infrastructure/filesystem/mint-workspace.js';
import {
  toolInvocationRepository,
  type ToolInvocationRepository,
} from '../../infrastructure/persistence/tool-invocation-repository.js';
import {
  toolAuditSink,
  type ToolAuditSink,
} from '../../infrastructure/observability/tool-audit-sink.js';

export interface ExecuteToolOptions {
  runId?: string;
  signal?: AbortSignal;
  approvalGranted?: boolean;
  approvalContext?: ApprovalResumeContext;
  runtimeContext?: RuntimeContext;
}

export type McpHandlerSync = () => void;

/** Executes one model tool call through the single application ToolExecutor gate. */
export class ToolExecutionService {
  private syncMcpHandlers: McpHandlerSync;

  constructor(
    private readonly registry = toolRegistry,
    private readonly executor: ToolExecutor = toolExecutor,
    private readonly approvals = toolApprovalStore,
    private readonly getScopePath = getApprovalScopePath,
    syncMcpHandlers: McpHandlerSync = () => {},
    private readonly invocations: ToolInvocationRepository = toolInvocationRepository,
    private readonly auditSink: ToolAuditSink = toolAuditSink,
  ) {
    this.syncMcpHandlers = syncMcpHandlers;
  }

  /** Updates MCP handlers through the injected catalog adapter. */
  setMcpHandlerSync(sync: McpHandlerSync): void {
    this.syncMcpHandlers = sync;
  }

  /** Executes a call and keeps the structured ToolExecutor result. */
  async executeToolDetailed(
    toolCall: ToolCall,
    conversationId = '',
    options: ExecuteToolOptions = {},
  ): Promise<ExecutionResult> {
    this.syncMcpHandlers();
    const { name } = toolCall.function;
    const runId = options.runId || randomUUID();
    const callId = toolCall.id || randomUUID();
    const invocationId = createInvocationId(runId, callId);
    if (!this.registry.has(name)) {
      try {
        this.auditSink.record({
          event: 'failed',
          toolName: name,
          source: 'builtin',
          riskLevel: 'medium',
          conversationId,
          invocationId,
          runId,
          callId,
          duration: 0,
          resultCode: 'failed',
          errorCode: 'UNKNOWN_TOOL',
          retryCount: 0,
          parameterSummary: 'unavailable',
        });
      } catch {
        // A logging outage must not change the unknown-tool result.
      }
      return {
        success: false,
        error: `未知工具: ${name}`,
        errorCode: 'UNKNOWN_TOOL',
        retryable: false,
        duration: 0,
      };
    }

    const stableToolCall = toolCall.id ? toolCall : { ...toolCall, id: callId };
    const invocation: ToolInvocationControl = {
      invocationId,
      claim: ({ toolName, inputHash, retrySafety }) =>
        this.invocations.begin({ runId, callId, invocationId, toolName, inputHash, retrySafety }),
      finish: ({ status, retryable, errorCode }) =>
        this.invocations.finish({ runId, callId, status, retryable, errorCode }),
    };

    const wikiPath = name === 'bash' ? getWikiPath() : null;
    const context: ToolContext = {
      conversationId,
      invocationId,
      runId,
      callId,
      invocation,
      audit: (event) => {
        try {
          this.auditSink.record(event);
        } catch {
          // A logging outage must not change the tool execution result.
        }
      },
      signal: options.signal,
      runtimeContext: options.runtimeContext,
      ...(wikiPath ? { wikiPath } : {}),
      ...(name === 'bash' ? { allowedWorkingDirectory: getMintWorkspacePath() } : {}),
      approvalGranted:
        options.approvalGranted === undefined
          ? this.approvals.isGranted(conversationId, stableToolCall)
          : options.approvalGranted,
      requestApproval: ({ reason }) =>
        this.approvals.create({
          conversationId,
          toolCall: stableToolCall,
          reason,
          resume: options.approvalContext,
          scopePath: this.getScopePath(stableToolCall),
        }),
    };
    return this.executor.executeFromToolCall(stableToolCall, context);
  }

  /** Returns tool data on success and a structured error on failure. */
  async executeTool(
    toolCall: ToolCall,
    conversationId = '',
    options: ExecuteToolOptions = {},
  ): Promise<unknown> {
    const result = await this.executeToolDetailed(toolCall, conversationId, options);
    if (result.success) return result.data;
    return {
      error: result.error,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      ...(result.retryable !== undefined ? { retryable: result.retryable } : {}),
      ...(result.outcomeUnknown ? { outcomeUnknown: true } : {}),
      ...(result.approvalRequired ? { approvalRequired: result.approvalRequired } : {}),
    };
  }

  /** Returns a presentation summary for a tool result when the handler provides one. */
  getToolResultSummary(toolCall: ToolCall, result: unknown): string | undefined {
    return this.registry.getResultSummary(toolCall.function.name, result);
  }
}

export const toolExecutionService = new ToolExecutionService();

export const executeToolDetailed =
  toolExecutionService.executeToolDetailed.bind(toolExecutionService);
export const executeTool = toolExecutionService.executeTool.bind(toolExecutionService);
export const getToolResultSummary =
  toolExecutionService.getToolResultSummary.bind(toolExecutionService);

/** Derives a stable opaque key for one tool call within an AgentRun. */
function createInvocationId(runId: string, callId: string): string {
  return createHash('sha256').update(`${runId}\u0000${callId}`).digest('hex');
}
