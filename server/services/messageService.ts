import { v4 as uuidv4 } from 'uuid';
import * as conversationRepo from '../repositories/conversationRepository.js';
import * as messageRepo from '../repositories/messageRepository.js';
import * as settingsService from './api/settingsService.js';
import * as memoryService from './api/memoryService.js';
import { enqueueMemoryProcessing } from './api/memoryJobService.js';
import * as agentService from './api/agentService.js';
import { routingService } from './api/routingService.js';
import { streamChat } from './aiProxy.js';
import { reactChat } from './reactLoopCore.js';
import { getAllToolDefinitions } from './toolOrchestration.js';
import type { HttpError, HistoryMessage } from '../types.js';
import { DeferredEndSink } from './sink.js';
import type { Sink } from './sink.js';
import { parseFile, isSupportedFile } from './utils/fileParseService.js';
import { streamToolApproval } from './api/toolApprovalService.js';
import { AI_REQUEST_TIMEOUT_MS } from './adapters/apiAdapter.js';
import * as a2uiRepository from '../repositories/a2uiRepository.js';
import type { PersistedUiBlock } from '../types.js';
import { applyContextProviders } from './contextProvider.js';
import { type AgentRun, agentRunRegistry } from './agentRun.js';
import { createDurableAgentRun } from './agentRunFactory.js';
import { ReactEventEmitter } from './reactEvents.js';
import {
  buildSlashCommandContext,
  validateSlashCommand,
  type SlashCommandIntent,
} from './api/slashCommandService.js';
import {
  claimRecoveryAction,
  completeRecoveryAction,
  recoverAgentRun,
} from './agentRunRecoveryService.js';

export function getMessages(conversationId: string) {
  const conversation = conversationRepo.findById(conversationId);
  if (!conversation) {
    const err: HttpError = new Error('Conversation not found');
    err.status = 404;
    throw err;
  }
  return messageRepo.findByConversationId(conversationId).map((message) => ({
    ...message,
    uiBlocks: a2uiRepository.findUiBlocksByMessageId(message.id),
  }));
}

function persistUiBlocks(messageId: string, blocks: PersistedUiBlock[] | undefined): void {
  if (!blocks || blocks.length === 0) return;
  blocks.forEach((block, index) => {
    try {
      a2uiRepository.createUiBlock({
        ...block,
        messageId,
        blockIndex: index,
      });
    } catch (error) {
      console.error('[a2ui] failed to persist UI block', {
        messageId,
        blockId: block.id,
        kind: block.kind,
        version: block.version,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * Resume an approved tool call through the normal chat SSE stream.
 * @param conversationId Conversation owning the approval
 * @param approvalId One-time approval identifier
 * @param action Approval decision
 * @param sink Chat SSE sink
 */
export function resumeToolApproval(
  conversationId: string,
  approvalId: string,
  action: 'approve' | 'deny',
  sink: Sink,
): Promise<void> {
  return streamToolApproval(conversationId, approvalId, action, sink);
}

/** Streams a one-time, user-confirmed retry from its durable message reference. */
export async function streamRecoveryAction(
  conversationId: string,
  actionId: string,
  sink: Sink,
): Promise<void> {
  const action = claimRecoveryAction(actionId);
  if (action.conversationId !== conversationId || !action.successorRunId) {
    throw new Error('Recovery action does not belong to this conversation');
  }
  const origin = recoverAgentRun(action.originRunId);
  if (!origin.originMessageId || !origin.executionMode) {
    throw new Error('AgentRun has no recoverable execution reference');
  }
  const history = messageRepo.getHistoryThroughMessageId(conversationId, origin.originMessageId);
  const settings = settingsService.getAiSettings();
  const agentInfo = origin.agentId ? agentService.findById(origin.agentId) : undefined;
  const systemPrompt = agentInfo?.systemPrompt || settings.systemPrompt;
  const requestMessages: HistoryMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...history]
    : history;
  const run = createDurableAgentRun({
    runId: action.successorRunId,
    conversationId,
    originMessageId: origin.originMessageId,
    ...(origin.agentId ? { agentId: origin.agentId } : {}),
    executionMode: origin.executionMode,
  });
  agentRunRegistry.register(run);
  new ReactEventEmitter(run).emit({ type: 'run_started', state: 'running' });
  try {
    if (origin.executionMode === 'react') {
      await reactChat(
        requestMessages,
        settings,
        sink,
        origin.agentId,
        undefined,
        conversationId,
        undefined,
        run,
      );
    } else {
      await streamChat(requestMessages, settings, sink, origin.agentId, conversationId, run);
    }
  } finally {
    completeRecoveryAction(actionId);
  }
}

// 发送消息：保存用户消息 → 路由决策 → 拼接历史 → SSE 流式调用 AI → 保存 AI 回复
interface FileAttachment {
  name: string;
  content: string; // Base64
  type?: string;
}

export async function sendMessage(
  conversationId: string,
  content: string,
  sink: Sink,
  agent?: string,
  regenerate?: boolean,
  files?: FileAttachment[],
  slashCommand?: SlashCommandIntent,
): Promise<void> {
  const deferredSink = new DeferredEndSink(sink);
  const conversation = conversationRepo.findById(conversationId);
  if (!conversation) {
    const err: HttpError = new Error('Conversation not found');
    err.status = 404;
    throw err;
  }
  const validatedSlashCommand =
    slashCommand === undefined ? undefined : validateSlashCommand(slashCommand);
  if (slashCommand !== undefined && !validatedSlashCommand) {
    const err: HttpError = new Error('Invalid slash command or empty command input');
    err.status = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const userMsgId = uuidv4();

  // 处理文件附件：解析文件并追加到消息内容
  let augmentedContent = content;
  if (files && files.length > 0) {
    const fileParts: string[] = [];
    for (const file of files) {
      if (!isSupportedFile(file.name)) {
        fileParts.push(`\n[文件 ${file.name}] 不支持的文件类型，已跳过`);
        continue;
      }
      try {
        const buffer = Buffer.from(file.content, 'base64');
        const result = await parseFile({ name: file.name, content: buffer, size: buffer.length });
        fileParts.push(`\n--- 上传文件：${file.name} ---\n${result.text}\n--- 文件结束 ---`);
      } catch (err) {
        fileParts.push(`\n[文件 ${file.name}] 解析失败: ${(err as Error).message}`);
      }
    }
    if (fileParts.length > 0) {
      augmentedContent =
        (content || '') + '\n\n以下是从上传文件中提取的内容：\n' + fileParts.join('\n');
    }
  }

  // 先持久化用户消息（非重新生成场景），确保不丢失
  if (!regenerate) {
    messageRepo.create({
      id: userMsgId,
      conversationId,
      role: 'user',
      content: augmentedContent,
      createdAt: now,
    });
    messageRepo.updateConversationTimestamp(conversationId, now);
  }

  // ── 路由决策 ──
  // 优先级：前端显式指定 > lockedAgent > 自动路由 > 默认 general
  let resolvedAgent = agent;

  if (!resolvedAgent) {
    if (conversation.lockedAgent) {
      // 对话已锁定 Agent
      resolvedAgent = conversation.lockedAgent;
    } else if (conversation.routingMode !== 'manual') {
      // 自动模式：调用路由引擎
      try {
        const agents = agentService.list();
        const routeResult = await routingService.route(content, {
          agents,
          lockedAgent: conversation.lockedAgent,
          routingMode: conversation.routingMode,
          conversationId,
          messageId: userMsgId,
          messagePreview: content.substring(0, 50),
        });
        resolvedAgent = routeResult.agentId;
      } catch (err) {
        console.error('[routing] routing failed, fallback to general:', err);
        resolvedAgent = 'general';
      }
    }
    // manual 模式下不传 agent → 默认通用助手
  }

  // 拼接消息历史：优先使用路由到的 Agent 的 systemPrompt，其次用全局设置
  const history = messageRepo.getHistory(conversationId);
  const settings = settingsService.getAiSettings();

  let systemPrompt = settings.systemPrompt;
  if (resolvedAgent && resolvedAgent !== 'general') {
    const agentInfo = agentService.findById(resolvedAgent);
    if (agentInfo?.systemPrompt) {
      systemPrompt = agentInfo.systemPrompt;
    }
  }
  if (validatedSlashCommand)
    systemPrompt = [systemPrompt, buildSlashCommandContext(validatedSlashCommand)]
      .filter(Boolean)
      .join('\n\n');

  const messages: HistoryMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...history]
    : history;
  const requestMessages = applyContextProviders(messages, { settings, userContent: content });

  try {
    // 判断是否启用 ReAct 循环：Agent 有工具 且 reactMaxIterations > 0
    const agentTools = resolvedAgent ? await getAllToolDefinitions(resolvedAgent) : [];
    const useReact = agentTools.length > 0 && settings.reactMaxIterations > 0;

    // 编排 Agent 设置 120s 总超时（BR-052 / AC-070）
    let orchestratorSignal: AbortSignal | undefined;
    let orchestratorTimer: ReturnType<typeof setTimeout> | undefined;
    if (useReact && resolvedAgent) {
      const agentInfo = agentService.findById(resolvedAgent);
      if (agentInfo?.type === 'orchestrator') {
        const controller = new AbortController();
        orchestratorTimer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
        orchestratorSignal = controller.signal;
      }
    }

    const {
      content: fullContent,
      reasoning: fullReasoning,
      uiBlocks: fullUiBlocks,
    } = useReact
      ? await reactChat(
          requestMessages,
          settings,
          deferredSink,
          resolvedAgent,
          orchestratorSignal,
          conversationId,
          undefined,
          createRegisteredRun(
            conversationId,
            regenerate ? undefined : userMsgId,
            resolvedAgent,
            'react',
          ),
        )
      : await streamChat(
          requestMessages,
          settings,
          deferredSink,
          resolvedAgent,
          conversationId,
          createRegisteredRun(
            conversationId,
            regenerate ? undefined : userMsgId,
            resolvedAgent,
            'stream',
          ),
        );

    clearTimeout(orchestratorTimer);
    // AI 回复完成后持久化（流式结束时才写入）
    if (fullContent) {
      const assistantMessageId = uuidv4();
      messageRepo.create({
        id: assistantMessageId,
        conversationId,
        role: 'assistant',
        content: fullContent,
        reasoning: fullReasoning || null,
        createdAt: new Date().toISOString(),
      });
      persistUiBlocks(assistantMessageId, fullUiBlocks);

      // 异步提取记忆（v1.5.1 增加价值判断预检查）
      if (settings.memoryEnabled) {
        if (memoryService.isConversationValuable(content)) {
          enqueueMemoryProcessing(conversationId, assistantMessageId);
        }
      }
    }
    deferredSink.flush();
  } catch (err) {
    console.error('AI streaming error:', err);
    if (!deferredSink.writableEnded) {
      deferredSink.write(JSON.stringify({ error: 'AI streaming failed' }));
      deferredSink.end();
    }
    deferredSink.flush();
  }
}

/** Creates the process-local run that owns one user-visible chat invocation. */
function createRegisteredRun(
  conversationId: string,
  originMessageId: string | undefined,
  agentId: string | undefined,
  executionMode: 'react' | 'stream',
): AgentRun {
  const run = createDurableAgentRun({
    runId: uuidv4(),
    conversationId,
    ...(originMessageId ? { originMessageId } : {}),
    ...(agentId ? { agentId } : {}),
    executionMode,
  });
  agentRunRegistry.register(run);
  return run;
}
