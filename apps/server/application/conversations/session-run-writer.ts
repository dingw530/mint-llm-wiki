import { v4 as uuidv4 } from 'uuid';
import {
  sessionEventAtSequence,
  type JsonValue,
  type SessionEvent,
  type SessionEventBase,
  type SessionEventDraft,
  type SessionStoredModelMessage,
} from '@mint/session';
import type {
  SessionRecordingPort,
  SessionToolDispatchRecord,
  SessionToolResultRecord,
} from '../../agent-runtime/tooling/runtime-context.js';
import type {
  ConversationSessionLease,
  ConversationSessionRepository,
} from '../../infrastructure/persistence/conversation-session-repository.js';

const SESSION_OWNER_TTL_MS = 300_000;
const SESSION_OWNER_RENEW_INTERVAL_MS = 60_000;

/** 为一个对话轮次分配 session 序号并写入持久轨迹。 */
export class ConversationSessionRunWriter implements SessionRecordingPort {
  private lastSequence: number;
  private currentRound = 1;
  private readonly dispatches = new Map<string, SessionEvent>();
  private ownerHeartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly approvalExpiries = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingApprovals = new Map<
    string,
    { readonly callId: string; readonly toolName: string; readonly reason?: string }
  >();
  private closed = false;

  constructor(
    private readonly repository: ConversationSessionRepository,
    private readonly conversationId: string,
    private readonly runId: string,
    private readonly turnId: string,
    private readonly lease: ConversationSessionLease,
    lastSequence: number,
  ) {
    this.lastSequence = lastSequence;
  }

  /**
   * 提交一组按会话序号连续的语义事件。
   * @param drafts 尚未分配序号的会话事件。
   * @returns 已提交事件。
   */
  record(drafts: readonly SessionEventDraft[]): readonly SessionEvent[] {
    if (drafts.length === 0) return [];
    const now = new Date().toISOString();
    const events = drafts.map((draft, index) =>
      sessionEventAtSequence(draft, this.lastSequence + index + 1),
    );
    const state = this.repository.appendBatch(
      this.conversationId,
      this.lastSequence,
      this.lease.ownerFence,
      events,
      now,
    );
    this.lastSequence = state.lastSequence;
    for (const event of events) {
      if (event.type === 'tool_dispatch_committed') {
        this.dispatches.set(event.callId, event);
      }
    }
    return events;
  }

  /**
   * 在创建新模型请求前持久化本轮用户输入。
   * @param messageId 用户消息身份。
   * @param content 已处理附件后的用户输入。
   * @param createdAt 用户消息创建时间。
   * @returns 用户消息事件。
   */
  startUserTurn(messageId: string, content: string, createdAt: string): readonly SessionEvent[] {
    return this.record([
      {
        ...this.base(createdAt),
        type: 'turn_started',
      },
      {
        ...this.base(createdAt),
        type: 'user_message',
        messageId,
        content,
      },
    ]);
  }

  /**
   * 为无用户输入的重新生成轮次追加边界。
   * @param createdAt 轮次创建时间。
   * @returns 新轮事件。
   */
  startTurn(createdAt = new Date().toISOString()): SessionEvent {
    return this.record([{ ...this.base(createdAt), type: 'turn_started' }])[0]!;
  }

  /**
   * 为旧运行的显式恢复动作创建关联的新轮次。
   * @param input 原运行、恢复动作和创建时间。
   * @returns 已提交的恢复轮次事件。
   */
  startRecoveryTurn(input: {
    readonly originRunId: string;
    readonly recoveryActionId: string;
    readonly recoveryAction: 'continue' | 'retry';
    readonly createdAt?: string;
  }): SessionEvent {
    return this.record([
      {
        ...this.base(input.createdAt),
        type: 'turn_started',
        originRunId: input.originRunId,
        recoveryActionId: input.recoveryActionId,
        recoveryAction: input.recoveryAction,
      },
    ])[0]!;
  }

  /**
   * 持久化模型完整响应消息，不保存未完成的流式 token 分片。
   * @param round 模型轮次。
   * @param messages 适配器返回的有序模型消息。
   * @returns 已提交模型消息事件。
   */
  recordModelMessage(
    round: number,
    messages: readonly SessionStoredModelMessage[],
    messageId?: string,
  ): SessionEvent {
    this.currentRound = round;
    return this.record([
      {
        ...this.base(),
        type: 'model_message',
        round,
        ...(messageId ? { messageId } : {}),
        messages,
      },
    ])[0]!;
  }

  /**
   * 持久化本轮提供给模型的可用工具 schema。
   * @param round 模型轮次。
   * @param tools 已清理为 JSON 的工具描述。
   * @returns 已提交工具目录事件。
   */
  recordToolCatalog(round: number, tools: readonly JsonValue[]): SessionEvent {
    this.currentRound = round;
    return this.record([
      {
        ...this.base(),
        type: 'tool_catalog',
        round,
        tools,
      },
    ])[0]!;
  }

  /**
   * 持久化运行时注入或上下文压缩变化。
   * @param input 上下文作用域、插入身份和消息。
   * @returns 已提交上下文事件。
   */
  recordContextSnapshot(input: {
    round: number;
    scope: 'system' | 'anchor' | 'runtime' | 'history';
    operation: 'append' | 'replace' | 'clear';
    source: string;
    anchorMessageId?: string;
    messages: readonly SessionStoredModelMessage[];
  }): SessionEvent {
    this.currentRound = input.round;
    return this.record([
      {
        ...this.base(),
        type: 'context_snapshot',
        round: this.currentRound,
        scope: input.scope,
        operation: input.operation,
        source: input.source,
        ...(input.anchorMessageId ? { anchorMessageId: input.anchorMessageId } : {}),
        messages: input.messages,
      },
    ])[0]!;
  }

  /**
   * 在 Ledger claim 同一事务中记录工具执行前的调用意图。
   * @param input 工具调用身份、参数和 retry 安全事实。
   * @returns 已持久化调用；同一调用内部的安全 retry 沿用首次分派事件。
   */
  recordToolDispatch(input: SessionToolDispatchRecord): SessionEvent {
    const existing = this.dispatches.get(input.callId);
    if (existing) return existing;
    const event = this.record([
      {
        ...this.base(),
        type: 'tool_dispatch_committed',
        round: this.currentRound,
        callId: input.callId,
        toolName: input.toolName,
        argumentsJson: input.argumentsJson,
        retrySafety: input.retrySafety,
      },
    ])[0]!;
    this.dispatches.set(input.callId, event);
    return event;
  }

  /**
   * 在 ReAct 工具结果完成转换后保存实际提供给模型的内容。
   * @param input 调用身份、完成状态与模型可见结果。
   * @returns 已提交工具结果。
   */
  recordToolResult(input: SessionToolResultRecord): SessionEvent {
    return this.record([
      {
        ...this.base(),
        type: 'tool_result',
        round: this.currentRound,
        callId: input.callId,
        toolName: input.toolName,
        dispatchCommitted: this.dispatches.has(input.callId),
        status: input.status,
        ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
        message: input.message,
      },
    ])[0]!;
  }

  /**
   * 持久化一次与工具调用关联的人工审批决策。
   * @param input 审批调用身份和决策状态。
   * @returns 已提交审批事件。
   */
  recordApproval(input: {
    readonly callId: string;
    readonly toolName: string;
    readonly status: 'requested' | 'approved' | 'denied' | 'expired';
    readonly reason?: string;
  }): SessionEvent {
    if (input.status === 'requested') {
      this.pendingApprovals.set(input.callId, {
        callId: input.callId,
        toolName: input.toolName,
        ...(input.reason ? { reason: input.reason } : {}),
      });
    } else {
      this.pendingApprovals.delete(input.callId);
      const expiry = this.approvalExpiries.get(input.callId);
      if (expiry) clearTimeout(expiry);
      this.approvalExpiries.delete(input.callId);
    }
    return this.record([
      {
        ...this.base(),
        type: 'approval',
        callId: input.callId,
        toolName: input.toolName,
        status: input.status,
        ...(input.reason ? { reason: input.reason } : {}),
      },
    ])[0]!;
  }

  /**
   * 为活跃运行或待审批运行定期续租。
   * @returns 无返回值。
   */
  startHeartbeat(): void {
    if (this.closed || this.ownerHeartbeat) return;
    this.ownerHeartbeat = setInterval(() => {
      if (this.closed) return;
      try {
        this.repository.renewOwner(this.lease, SESSION_OWNER_TTL_MS);
      } catch (error) {
        console.error('续租会话写入权失败：', error);
      }
    }, SESSION_OWNER_RENEW_INTERVAL_MS);
  }

  /**
   * 为待审批运行设置过期边界；过期后关闭未完成轮次并释放租约。
   * @param callId 待审批工具调用标识。
   * @param ttlMs 审批请求的有效时长。
   * @returns 无返回值。
   */
  pauseForApproval(callId: string, ttlMs: number): void {
    if (this.closed || !this.pendingApprovals.has(callId)) return;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new Error('审批租约时长无效');
    }
    const previousExpiry = this.approvalExpiries.get(callId);
    if (previousExpiry) clearTimeout(previousExpiry);
    const expiry = setTimeout(() => {
      const pending = this.pendingApprovals.get(callId);
      if (!pending || this.closed) return;
      this.recordApproval({ ...pending, status: 'expired' });
      if (this.pendingApprovals.size === 0) {
        this.recordInterrupted('lease_expired');
        this.close();
      }
    }, ttlMs);
    this.approvalExpiries.set(callId, expiry);
  }

  /**
   * 清理续租定时器并释放会话写入租约。
   * @returns 无返回值。
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ownerHeartbeat) clearInterval(this.ownerHeartbeat);
    for (const expiry of this.approvalExpiries.values()) clearTimeout(expiry);
    this.approvalExpiries.clear();
    this.ownerHeartbeat = undefined;
    this.repository.releaseOwner(this.lease);
  }

  /**
   * 记录一轮运行结束。
   * @param outcome 运行终态。
   * @returns 已提交终态事件。
   */
  recordRunTerminal(outcome: 'completed' | 'failed' | 'cancelled'): SessionEvent {
    return this.record([
      {
        ...this.base(),
        type: 'run_terminal',
        outcome,
      },
    ])[0]!;
  }

  /**
   * 记录旧进程退出时的未完成边界。
   * @param reason 运行中断原因。
   * @returns 已提交中断事件。
   */
  recordInterrupted(
    reason: 'process_exit' | 'lease_expired' | 'unknown' = 'unknown',
  ): SessionEvent {
    return this.record([
      {
        ...this.base(),
        type: 'turn_interrupted',
        reason,
      },
    ])[0]!;
  }

  /**
   * 为当前运行构造稳定身份字段。
   * @param type 事件类型。
   * @param createdAt 可指定事件时间。
   * @returns 尚未分配 seq 的事件公共字段。
   */
  private base(createdAt = new Date().toISOString()): Omit<SessionEventBase, 'seq'> {
    return {
      schemaVersion: 1,
      conversationId: this.conversationId,
      eventId: uuidv4(),
      runId: this.runId,
      turnId: this.turnId,
      createdAt,
    };
  }
}
