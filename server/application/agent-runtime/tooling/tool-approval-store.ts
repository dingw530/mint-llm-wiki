import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AiSettings, HistoryMessage, ToolCall } from '../../../types.js';

export interface ApprovalResumeContext {
  runId?: string;
  messages: HistoryMessage[];
  settings: AiSettings;
  agent?: string;
  reasoning?: string;
}

const APPROVAL_TTL_MS = 10 * 60 * 1000;

export interface PendingToolApproval {
  id: string;
  conversationId: string;
  toolCall: ToolCall;
  reason: string;
  createdAt: number;
  expiresAt: number;
  resume?: ApprovalResumeContext;
  scopePath?: string;
}

interface ApprovalGrant {
  conversationId: string;
  toolName: string;
  scopePath: string;
  expiresAt: number;
}

export type ApprovalAction = 'approve' | 'deny';

/**
 * 管理进程内的一次性工具审批请求。
 * @returns 创建、消费和查询审批请求的方法
 */
export class ToolApprovalStore {
  private readonly pending = new Map<string, PendingToolApproval>();
  private readonly grants: ApprovalGrant[] = [];

  /**
   * 创建审批请求并返回一次性 ID。
   * @param request 审批请求数据
   * @returns 审批 ID
   */
  create(request: Omit<PendingToolApproval, 'id' | 'createdAt' | 'expiresAt'>): string {
    const now = Date.now();
    const id = randomUUID();
    this.pending.set(id, {
      ...request,
      id,
      createdAt: now,
      expiresAt: now + APPROVAL_TTL_MS,
    });
    return id;
  }

  /**
   * 校验并一次性消费审批请求。
   * @param conversationId 会话 ID
   * @param id 审批 ID
   * @param action 用户动作
   * @returns 原始审批请求；无效、过期或重复消费时返回 undefined
   */
  consume(
    conversationId: string,
    id: string,
    action: ApprovalAction,
  ): PendingToolApproval | undefined {
    void action;
    const request = this.pending.get(id);
    if (!request || request.conversationId !== conversationId || request.expiresAt <= Date.now()) {
      if (request && request.expiresAt <= Date.now()) this.pending.delete(id);
      return undefined;
    }
    this.pending.delete(id);
    if (
      action === 'approve' &&
      request.scopePath &&
      request.scopePath !== path.parse(request.scopePath).root
    ) {
      this.grants.push({
        conversationId,
        toolName: request.toolCall.function.name,
        scopePath: request.scopePath,
        expiresAt: request.expiresAt,
      });
    }
    return {
      ...request,
      toolCall: { ...request.toolCall, function: { ...request.toolCall.function } },
    };
  }

  /**
   * Check whether a conversation has an unexpired directory grant for a tool call.
   * @param conversationId Conversation owning the grant
   * @param toolCall Candidate tool call
   * @returns Whether the call is inside an approved directory
   */
  isGranted(conversationId: string, toolCall: ToolCall): boolean {
    const targetPath = getApprovalScopePath(toolCall);
    if (!targetPath) return false;
    const now = Date.now();
    for (let index = this.grants.length - 1; index >= 0; index -= 1) {
      const grant = this.grants[index];
      if (grant.expiresAt <= now) {
        this.grants.splice(index, 1);
        continue;
      }
      if (
        grant.conversationId === conversationId &&
        grant.toolName === toolCall.function.name &&
        isPathWithin(targetPath, grant.scopePath)
      )
        return true;
    }
    return false;
  }

  /**
   * 清理过期请求并返回当前待审批数量。
   * @returns 待审批数量
   */
  size(): number {
    for (const [id, request] of this.pending) {
      if (request.expiresAt <= Date.now()) this.pending.delete(id);
    }
    return this.pending.size;
  }

  /**
   * 清空 store，供测试隔离使用。
   */
  clear(): void {
    this.pending.clear();
    this.grants.length = 0;
  }
}

/**
 * Extract the directory affected by a Bash tool call for scoped approval.
 * @param toolCall Bash tool call
 * @returns Normalized absolute path when one can be identified
 */
export function getApprovalScopePath(toolCall: ToolCall): string | undefined {
  if (toolCall.function.name !== 'bash') return undefined;
  let input: { command?: string; cwd?: string };
  try {
    input = JSON.parse(toolCall.function.arguments) as { command?: string; cwd?: string };
  } catch {
    return undefined;
  }
  if (input.cwd && path.isAbsolute(input.cwd)) return path.normalize(input.cwd);
  const absolutePath = input.command?.match(/(?:^|[\s"'=])((?:\/[A-Za-z0-9._~-]+)+\/?)/)?.[1];
  return absolutePath ? path.normalize(absolutePath) : undefined;
}

function isPathWithin(targetPath: string, scopePath: string): boolean {
  const relative = path.relative(scopePath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export const toolApprovalStore = new ToolApprovalStore();
