import { copyJsonValue, type JsonValue, type SessionStoredModelMessage } from '@mint/session';
import type { HistoryMessage, ToolCall } from '../types.js';

/**
 * 将 Mint 历史消息复制为 Session JSON 事件载荷。
 * @param message Mint 模型历史消息。
 * @returns 不共享可变对象的 JSON 模型消息。
 */
export function toStoredSessionMessage(message: HistoryMessage): SessionStoredModelMessage {
  const result: { role: string; [key: string]: JsonValue | undefined } = {
    role: message.role,
    content: message.content,
  };
  if (message.reasoning !== undefined) result.reasoning = message.reasoning;
  if (message.tool_call_id !== undefined) result.tool_call_id = message.tool_call_id;
  if (message.tool_calls !== undefined) {
    result.tool_calls = message.tool_calls.map((call) =>
      copyJsonValue({
        id: call.id,
        type: call.type,
        function: {
          name: call.function.name,
          arguments: call.function.arguments,
        },
      }),
    );
  }
  return result;
}

/**
 * 将 session 消息恢复为 Mint 适配器历史并校验协议字段。
 * @param messages session 纯数据层的消息序列。
 * @returns Mint 模型适配器可用的消息副本。
 */
export function toHistoryMessages(
  messages: readonly SessionStoredModelMessage[],
): HistoryMessage[] {
  return messages.map((message) => {
    const emptyAssistantToolContent =
      message.role === 'assistant' && message.content === null && message.tool_calls !== undefined;
    if (typeof message.content !== 'string' && !emptyAssistantToolContent) {
      throw new Error('Stored model history message content is not text');
    }
    const result: HistoryMessage = {
      role: message.role,
      content: typeof message.content === 'string' ? message.content : '',
    };
    if (message.reasoning === null || typeof message.reasoning === 'string') {
      result.reasoning = message.reasoning;
    }
    if (typeof message.tool_call_id === 'string') result.tool_call_id = message.tool_call_id;
    if (message.tool_calls !== undefined) result.tool_calls = readToolCalls(message.tool_calls);
    return result;
  });
}

/**
 * 严格转换 provider-neutral 的工具调用 JSON。
 * @param value 模型消息中的工具调用。
 * @returns Mint ReAct 工具调用列表。
 */
function readToolCalls(value: JsonValue): ToolCall[] {
  if (!Array.isArray(value)) throw new Error('Stored assistant tool_calls must be an array');
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error('Stored assistant tool call is invalid at index ' + index);
    const callId = item.id;
    const callType = item.type;
    const fn = item.function;
    if (typeof callId !== 'string' || typeof callType !== 'string' || !isRecord(fn)) {
      throw new Error('Stored assistant tool call is incomplete at index ' + index);
    }
    if (typeof fn.name !== 'string' || typeof fn.arguments !== 'string') {
      throw new Error('Stored assistant tool function is incomplete at index ' + index);
    }
    return {
      id: callId,
      type: callType,
      function: { name: fn.name, arguments: fn.arguments },
    };
  });
}

/**
 * 判断 JSON 对象。
 * @param value 待判断值。
 * @returns 是否为对象记录。
 */
function isRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
