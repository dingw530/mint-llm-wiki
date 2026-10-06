import type { ToolContext } from '../../agent-runtime/tooling/tool-contracts.js';
import type { ApprovalResumeContext } from '../../agent-runtime/tooling/tool-round-contracts.js';
import type { RuntimeContext } from '../../agent-runtime/tooling/runtime-context.js';
import type { ToolCall } from '../../types.js';
import { getApprovalScopePath, toolApprovalStore } from './tooling/tool-approval-store.js';
import { toolExecutor } from './tooling/tool-executor.js';
import type { ToolExecutor } from './tooling/tool-executor.js';
import { toolRegistry } from './tooling/tool-registry.js';
import { getWikiPath } from '../wiki/wiki-path.js';

export interface ExecuteToolOptions {
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
  ) {
    this.syncMcpHandlers();
    const { name } = toolCall.function;
    if (!this.registry.has(name)) {
      return { success: false, error: `未知工具: ${name}`, duration: 0 };
    }

    const wikiPath = name === 'bash' ? getWikiPath() : null;
    const context: ToolContext = {
      conversationId,
      runtimeContext: options.runtimeContext,
      ...(wikiPath ? { wikiPath } : {}),
      approvalGranted:
        options.approvalGranted === undefined
          ? this.approvals.isGranted(conversationId, toolCall)
          : options.approvalGranted,
      requestApproval: ({ reason }) =>
        this.approvals.create({
          conversationId,
          toolCall,
          reason,
          resume: options.approvalContext,
          scopePath: this.getScopePath(toolCall),
        }),
    };
    return this.executor.executeFromToolCall(toolCall, context);
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
