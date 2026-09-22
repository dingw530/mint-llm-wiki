import * as conversationService from '../../services/api/conversationService.js';
import { httpError } from '../helpers.js';
import type { Request, Response } from 'express';
import type { EndpointDescriptor } from '../types.js';
import { ResSink } from '../../services/sink.js';

/** 延迟加载摄入事件流，避免生成 endpoint manifest 时初始化摄入服务。 */
async function streamIngestionEvents(
  conversationId: string,
  req: Request,
  res: Response,
): Promise<void> {
  const module = await import('../../services/api/ingestionEventsService.js');
  module.streamConversationIngestionEvents(conversationId, req, res);
}

/** 延迟加载审批服务，避免其工具注册依赖在生成 endpoint manifest 时初始化。 */
async function resolveApproval(
  conversationId: string,
  approvalId: string,
  action: 'approve' | 'deny',
) {
  const module = await import('../../services/api/toolApprovalService.js');
  return module.resolveToolApproval(conversationId, approvalId, action);
}

/** Loads recovery state lazily so endpoint manifest generation remains side-effect free. */
async function listRecoverableRuns(conversationId: string) {
  const module = await import('../../services/agentRunRecoveryService.js');
  return { runs: module.listRecoverableRuns(conversationId) };
}

/** Validates and reserves a recovery decision through the domain service. */
async function resolveRecoveryAction(
  conversationId: string,
  runId: string,
  data: Record<string, unknown>,
) {
  const action = data.action;
  const idempotencyKey = data.idempotencyKey;
  if (action !== 'continue' && action !== 'retry' && action !== 'abandon') {
    throw httpError(400, 'Recovery action must be "continue", "retry", or "abandon"');
  }
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    throw httpError(400, 'Recovery idempotencyKey is required');
  }
  const module = await import('../../services/agentRunRecoveryService.js');
  const recoveryAction = module.resolveRecoveryAction({
    conversationId,
    runId,
    action,
    idempotencyKey,
    confirmation: data.confirmation === true,
  });
  if (action === 'abandon') {
    return { action: module.completeRecoveryAction(recoveryAction.id) };
  }
  return { action: recoveryAction };
}

/** Streams a previously reserved recovery action through the ordinary chat SSE transport. */
async function streamRecoveryAction(
  conversationId: string,
  actionId: string,
  req: Request,
  res: Response,
): Promise<void> {
  req.on('close', () => {
    if (res.headersSent && !res.writableEnded) res.end();
  });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const module = await import('../../services/messageService.js');
  await module.streamRecoveryAction(conversationId, actionId, new ResSink(res));
}

export const conversationsEndpoints: EndpointDescriptor[] = [
  {
    id: 'conversations:listRecoverableRuns',
    method: 'GET',
    path: '/:id/agent-runs/recoverable',
    preloadMethod: 'getRecoverableAgentRuns',
    service: listRecoverableRuns,
    args: [{ from: 'path', name: 'id' }],
    async: true,
    result: 'direct',
  },
  {
    id: 'conversations:resolveRecoveryAction',
    method: 'POST',
    path: '/:id/agent-runs/:runId/recovery-actions',
    preloadMethod: 'resolveAgentRunRecovery',
    service: resolveRecoveryAction,
    args: [
      { from: 'path', name: 'id' },
      { from: 'path', name: 'runId' },
      { from: 'body', name: '' },
    ],
    async: true,
    result: 'direct',
  },
  {
    id: 'conversations:streamRecoveryAction',
    method: 'POST',
    path: '/:id/agent-runs/recovery-actions/:actionId/stream',
    service: streamRecoveryAction,
    args: [
      { from: 'path', name: 'id' },
      { from: 'path', name: 'actionId' },
    ],
    async: true,
    stream: true,
  },
  {
    id: 'conversations:resolveToolApproval',
    method: 'POST',
    path: '/:id/tool-approvals/:approvalId',
    preloadMethod: 'resolveToolApproval',
    service: async (id: string, approvalId: string, data: Record<string, unknown>) => {
      const action = data?.action;
      if (action !== 'approve' && action !== 'deny') {
        throw httpError(400, 'Approval action must be "approve" or "deny"');
      }
      return resolveApproval(id, approvalId, action);
    },
    args: [
      { from: 'path', name: 'id' },
      { from: 'path', name: 'approvalId' },
      { from: 'body', name: '' },
    ],
    async: true,
    result: 'direct',
  },
  {
    id: 'conversations:ingestionEvents',
    method: 'GET',
    path: '/:id/ingestion-events',
    service: streamIngestionEvents,
    args: [{ from: 'path', name: 'id' }],
    async: true,
    stream: true,
  },
  {
    id: 'conversations:list',
    method: 'GET',
    path: '/',
    preloadMethod: 'getConversations',
    service: (type?: string) => ({ conversations: conversationService.list(type) }),
    args: [{ from: 'query', name: 'type', optional: true }],
    result: 'direct',
  },
  {
    id: 'conversations:create',
    method: 'POST',
    path: '/',
    preloadMethod: 'createConversation',
    service: (
      title?: string,
      type?: string,
    ): { conversation: ReturnType<typeof conversationService.create> } => {
      if (title !== undefined && typeof title !== 'string') {
        throw httpError(400, 'Title must be a string');
      }
      if (type !== undefined && type !== 'text') {
        throw httpError(400, 'Type must be "text"');
      }
      return { conversation: conversationService.create({ title, type }) };
    },
    args: [
      { from: 'body', name: 'title', optional: true },
      { from: 'body', name: 'type', optional: true },
    ],
    result: 'direct',
  },
  {
    id: 'conversations:delete',
    method: 'DELETE',
    path: '/:id',
    preloadMethod: 'deleteConversation',
    service: (id: string) => conversationService.remove(id),
    args: [{ from: 'path', name: 'id' }],
    result: 'direct',
  },
  {
    id: 'conversations:clearAll',
    method: 'DELETE',
    path: '/',
    preloadMethod: '',
    service: () => conversationService.removeAll(),
    args: [],
    result: 'direct',
  },
  {
    // 合并 rename + lockAgent（Express 不允许同路径同方法注册两个 handler）
    id: 'conversations:patch',
    method: 'PATCH',
    path: '/:id',
    preloadMethod: 'patchConversation',
    service: (
      id: string,
      data: Record<string, unknown>,
    ): {
      conversation:
        | ReturnType<typeof conversationService.rename>
        | ReturnType<typeof conversationService.setLockedAgent>;
    } => {
      if (data?.lockedAgent !== undefined) {
        return { conversation: conversationService.setLockedAgent(id, data.lockedAgent as string) };
      }
      return { conversation: conversationService.rename(id, data.title as string) };
    },
    args: [
      { from: 'path', name: 'id' },
      { from: 'body', name: '' },
    ],
    result: 'direct',
  },
];

// ── 供 IPC 独立使用的 rename 和 lockAgent（IPC 允许同 channel 前缀不同 action） ──

export const conversationsIpcOnlyEndpoints: EndpointDescriptor[] = [
  {
    id: 'conversations:rename',
    ipcChannel: 'conversations:rename',
    method: 'PATCH',
    path: '/', // 不会用于 Express 路由
    preloadMethod: 'renameConversation',
    service: (id: string, title: string) => ({
      conversation: conversationService.rename(id, title),
    }),
    args: [
      { from: 'path', name: 'id' },
      { from: 'body', name: 'title' },
    ],
    result: 'direct',
  },
  {
    id: 'conversations:lockAgent',
    ipcChannel: 'conversations:lockAgent',
    method: 'PATCH',
    path: '/', // 不会用于 Express 路由
    preloadMethod: 'lockAgent',
    service: (id: string, agentId: string) => ({
      conversation: conversationService.setLockedAgent(id, agentId),
    }),
    args: [
      { from: 'path', name: 'id' },
      { from: 'body', name: 'lockedAgent' },
    ],
    result: 'direct',
  },
];
