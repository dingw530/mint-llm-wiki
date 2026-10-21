import type { SessionEvent } from '@mint/session';
import type { Message } from '../../types.js';

type ChatSegment =
  | { readonly type: 'thinking'; readonly content: string }
  | { readonly type: 'text'; readonly content: string }
  | {
      type: 'tool_call';
      callId: string;
      toolName: string;
      arguments?: unknown;
      status: 'running' | 'done' | 'error' | 'outcome_unknown' | 'approval_required';
      result?: string;
      error?: string;
      approvalReason?: string;
    };

type ProjectedMessage = Message & {
  readonly runId?: string;
  readonly segments?: ChatSegment[];
};

/**
 * 从权威 Session 事件重建聊天显示消息，并利用旧兼容行补齐历史消息身份。
 * @param conversationId 会话标识。
 * @param events 已验证的有序 Session 事件。
 * @param legacyMessages 旧 messages 兼容投影，仅用于复用已有 ID 和 A2UI 关联。
 * @returns 按语义事件顺序生成的 UI 消息。
 */
export function projectSessionChatMessages(
  conversationId: string,
  events: readonly SessionEvent[],
  legacyMessages: Message[],
): ProjectedMessage[] {
  const legacyIds = new Map<string, string[]>();
  for (const message of legacyMessages) {
    if (message.role !== 'assistant') continue;
    const ids = legacyIds.get(message.content) ?? [];
    ids.push(message.id);
    legacyIds.set(message.content, ids);
  }

  const projected: ProjectedMessage[] = [];
  const intermediateByTurn = new Map<string, ProjectedMessage>();
  const toolSegments = new Map<string, ChatSegment & { type: 'tool_call' }>();
  for (const event of events) {
    if (event.type === 'user_message') {
      projected.push({
        id: event.messageId,
        conversationId,
        role: 'user',
        content: jsonText(event.content),
        createdAt: event.createdAt,
      });
      continue;
    }
    if (event.type === 'model_message') {
      for (const [index, modelMessage] of event.messages.entries()) {
        if (modelMessage.role !== 'assistant') continue;
        const content = readContent(modelMessage.content);
        const reasoning = readContent(modelMessage.reasoning_content ?? modelMessage.reasoning);
        const segments: ChatSegment[] = [];
        if (reasoning) segments.push({ type: 'thinking', content: reasoning });
        if (content) segments.push({ type: 'text', content });
        for (const toolCall of readToolCalls(modelMessage.tool_calls)) {
          const segment: ChatSegment & { type: 'tool_call' } = {
            type: 'tool_call',
            callId: toolCall.callId,
            toolName: toolCall.toolName,
            ...(toolCall.arguments === undefined ? {} : { arguments: toolCall.arguments }),
            status: 'running',
          };
          toolSegments.set(callKey(event.runId, toolCall.callId), segment);
          segments.push(segment);
        }
        const legacyId = event.messageId ? undefined : takeLegacyId(legacyIds, content);
        const isFinalAnswer = event.messageId !== undefined || legacyId !== undefined;
        if (isFinalAnswer) {
          const turnKey = `${event.runId}:${event.turnId}`;
          const intermediate = intermediateByTurn.get(turnKey);
          const finalMessageId =
            event.messageId ??
            legacyId ??
            `session:${event.conversationId}:${event.eventId}:${index}`;
          if (intermediate) {
            intermediate.content = appendText(intermediate.content, content);
            if (reasoning)
              intermediate.reasoning = appendText(intermediate.reasoning ?? '', reasoning);
            intermediate.id = finalMessageId;
            intermediate.segments?.push(...segments);
          } else {
            projected.push({
              id: finalMessageId,
              conversationId,
              role: 'assistant',
              content,
              ...(reasoning ? { reasoning } : {}),
              createdAt: event.createdAt,
              runId: event.runId,
              ...(segments.length > 0 ? { segments } : {}),
            });
          }
          continue;
        }

        const turnKey = `${event.runId}:${event.turnId}`;
        let intermediate = intermediateByTurn.get(turnKey);
        if (!intermediate) {
          intermediate = {
            id: `session:${event.conversationId}:${event.turnId}:${index}`,
            conversationId,
            role: 'assistant',
            content,
            ...(reasoning ? { reasoning } : {}),
            createdAt: event.createdAt,
            runId: event.runId,
            segments: [],
          };
          intermediateByTurn.set(turnKey, intermediate);
          projected.push(intermediate);
        } else {
          if (content) intermediate.content = appendText(intermediate.content, content);
          if (reasoning)
            intermediate.reasoning = appendText(intermediate.reasoning ?? '', reasoning);
        }
        intermediate.segments?.push(...segments);
      }
      continue;
    }
    if (event.type === 'tool_result' || event.type === 'recovery_result') {
      const segment = toolSegments.get(callKey(event.runId, event.callId));
      if (!segment) continue;
      const result = readContent(event.message.content);
      if (event.status === 'success') {
        segment.status = 'done';
        segment.result = result;
      } else if (event.status === 'outcome_unknown') {
        segment.status = 'outcome_unknown';
        segment.error = result;
      } else {
        segment.status = 'error';
        segment.error = result;
      }
      continue;
    }
    if (event.type === 'approval') {
      const segment = toolSegments.get(callKey(event.runId, event.callId));
      if (!segment) continue;
      segment.status =
        event.status === 'requested'
          ? 'approval_required'
          : event.status === 'approved'
            ? 'running'
            : 'error';
      if (event.reason) segment.approvalReason = event.reason;
    }
  }
  return projected;
}

/** 构造仅在单次运行内唯一的工具调用索引键。 */
function callKey(runId: string, callId: string): string {
  return `${runId}:${callId}`;
}

/** 合并同一轮的分段 assistant 正文并保留清晰的段落边界。 */
function appendText(current: string, next: string): string {
  if (!current) return next;
  if (!next) return current;
  return `${current}\n\n${next}`;
}

/**
 * 从模型消息中读取可显示的工具调用，并尽量解析 JSON 参数。
 * @param value 模型消息中的 tool_calls 字段。
 * @returns 带稳定调用 ID 的工具调用摘要。
 */
function readToolCalls(value: unknown): Array<{
  callId: string;
  toolName: string;
  arguments?: unknown;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const fn = isRecord(entry.function) ? entry.function : undefined;
    if (typeof entry.id !== 'string' || !fn || typeof fn.name !== 'string') return [];
    const rawArguments = fn.arguments;
    let args: unknown = rawArguments;
    if (typeof rawArguments === 'string') {
      try {
        args = JSON.parse(rawArguments);
      } catch {
        args = rawArguments;
      }
    }
    return [
      { callId: entry.id, toolName: fn.name, ...(args === undefined ? {} : { arguments: args }) },
    ];
  });
}

/**
 * 按内容顺序复用一条兼容 assistant 消息身份。
 * @param legacyIds 兼容消息内容到身份队列的索引。
 * @param content 当前 assistant 正文。
 * @returns 可复用的消息身份；没有匹配项时返回 undefined。
 */
function takeLegacyId(legacyIds: Map<string, string[]>, content: string): string | undefined {
  if (!content) return undefined;
  const ids = legacyIds.get(content);
  return ids?.shift();
}

/**
 * 将模型内容规范化为聊天可显示文本。
 * @param value 持久事件里的任意 JSON 值。
 * @returns 可显示的文本。
 */
function readContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return jsonText(value);
}

/**
 * 将 JSON 值转换为文本，供聊天消息正文使用。
 * @param value 要转换的值。
 * @returns 字符串本身或其 JSON 表示。
 */
function jsonText(value: unknown): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
}

/**
 * 判断值是否为非数组对象。
 * @param value 待判断值。
 * @returns 是否为对象记录。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
