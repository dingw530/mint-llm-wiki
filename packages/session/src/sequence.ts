import type { SessionEvent, SessionEventDraft } from './contracts.js';

/**
 * 为一条待写事件分配持久序号，保留事件的判别类型。
 * @param draft 尚未分配序号的事件。
 * @param seq 会话内的唯一递增序号。
 * @returns 带有持久序号的会话事件。
 */
export function sessionEventAtSequence(draft: SessionEventDraft, seq: number): SessionEvent {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error('Session event sequence is invalid');
  switch (draft.type) {
    case 'turn_started':
    case 'user_message':
    case 'model_message':
    case 'context_snapshot':
    case 'tool_catalog':
    case 'tool_dispatch_committed':
    case 'tool_result':
    case 'recovery_result':
    case 'approval':
    case 'run_terminal':
    case 'turn_interrupted':
      return { ...draft, seq };
    default:
      return assertNever(draft);
  }
}

/**
 * 处理穷尽事件类型检查。
 * @param draft 不应到达的事件类型。
 * @returns 不会正常返回。
 */
function assertNever(draft: never): never {
  throw new Error('Unsupported session event draft: ' + String(draft));
}
