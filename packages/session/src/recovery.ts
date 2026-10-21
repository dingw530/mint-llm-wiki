import type {
  SessionEvent,
  SessionRecoveryResultEvent,
  SessionToolDispatchEvent,
} from './contracts.js';
import { validateSessionEvents } from './validation.js';

/** 正常工具执行 Ledger 的只读状态快照。 */
export type RecoveryLedgerStatus = SessionRecoveryResultEvent['ledgerStatus'];

/** 冷恢复计划的执行状态。 */
export type RecoveryPlanStatus = 'ready' | 'nothing_to_repair' | 'blocked_active_owner';

/** 本次恢复需要宿主持久追加的事件。 */
export interface SessionRecoveryPlan {
  readonly status: RecoveryPlanStatus;
  readonly expectedLastSequence: number;
  readonly events: readonly SessionRecoveryResultEvent[];
}

/** 生成合成工具结果时允许读取的 Ledger 状态。 */
export type RecoveryLedgerReader = (runId: string, callId: string) => RecoveryLedgerStatus;

/**
 * 为中断运行规划未知或尚未分派的工具结果；本函数不写库、不执行工具。
 * @param events 当前会话的完整、已验证事件前缀。
 * @param runId 要检查的原运行标识。
 * @param options 当前所有权与账本读取器。
 * @returns 带 CAS 序号的追加计划。
 */
export function planSessionRecovery(
  events: readonly SessionEvent[],
  runId: string,
  options: {
    readonly hasActiveOwner: boolean;
    readonly readLedgerStatus: RecoveryLedgerReader;
    readonly now: string;
  },
): SessionRecoveryPlan {
  const validated = validateSessionEvents(events);
  if (options.hasActiveOwner) {
    return {
      status: 'blocked_active_owner',
      expectedLastSequence: lastSequence(validated),
      events: [],
    };
  }
  const runEvents = validated.filter((event) => event.runId === runId);
  const existing = new Set(
    runEvents
      .filter((event) => event.type === 'tool_result' || event.type === 'recovery_result')
      .map((event) => event.callId),
  );
  const dispatches = new Map<string, SessionToolDispatchEvent>();
  const proposals = collectToolProposals(runEvents);
  for (const event of runEvents) {
    if (event.type === 'tool_dispatch_committed') dispatches.set(event.callId, event);
  }

  const unresolved = proposals.filter((proposal) => !existing.has(proposal.callId));
  const repairs: SessionRecoveryResultEvent[] = [];
  let nextSequence = lastSequence(validated) + 1;
  for (const proposal of unresolved) {
    const dispatch = dispatches.get(proposal.callId);
    const outcome = dispatch ? 'outcome_unknown' : 'not_started';
    const ledgerStatus = dispatch ? options.readLedgerStatus(runId, proposal.callId) : 'missing';
    const message = makeRecoveryMessage(
      runId,
      proposal.callId,
      proposal.toolName,
      outcome,
      ledgerStatus,
    );
    repairs.push({
      schemaVersion: 1,
      conversationId: proposal.conversationId,
      eventId: `recovery:${runId}:${proposal.callId}:${outcome}`,
      seq: nextSequence++,
      runId,
      turnId: proposal.turnId,
      createdAt: options.now,
      type: 'recovery_result',
      round: proposal.round,
      callId: proposal.callId,
      toolName: proposal.toolName,
      status: outcome,
      ledgerStatus,
      synthetic: true,
      message,
    });
  }

  if (repairs.length === 0) {
    return {
      status: 'nothing_to_repair',
      expectedLastSequence: lastSequence(validated),
      events: [],
    };
  }
  return { status: 'ready', expectedLastSequence: lastSequence(validated), events: repairs };
}

interface ToolProposal {
  readonly callId: string;
  readonly toolName: string;
  readonly round: number;
  readonly conversationId: string;
  readonly turnId: string;
}

/**
 * 提取模型已提交的工具调用声明，并保持原有调用顺序。
 * @param events 单个运行的事件。
 * @returns 唯一的模型工具调用身份。
 */
function collectToolProposals(events: readonly SessionEvent[]): ToolProposal[] {
  const proposals: ToolProposal[] = [];
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type !== 'model_message') continue;
    for (const message of event.messages) {
      if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
      for (const call of message.tool_calls) {
        if (!isRecord(call) || typeof call.id !== 'string') continue;
        const fn = call.function;
        if (!isRecord(fn) || typeof fn.name !== 'string' || ids.has(call.id)) continue;
        ids.add(call.id);
        proposals.push({
          callId: call.id,
          toolName: fn.name,
          round: event.round,
          conversationId: event.conversationId,
          turnId: event.turnId,
        });
      }
    }
  }
  return proposals;
}

/**
 * 为恢复事件生成对应模型协议的 tool message。
 * @param runId 原运行标识。
 * @param callId 原工具调用标识。
 * @param toolName 原工具名称。
 * @param status 恢复判定结果。
 * @param ledgerStatus 执行账本事实。
 * @returns 配对原调用 ID 的纯文本工具结果。
 */
function makeRecoveryMessage(
  runId: string,
  callId: string,
  toolName: string,
  status: SessionRecoveryResultEvent['status'],
  ledgerStatus: RecoveryLedgerStatus,
): SessionRecoveryResultEvent['message'] {
  const text =
    status === 'not_started'
      ? `Recovery for run ${runId}: the ${toolName} call was recorded by the model but was not committed for execution. Decide whether it is still needed.`
      : ledgerStatus === 'succeeded'
        ? `Recovery for run ${runId}: the ledger records ${toolName} as succeeded, but the model result was not saved. Do not invoke it again. Verify external state using read-only evidence or ask the user.`
        : `Recovery for run ${runId}: ${toolName} was dispatched, but no result was saved. Its external outcome is unknown. Do not retry blindly; verify external state using read-only evidence or ask the user.`;
  return { role: 'tool', tool_call_id: callId, content: text };
}

/**
 * 返回最后已提交的会话序号。
 * @param events 有序事件前缀。
 * @returns 最后序号；空前缀返回零。
 */
function lastSequence(events: readonly SessionEvent[]): number {
  return events.at(-1)?.seq ?? 0;
}

/**
 * 确认 JSON 消息字段为对象。
 * @param value 待判断值。
 * @returns 是否为普通消息记录。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
