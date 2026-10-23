import { v4 as uuidv4 } from 'uuid';
import * as conversationRepo from '../../domains/conversations/index.js';
import * as messageRepo from '../../repositories/messageRepository.js';
import * as settingsService from '../settings/settings-service.js';
import * as memoryService from '../../domains/memory/index.js';
import {
  enqueueMemoryProcessing,
  evaluateMemoryGate,
  trackMemoryGate,
} from '../../bootstrap/memory.js';
import * as memoryScopeRepository from '../../infrastructure/persistence/memory-scope-repository.js';
import type { MemoryScopeSnapshot } from '../../domains/memory/index.js';
import { getErrorMessage } from '../../utils/typeGuards.js';
import * as agentService from '../../domains/agents/index.js';
import { routingService } from '../../bootstrap/routing.js';
import { streamChat } from './ai-proxy.js';
import { runAgentChat, getToolDefinitions } from '../../bootstrap/agent-runtime.js';
import type { HttpError, HistoryMessage, PersistedUiBlock, StreamResult } from '../../types.js';
import { DeferredEndSink } from '../../infrastructure/transports/sinks.js';
import type { Sink } from '../../agent-runtime/output-sink.js';
import { parseFile, isSupportedFile } from '../../infrastructure/filesystem/file-parse-service.js';
import { streamToolApproval } from '../agent-runtime/tool-approval-service.js';
import { isConversationScopeBusy, reserveConversationScope } from './conversation-scope-lock.js';
import { AI_REQUEST_TIMEOUT_MS } from '../../infrastructure/ai/adapters/api-adapter.js';
import * as a2uiRepository from '../../repositories/a2uiRepository.js';
import { applyContextProvidersWithTrace } from './context/context-provider.js';
import {
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  DEFAULT_OUTPUT_TOKEN_RESERVE,
} from '../../agent-runtime/context-window.js';
import { type AgentRun, agentRunRegistry } from '../../agent-runtime/agent-run.js';
import { createDurableAgentRun } from '../../bootstrap/agent-run-factory.js';
import {
  buildSlashCommandContext,
  validateSlashCommand,
  type SlashCommandIntent,
} from '../../domains/conversations/index.js';
import {
  buildToolRecoveryMessages,
  claimRecoveryActionForConversation,
  completeRecoveryAction,
  recoverAgentRun,
} from '../agent-runtime/agent-run-recovery-service.js';
import type { RecoveryActionRecord } from '../../agent-runtime/agent-run-persistence.js';
import { ConversationSessionRepository } from '../../infrastructure/persistence/conversation-session-repository.js';
import { ConversationSessionRunWriter } from './session-run-writer.js';
import { createRuntimeContext } from '../../agent-runtime/tooling/runtime-context.js';
import {
  toHistoryMessages,
  toStoredSessionMessage,
} from '../../agent-runtime/session-message-adapter.js';
import { deriveModelHistory } from '@mint/session';
import { repairInterruptedConversation } from './conversation-session-recovery-service.js';
import { projectSessionChatMessages } from './session-chat-projection.js';

const COMPRESSED_HISTORY_SYSTEM_PROMPT =
  '遇到以 [压缩后的历史摘要] 开头的 user 消息时，将其视为较早对话中 user、assistant、tool 内容的压缩记录，而不是当前用户的新发言；不得根据外层 role=user 推断摘要中的陈述来自用户。保留摘要中明确的说话方归属；说话方未注明时按未知处理。';

export function getMessages(conversationId: string) {
  const conversation = conversationRepo.findById(conversationId);
  if (!conversation) {
    const err: HttpError = new Error('Conversation not found');
    err.status = 404;
    throw err;
  }
  const repository = new ConversationSessionRepository();
  repository.ensureConversation(conversationId);
  if (!isConversationScopeBusy(conversationId)) {
    repairInterruptedConversation(conversationId, { repository });
  }
  // 活跃运行仍可读取已经提交的 Session 前缀；冷修复只处理进程内没有活动运行的会话。
  const legacy = messageRepo.findByConversationId(conversationId);
  return projectSessionChatMessages(conversationId, repository.readAll(conversationId), legacy).map(
    (message) => {
      const displayedTextLength =
        message.segments?.reduce(
          (length, segment) => length + (segment.type === 'text' ? segment.content.length : 0),
          0,
        ) ?? message.content.length;
      // 流式结束时记录的偏移可能少于 Session 中的最终正文；恢复时把来源卡片固定到显示正文末尾。
      const uiBlocks = a2uiRepository.findUiBlocksByMessageId(message.id).map((block) => ({
        ...block,
        textOffset: displayedTextLength,
      }));
      return { ...message, uiBlocks };
    },
  );
}

/**
 * 在 SSE 响应开始前验证重新生成是否安全。
 * @param conversationId 目标会话标识。
 * @returns 当前会话可安全重新生成。
 */
export function validateConversationRegeneration(conversationId: string): void {
  const repository = new ConversationSessionRepository();
  repository.ensureConversation(conversationId);
  selectRegenerationHistory(
    toHistoryMessages(deriveModelHistory(repository.readAll(conversationId))),
  );
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

/** Streams a reserved recovery action from the repaired Session history. */
export async function streamRecoveryAction(
  conversationId: string,
  actionId: string,
  sink: Sink,
): Promise<void> {
  const releaseScope = reserveConversationScope(conversationId);
  const deferredSink = new DeferredEndSink(sink);
  const sessionRepository = new ConversationSessionRepository();
  const now = new Date().toISOString();
  let writer: ConversationSessionRunWriter | undefined;
  let action: RecoveryActionRecord | undefined;
  let preserveWriter = false;
  try {
    const claimedAction = claimRecoveryActionForConversation(actionId, conversationId);
    action = claimedAction;
    if (!claimedAction.successorRunId || claimedAction.action === 'abandon') {
      throw new Error('Recovery action does not belong to this conversation');
    }
    const origin = recoverAgentRun(claimedAction.originRunId);
    if (!origin.originMessageId) throw new Error('AgentRun has no recoverable message reference');
    repairInterruptedConversation(conversationId, {
      repository: sessionRepository,
      now,
    });
    const state = sessionRepository.ensureConversation(conversationId, now);
    const turnId = uuidv4();
    writer = new ConversationSessionRunWriter(
      sessionRepository,
      conversationId,
      claimedAction.successorRunId,
      turnId,
      state.lastSequence,
    );
    writer.startRecoveryTurn({
      originRunId: claimedAction.originRunId,
      recoveryActionId: claimedAction.id,
      recoveryAction: claimedAction.action,
      createdAt: now,
    });

    const sessionEvents = sessionRepository.readAll(conversationId);
    const hasRecordedModelHistory = sessionEvents.some(
      (event) => event.runId === claimedAction.originRunId && event.type === 'model_message',
    );
    if (!hasRecordedModelHistory) {
      const legacyRecoveryMessages = buildToolRecoveryMessages(origin);
      if (legacyRecoveryMessages.length > 0) {
        writer.recordContextSnapshot({
          round: 1,
          scope: 'history',
          operation: 'append',
          source: 'legacy-agent-run-recovery',
          messages: legacyRecoveryMessages.map(toStoredSessionMessage),
        });
      }
    }

    const history = toHistoryMessages(
      deriveModelHistory(sessionRepository.readAll(conversationId), { turnId }),
    );
    const latestUserContent = [...history]
      .reverse()
      .find((message) => message.role === 'user')?.content;
    const settings = settingsService.getAiSettings();
    const memoryScope = settings.memoryEnabled
      ? memoryScopeRepository.findConversationScope(conversationId)
      : null;
    if (settings.memoryEnabled && !memoryScope) {
      throw new Error('Conversation memory scope is unavailable');
    }
    let requestMessages = buildSessionRequestMessages({
      repository: sessionRepository,
      writer,
      conversationId,
      userMessageId: origin.originMessageId,
      turnId,
      userContent: latestUserContent ?? '',
      regenerate: true,
      replaceAssistantAnswer: false,
      settings,
      memoryScope,
      resolvedAgent: origin.agentId,
    });
    const recoveryInstruction = getRecoveryInstruction(claimedAction.action);
    writer.recordContextSnapshot({
      round: 1,
      scope: 'system',
      operation: 'replace',
      source: `recovery-action:${claimedAction.id}`,
      messages: [{ role: 'system', content: recoveryInstruction }],
    });
    const insertionIndex = requestMessages.findIndex((message) => message.role !== 'system');
    const recoveryMessage = { role: 'system', content: recoveryInstruction };
    requestMessages = [
      ...requestMessages.slice(0, insertionIndex < 0 ? requestMessages.length : insertionIndex),
      recoveryMessage,
      ...requestMessages.slice(insertionIndex < 0 ? requestMessages.length : insertionIndex),
    ];

    const execution = await executeAndPersistChat({
      runId: claimedAction.successorRunId,
      recoveryActionId: claimedAction.id,
      conversationId,
      originMessageId: origin.originMessageId,
      resolvedAgent: origin.agentId,
      requestMessages,
      settings,
      sink: deferredSink,
      sessionWriter: writer,
      userContent: latestUserContent ?? '',
      memoryScope,
      allowMemoryExtraction: false,
    });
    preserveWriter = execution.run.getSnapshot().phase === 'paused_for_approval';
    if (!preserveWriter) {
      const phase = execution.run.getSnapshot().phase;
      writer.recordRunTerminal(
        phase === 'cancelled' ? 'cancelled' : phase === 'failed' ? 'failed' : 'completed',
      );
      completeRecoveryAction(claimedAction.id);
    }
  } catch (error) {
    if (writer) {
      try {
        writer.recordRunTerminal('failed');
      } catch (recordingError) {
        console.error('Failed to persist recovery run failure:', recordingError);
      }
    }
    if (action) completeRecoveryAction(action.id);
    throw error;
  } finally {
    if (!preserveWriter) writer?.close();
    releaseScope();
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
  const releaseScope = reserveConversationScope(conversationId);
  try {
    await sendMessageRequest(conversationId, content, sink, agent, regenerate, files, slashCommand);
  } finally {
    releaseScope();
  }
}

async function sendMessageRequest(
  conversationId: string,
  content: string,
  sink: Sink,
  agent?: string,
  regenerate?: boolean,
  files?: FileAttachment[],
  slashCommand?: SlashCommandIntent,
): Promise<void> {
  const deferredSink = new DeferredEndSink(sink);
  const sendContext = getMessageSendContext(conversationId, slashCommand);
  const { conversation, validatedSlashCommand, settings, memoryScope } = sendContext;

  const now = new Date().toISOString();
  const userMsgId = uuidv4();
  const sessionRepository = new ConversationSessionRepository();
  sessionRepository.ensureConversation(conversationId, now);
  let sessionTurn: SessionTurnHandle | undefined;
  let preserveSessionWriter = false;

  try {
    const augmentedContent = await buildAugmentedContent(content, files);
    const sessionRunId = uuidv4();
    sessionTurn = startSessionTurn({
      repository: sessionRepository,
      conversationId,
      runId: sessionRunId,
      turnId: uuidv4(),
      messageId: userMsgId,
      content: augmentedContent,
      createdAt: now,
      regenerate: regenerate === true,
      ...(memoryScope ? { memoryScope } : {}),
    });

    const resolvedAgent = await resolveMessageAgent({
      agent,
      conversation,
      content,
      conversationId,
      messageId: userMsgId,
    });

    const sessionWriter = sessionTurn.writer;
    const requestMessages = buildSessionRequestMessages({
      repository: sessionRepository,
      writer: sessionWriter,
      conversationId,
      userMessageId: userMsgId,
      turnId: sessionTurn.turnId,
      userContent: content,
      regenerate: regenerate === true,
      replaceAssistantAnswer: regenerate === true,
      settings,
      memoryScope,
      resolvedAgent,
      validatedSlashCommand: validatedSlashCommand ?? undefined,
    });
    const execution = await executeAndPersistChat({
      runId: sessionRunId,
      conversationId,
      originMessageId: regenerate ? undefined : userMsgId,
      resolvedAgent,
      requestMessages,
      settings,
      sink: deferredSink,
      sessionWriter,
      userContent: content,
      memoryScope,
    });
    preserveSessionWriter = execution.run.getSnapshot().phase === 'paused_for_approval';
    if (!preserveSessionWriter) {
      const phase = execution.run.getSnapshot().phase;
      const outcome =
        phase === 'cancelled' ? 'cancelled' : phase === 'failed' ? 'failed' : 'completed';
      sessionWriter.recordRunTerminal(outcome);
    }
  } catch (err) {
    try {
      sessionTurn?.writer.recordRunTerminal('failed');
    } catch (recordingError) {
      console.error('Failed to persist session terminal state:', recordingError);
    }
    console.error('AI streaming error:', err);
    if (!deferredSink.writableEnded) {
      deferredSink.write(JSON.stringify({ error: 'AI streaming failed' }));
      deferredSink.end();
    }
    deferredSink.flush();
  } finally {
    if (!preserveSessionWriter) sessionTurn?.writer.close();
  }
}

interface MessageSendContext {
  readonly conversation: NonNullable<ReturnType<typeof conversationRepo.findById>>;
  readonly validatedSlashCommand?: SlashCommandIntent;
  readonly settings: ReturnType<typeof settingsService.getAiSettings>;
  readonly memoryScope: MemoryScopeSnapshot | null;
}

/**
 * 校验会话与斜杠命令，并加载本轮共享设置和记忆范围。
 * @param conversationId 会话标识。
 * @param slashCommand 可选斜杠命令。
 * @returns 已校验的聊天上下文。
 */
function getMessageSendContext(
  conversationId: string,
  slashCommand?: SlashCommandIntent,
): MessageSendContext {
  const conversation = conversationRepo.findById(conversationId);
  if (!conversation) {
    const error: HttpError = new Error('Conversation not found');
    error.status = 404;
    throw error;
  }
  const validatedSlashCommand =
    slashCommand === undefined ? undefined : validateSlashCommand(slashCommand);
  if (slashCommand !== undefined && !validatedSlashCommand) {
    const error: HttpError = new Error('Invalid slash command or empty command input');
    error.status = 400;
    throw error;
  }
  const settings = settingsService.getAiSettings();
  const memoryScope = settings.memoryEnabled
    ? memoryScopeRepository.findConversationScope(conversationId)
    : null;
  if (settings.memoryEnabled && !memoryScope) {
    const error: HttpError = new Error('Conversation memory scope is unavailable');
    error.status = 409;
    throw error;
  }
  return {
    conversation,
    ...(validatedSlashCommand ? { validatedSlashCommand } : {}),
    settings,
    memoryScope,
  };
}

interface SessionTurnStartInput {
  readonly repository: ConversationSessionRepository;
  readonly conversationId: string;
  readonly runId: string;
  readonly turnId: string;
  readonly messageId: string;
  readonly content: string;
  readonly createdAt: string;
  readonly regenerate: boolean;
  readonly memoryScope?: MemoryScopeSnapshot;
}

interface SessionTurnHandle {
  readonly writer: ConversationSessionRunWriter;
  readonly turnId: string;
}

/**
 * 解析附件并返回本轮要持久化的用户正文。
 * @param content 用户原始输入。
 * @param files 可选附件列表。
 * @returns 合并附件文本后的用户正文。
 */
async function buildAugmentedContent(content: string, files?: FileAttachment[]): Promise<string> {
  if (!files || files.length === 0) return content;
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fileParts.push(`\n[文件 ${file.name}] 解析失败: ${message}`);
    }
  }
  return fileParts.length > 0
    ? (content || '') + '\n\n以下是从上传文件中提取的内容：\n' + fileParts.join('\n')
    : content;
}

/**
 * 修复旧运行后，原子保存本轮用户消息和 Session 轮次边界。
 * @param input 会话身份、消息正文和 SQLite 仓库。
 * @returns 对应 Session 记录器。
 */
function startSessionTurn(input: SessionTurnStartInput): SessionTurnHandle {
  let writer: ConversationSessionRunWriter | undefined;
  try {
    repairInterruptedConversation(input.conversationId, {
      repository: input.repository,
      now: input.createdAt,
    });
    const state = input.repository.ensureConversation(input.conversationId, input.createdAt);
    writer = new ConversationSessionRunWriter(
      input.repository,
      input.conversationId,
      input.runId,
      input.turnId,
      state.lastSequence,
    );
    const sessionWriter = writer;
    input.repository.withTransaction(() => {
      if (!input.regenerate) {
        const userMessage = {
          id: input.messageId,
          conversationId: input.conversationId,
          role: 'user',
          content: input.content,
          createdAt: input.createdAt,
        } as const;
        if (input.memoryScope) messageRepo.createWithMemoryScope(userMessage, input.memoryScope);
        else messageRepo.create(userMessage);
        messageRepo.updateConversationTimestamp(input.conversationId, input.createdAt);
        sessionWriter.startUserTurn(input.messageId, input.content, input.createdAt);
        return;
      }
      sessionWriter.startTurn(input.createdAt);
    });
    return { writer, turnId: input.turnId };
  } catch (error) {
    if (writer) writer.close();
    throw error;
  }
}

/**
 * 按锁定 Agent、手动选择或路由策略确定本轮 Agent。
 * @param input 路由输入与会话配置。
 * @returns 已选 Agent 标识。
 */
async function resolveMessageAgent(input: {
  agent?: string;
  conversation: NonNullable<ReturnType<typeof conversationRepo.findById>>;
  content: string;
  conversationId: string;
  messageId: string;
}): Promise<string | undefined> {
  if (input.agent) return input.agent;
  if (input.conversation.lockedAgent) return input.conversation.lockedAgent;
  if (input.conversation.routingMode === 'manual') return undefined;
  try {
    const route = await routingService.route(input.content, {
      agents: agentService.list(),
      lockedAgent: input.conversation.lockedAgent,
      routingMode: input.conversation.routingMode,
      conversationId: input.conversationId,
      messageId: input.messageId,
      messagePreview: input.content.substring(0, 50),
    });
    return route.agentId;
  } catch (error) {
    console.error('[routing] routing failed, fallback to general:', error);
    return 'general';
  }
}

interface BuildSessionRequestMessagesInput {
  repository: ConversationSessionRepository;
  writer: ConversationSessionRunWriter;
  conversationId: string;
  userMessageId: string;
  turnId?: string;
  userContent: string;
  regenerate: boolean;
  replaceAssistantAnswer: boolean;
  settings: ReturnType<typeof settingsService.getAiSettings>;
  memoryScope: MemoryScopeSnapshot | null;
  resolvedAgent?: string;
  validatedSlashCommand?: SlashCommandIntent;
}

/**
 * 从 Session 历史构造模型请求，并记录本轮系统提示和检索上下文。
 * @param input 当前对话、模型设置及 Session 记录器。
 * @returns 完整模型请求消息。
 */
function buildSessionRequestMessages(input: BuildSessionRequestMessagesInput): HistoryMessage[] {
  const events = input.repository.readAll(input.conversationId);
  const projectedHistory = toHistoryMessages(
    deriveModelHistory(events, input.turnId ? { turnId: input.turnId } : {}),
  );
  const history = input.replaceAssistantAnswer
    ? selectRegenerationHistory(projectedHistory)
    : projectedHistory;
  let systemPrompt = input.settings.systemPrompt;
  if (input.resolvedAgent && input.resolvedAgent !== 'general') {
    const agentInfo = agentService.findById(input.resolvedAgent);
    if (agentInfo?.systemPrompt) systemPrompt = agentInfo.systemPrompt;
  }
  systemPrompt = [COMPRESSED_HISTORY_SYSTEM_PROMPT, systemPrompt].filter(Boolean).join('\n\n');
  if (input.validatedSlashCommand) {
    systemPrompt = [systemPrompt, buildSlashCommandContext(input.validatedSlashCommand)]
      .filter(Boolean)
      .join('\n\n');
  }
  const messages: HistoryMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...history]
    : history;
  const assembly = applyContextProvidersWithTrace(messages, {
    settings: input.settings,
    userContent: input.userContent,
    ...(input.memoryScope ? { memoryScope: input.memoryScope } : {}),
    memoryBudget: {
      inputBudget: DEFAULT_CONTEXT_TOKEN_BUDGET - DEFAULT_OUTPUT_TOKEN_RESERVE,
    },
  });
  if (assembly.systemMessage) {
    input.writer.recordContextSnapshot({
      round: 1,
      scope: 'system',
      operation: 'replace',
      source: 'conversation-system',
      messages: [toStoredSessionMessage(assembly.systemMessage)],
    });
  }
  for (const contribution of assembly.userContributions) {
    input.writer.recordContextSnapshot({
      round: 1,
      scope: input.regenerate ? 'runtime' : 'anchor',
      operation: 'append',
      source: contribution.id,
      ...(input.regenerate ? {} : { anchorMessageId: input.userMessageId }),
      messages: [{ role: 'user', content: contribution.content }],
    });
  }
  return assembly.messages;
}

/** 选择需要重新生成的最后一个用户请求前缀，并阻止重复执行工具任务。 */
export function selectRegenerationHistory(history: readonly HistoryMessage[]): HistoryMessage[] {
  let lastUserIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) throw regenerationConflict('No user message is available to regenerate');
  const replacedAnswer = history.slice(lastUserIndex + 1);
  const containsToolHistory = replacedAnswer.some(
    (message) =>
      message.role === 'tool' ||
      (message.role === 'assistant' && (message.tool_calls?.length ?? 0) > 0),
  );
  if (containsToolHistory) {
    throw regenerationConflict('Regenerate requires a new user request after tool execution');
  }
  return history.slice(0, lastUserIndex + 1);
}

/** 创建带 409 状态码的重新生成冲突。 */
function regenerationConflict(message: string): HttpError {
  const error: HttpError = new Error(message);
  error.status = 409;
  return error;
}

interface ExecuteAndPersistChatInput {
  runId: string;
  recoveryActionId?: string;
  conversationId: string;
  originMessageId?: string;
  resolvedAgent?: string;
  requestMessages: HistoryMessage[];
  settings: ReturnType<typeof settingsService.getAiSettings>;
  sink: DeferredEndSink;
  sessionWriter: ConversationSessionRunWriter;
  userContent: string;
  memoryScope: MemoryScopeSnapshot | null;
  allowMemoryExtraction?: boolean;
}

interface ExecutedChat {
  run: AgentRun;
  result: StreamResult;
}

/**
 * 执行 ReAct 或普通 stream，并持久化最终回答和 A2UI 块。
 * @param input Agent 运行、Session 记录器和回答持久化依赖。
 * @returns 已注册运行及模型结果。
 */
async function executeAndPersistChat(input: ExecuteAndPersistChatInput): Promise<ExecutedChat> {
  const assistantMessageId = uuidv4();
  const tools = input.resolvedAgent ? await getToolDefinitions(input.resolvedAgent) : [];
  const useReact = tools.length > 0 && input.settings.reactMaxIterations > 0;
  const run = createRegisteredRun(
    input.conversationId,
    input.originMessageId,
    input.resolvedAgent,
    useReact ? 'react' : 'stream',
    input.runId,
  );
  const runtimeContext = createRuntimeContext({
    sessionRecorder: input.sessionWriter,
    assistantMessageId,
    ...(input.recoveryActionId ? { recoveryActionId: input.recoveryActionId } : {}),
  });
  let orchestratorSignal: AbortSignal | undefined;
  let orchestratorTimer: ReturnType<typeof setTimeout> | undefined;
  if (useReact && input.resolvedAgent) {
    const agentInfo = agentService.findById(input.resolvedAgent);
    if (agentInfo?.type === 'orchestrator') {
      const controller = new AbortController();
      orchestratorTimer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
      orchestratorSignal = controller.signal;
    }
  }
  let result: StreamResult;
  try {
    result = useReact
      ? await runAgentChat(
          input.requestMessages,
          input.settings,
          input.sink,
          input.resolvedAgent,
          orchestratorSignal,
          input.conversationId,
          undefined,
          run,
          runtimeContext,
        )
      : await streamChat(
          input.requestMessages,
          input.settings,
          input.sink,
          input.resolvedAgent,
          input.conversationId,
          run,
          runtimeContext,
        );
  } finally {
    if (orchestratorTimer) clearTimeout(orchestratorTimer);
  }
  if (result.content) {
    const assistantMessage = {
      id: assistantMessageId,
      conversationId: input.conversationId,
      role: 'assistant',
      content: result.content,
      reasoning: result.reasoning || null,
      createdAt: new Date().toISOString(),
    } as const;
    if (input.memoryScope) messageRepo.createWithMemoryScope(assistantMessage, input.memoryScope);
    else messageRepo.create(assistantMessage);
    persistUiBlocks(assistantMessageId, result.uiBlocks);
    if (
      input.allowMemoryExtraction !== false &&
      input.settings.memoryEnabled &&
      input.memoryScope
    ) {
      scheduleMemoryExtraction(
        input.userContent,
        input.conversationId,
        assistantMessageId,
        input.memoryScope,
      );
    }
  }
  input.sink.flush();
  return { run, result };
}

/** 返回恢复动作对应的安全模型指引。 */
function getRecoveryInstruction(action: 'continue' | 'retry'): string {
  if (action === 'retry') {
    return '用户已明确确认建立新运行处理未完成调用。先核对 Session 中的工具结果与外部状态；只有在当前权限和工具策略允许、且确认确有必要时，才发出新的工具调用。不得重用旧 Run 或将未知结果当作失败。';
  }
  return '继续已中断的任务。历史中可能有工具结果未知；不得盲目重放旧调用。优先使用只读工具核对外部状态，再根据核对结果和当前权限决定下一步。';
}

/**
 * 创建并注册拥有一次用户可见聊天的进程内运行。
 * @param conversationId 所属会话标识。
 * @param originMessageId 触发运行的用户消息标识。
 * @param agentId 被路由到的 Agent 标识。
 * @param executionMode 运行模式。
 * @param runId 可复用的持久运行标识。
 * @returns 已注册的 Agent 运行。
 */
function createRegisteredRun(
  conversationId: string,
  originMessageId: string | undefined,
  agentId: string | undefined,
  executionMode: 'react' | 'stream',
  runId = uuidv4(),
): AgentRun {
  const run = createDurableAgentRun({
    runId,
    conversationId,
    ...(originMessageId ? { originMessageId } : {}),
    ...(agentId ? { agentId } : {}),
    executionMode,
  });
  agentRunRegistry.register(run);
  return run;
}

/**
 * 执行一次记忆门控：读取实验设置 → 判定 → 写审计 → 命中时入队提取任务。
 * @param userContent 触发本轮的 user 消息
 * @param conversationId 会话 id
 * @param assistantMessageId 助手消息 id，用作提取快照锚点与审计来源
 */
async function runMemoryGate(
  userContent: string,
  conversationId: string,
  assistantMessageId: string,
  scope: MemoryScopeSnapshot,
): Promise<void> {
  const jev = settingsService.getJevSettings();
  const resolution = await evaluateMemoryGate({ userContent, conversationId }, { jev });
  memoryService.recordMemoryGateOutcome(resolution, conversationId, assistantMessageId, scope);
  if (resolution.memorize) enqueueMemoryProcessing(conversationId, assistantMessageId, scope);
}

/**
 * 响应结束后异步执行记忆门控，命中则入队提取任务。
 * 门控失败不影响对话，只记录审计事件。
 * @param userContent 触发本轮的 user 消息
 * @param conversationId 会话 id
 * @param assistantMessageId 助手消息 id
 */
function scheduleMemoryExtraction(
  userContent: string,
  conversationId: string,
  assistantMessageId: string,
  scope: MemoryScopeSnapshot,
): void {
  const tracked = trackMemoryGate(() =>
    runMemoryGate(userContent, conversationId, assistantMessageId, scope),
  );
  if (tracked) {
    void tracked.catch((error) => {
      console.error('[memory] gate failed', getErrorMessage(error));
    });
  }
}
