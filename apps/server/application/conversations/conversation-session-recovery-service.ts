import { planSessionRecovery, type RecoveryLedgerStatus, type SessionEvent } from '@mint/session';
import { agentRunRegistry } from '../../agent-runtime/agent-run.js';
import { ConversationSessionRepository } from '../../infrastructure/persistence/conversation-session-repository.js';
import {
  toolInvocationRepository,
  type ToolInvocationRepository,
} from '../../infrastructure/persistence/tool-invocation-repository.js';

export type ConversationSessionRecoveryStatus = 'repaired' | 'nothing_to_repair' | 'active_run';

export interface ConversationSessionRecoveryResult {
  readonly status: ConversationSessionRecoveryStatus;
  readonly lastSequence: number;
  readonly events: readonly SessionEvent[];
}

export interface ConversationSessionRecoveryOptions {
  readonly repository?: ConversationSessionRepository;
  readonly invocations?: Pick<ToolInvocationRepository, 'get'>;
  readonly now?: string;
}

/**
 * 从 Session 日志修复所有未关闭的历史运行；只追加合成结果，不调用工具。
 * @param conversationId 待修复会话标识。
 * @param options 可注入的会话仓库、Ledger 读取器和恢复时间。
 * @returns 修复结果、最新序号和追加的事件。
 */
export function repairInterruptedConversation(
  conversationId: string,
  options: ConversationSessionRecoveryOptions = {},
): ConversationSessionRecoveryResult {
  const repository = options.repository ?? new ConversationSessionRepository();
  const invocations = options.invocations ?? toolInvocationRepository;
  const now = options.now ?? new Date().toISOString();
  repository.ensureConversation(conversationId, now);
  if (agentRunRegistry.getByConversation(conversationId)) {
    return {
      status: 'active_run',
      lastSequence: repository.ensureConversation(conversationId, now).lastSequence,
      events: [],
    };
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = repository.ensureConversation(conversationId, now);
    const original = repository.readAll(conversationId);
    const additions = buildRecoveryEvents(conversationId, original, invocations, now);
    if (additions.length > 0) {
      try {
        repository.appendBatch(conversationId, state.lastSequence, additions, now);
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'SESSION_SEQUENCE_CONFLICT' &&
          attempt < 2
        ) {
          continue;
        }
        throw error;
      }
    }
    const updated = repository.ensureConversation(conversationId, now);
    return {
      status: additions.length > 0 ? 'repaired' : 'nothing_to_repair',
      lastSequence: updated.lastSequence,
      events: additions,
    };
  }
  throw new Error('Session recovery could not commit after concurrent updates');
}

/** 按运行顺序生成幂等恢复结果、过期审批和中断边界。 */
function buildRecoveryEvents(
  conversationId: string,
  events: readonly SessionEvent[],
  invocations: Pick<ToolInvocationRepository, 'get'>,
  now: string,
): SessionEvent[] {
  const additions: SessionEvent[] = [];
  let workingEvents = [...events];
  for (const runId of collectRunIds(events)) {
    const runEvents = workingEvents.filter((event) => event.runId === runId);
    const plan = planSessionRecovery(workingEvents, runId, {
      readLedgerStatus: (targetRunId, callId) => readLedgerStatus(invocations, targetRunId, callId),
      now,
    });
    workingEvents = [...workingEvents, ...plan.events];
    additions.push(...plan.events);
    const approvals = unresolvedApprovals(runEvents);
    for (const approval of approvals) {
      const event = createExpiredApproval(
        approval,
        conversationId,
        runId,
        now,
        workingEvents.length + 1,
      );
      additions.push(event);
      workingEvents.push(event);
    }
    if (!hasTerminal(runEvents) && !hasInterruption(runEvents)) {
      const turn = latestTurnId(runEvents);
      if (turn) {
        const event = createInterruptedBoundary(
          conversationId,
          runId,
          turn,
          now,
          workingEvents.length + 1,
        );
        additions.push(event);
        workingEvents.push(event);
      }
    }
  }
  return additions;
}

/** 收集有启动事件的运行，并按首个持久事件序号稳定排序。 */
function collectRunIds(events: readonly SessionEvent[]): string[] {
  const firstSequence = new Map<string, number>();
  for (const event of events) {
    if (event.type !== 'turn_started') continue;
    firstSequence.set(
      event.runId,
      Math.min(firstSequence.get(event.runId) ?? event.seq, event.seq),
    );
  }
  return [...firstSequence.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([runId]) => runId);
}

/** 读取 Ledger 状态；查询失败时将状态收敛为未知，禁止自动重放。 */
function readLedgerStatus(
  invocations: Pick<ToolInvocationRepository, 'get'>,
  runId: string,
  callId: string,
): RecoveryLedgerStatus {
  try {
    return invocations.get(runId, callId)?.status ?? 'missing';
  } catch {
    return 'missing';
  }
}

/** 找出尚未得到审批决定的调用。 */
function unresolvedApprovals(
  events: readonly SessionEvent[],
): Array<{ turnId: string; callId: string; toolName: string; reason?: string }> {
  const pending = new Map<
    string,
    { turnId: string; callId: string; toolName: string; reason?: string }
  >();
  for (const event of events) {
    if (event.type !== 'approval') continue;
    if (event.status === 'requested') {
      pending.set(event.callId, {
        turnId: event.turnId,
        callId: event.callId,
        toolName: event.toolName,
        ...(event.reason ? { reason: event.reason } : {}),
      });
    } else {
      pending.delete(event.callId);
    }
  }
  return [...pending.values()];
}

/** 为冷恢复时尚未决策的审批追加过期事件。 */
function createExpiredApproval(
  approval: { turnId: string; callId: string; toolName: string; reason?: string },
  conversationId: string,
  runId: string,
  now: string,
  sequence: number,
): SessionEvent {
  return {
    schemaVersion: 1,
    conversationId,
    eventId: `recovery:approval-expired:${runId}:${approval.callId}`,
    seq: sequence,
    runId,
    turnId: approval.turnId,
    createdAt: now,
    type: 'approval',
    callId: approval.callId,
    toolName: approval.toolName,
    status: 'expired',
    ...(approval.reason ? { reason: approval.reason } : {}),
  };
}

/** 为没有终态的运行追加确定性中断边界。 */
function createInterruptedBoundary(
  conversationId: string,
  runId: string,
  turnId: string,
  now: string,
  sequence: number,
): SessionEvent {
  return {
    schemaVersion: 1,
    conversationId,
    eventId: `recovery:turn-interrupted:${runId}`,
    seq: sequence,
    runId,
    turnId,
    createdAt: now,
    type: 'turn_interrupted',
    reason: 'process_exit',
  };
}

/** 判断运行是否已有持久终态。 */
function hasTerminal(events: readonly SessionEvent[]): boolean {
  return events.some((event) => event.type === 'run_terminal');
}

/** 判断运行是否已经标记过中断。 */
function hasInterruption(events: readonly SessionEvent[]): boolean {
  return events.some((event) => event.type === 'turn_interrupted');
}

/** 读取运行最后启动的轮次标识。 */
function latestTurnId(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'turn_started') return events[index]?.turnId;
  }
  return undefined;
}
