import { callEndpoint } from './_base';

export type ToolApprovalAction = 'approve' | 'deny';

export interface ToolApprovalResult {
  status: 'completed' | 'failed' | 'denied';
  approvalId: string;
  toolName: string;
  reason?: string;
  result?: unknown;
  error?: string;
  continuation?: {
    content: string;
    reasoning: string;
    events: Array<Record<string, unknown>>;
  };
}

/**
 * 消费一次工具审批请求。
 * @param conversationId 会话 ID
 * @param approvalId 审批 ID
 * @param action 批准或拒绝
 * @returns 审批消费结果
 */
export function resolveToolApproval(
  conversationId: string,
  approvalId: string,
  action: ToolApprovalAction,
): Promise<ToolApprovalResult> {
  return callEndpoint<ToolApprovalResult>(
    'conversations:resolveToolApproval',
    conversationId,
    approvalId,
    { action },
  );
}
