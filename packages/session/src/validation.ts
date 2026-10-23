import {
  SESSION_EVENT_SCHEMA_VERSION,
  type JsonValue,
  type SessionEvent,
  type SessionStoredModelMessage,
} from './contracts.js';

/**
 * 验证并复制一份连续、不可重复的持久事件前缀。
 * @param events 要验证的会话事件。
 * @param expectedFirstSequence 预期的首个序号。
 * @returns 防御性复制后的只读事件数组。
 */
export function validateSessionEvents(
  events: readonly SessionEvent[],
  expectedFirstSequence = 1,
): readonly SessionEvent[] {
  const validated = validateSessionEventBatch(events, expectedFirstSequence);
  const proposals = new Map<string, ToolCallProposal>();
  const dispatches = new Map<string, ToolCallProposal>();
  const results = new Set<string>();
  for (const event of validated) validateCallPairing(event, proposals, dispatches, results);
  return validated;
}

/**
 * 验证并深拷贝一个未知 JSON 输入。
 * @param value 未信任的运行时值。
 * @returns 合法的 JSON 值副本。
 */
export function copyJsonValue(value: unknown): JsonValue {
  return cloneJson(value);
}

/**
 * 验证一次有序追加批次的结构，不要求批次内含有它所引用的历史事件。
 * @param events 即将追加的会话事件。
 * @param expectedFirstSequence 预期的首个持久序号。
 * @returns 防御性复制后的有序事件批次。
 */
export function validateSessionEventBatch(
  events: readonly SessionEvent[],
  expectedFirstSequence = 1,
): readonly SessionEvent[] {
  assertPositiveInteger(expectedFirstSequence, 'expectedFirstSequence');
  const eventIds = new Set<string>();
  const proposalIds = new Set<string>();
  const dispatchIds = new Set<string>();
  const resultIds = new Set<string>();
  let expectedSequence = expectedFirstSequence;

  const copy = events.map((event, index) => {
    assertEvent(event, index);
    if (event.schemaVersion !== SESSION_EVENT_SCHEMA_VERSION) {
      throw new Error(`Unsupported session event schema version: ${event.schemaVersion}`);
    }
    if (event.seq !== expectedSequence) {
      throw new Error(`Session event sequence gap: expected ${expectedSequence}, got ${event.seq}`);
    }
    expectedSequence += 1;
    if (eventIds.has(event.eventId))
      throw new Error(`Duplicate session event id: ${event.eventId}`);
    eventIds.add(event.eventId);
    assertEventPayload(event);
    assertNoRepeatedCallIds(event, proposalIds, dispatchIds, resultIds);
    return cloneEvent(event);
  });

  return copy;
}

/**
 * 检查单次追加批次中不会重复声明或结束同一调用。
 * @param event 当前事件。
 * @param proposals 批次中已声明的工具调用。
 * @param dispatches 批次中已提交分派的调用。
 * @param results 批次中已有结果的调用。
 */
function assertNoRepeatedCallIds(
  event: SessionEvent,
  proposals: Set<string>,
  dispatches: Set<string>,
  results: Set<string>,
): void {
  if (event.type === 'model_message') {
    for (const message of event.messages) {
      if (message.role !== 'assistant' || message.tool_calls === undefined) continue;
      if (!isJsonArray(message.tool_calls))
        throw new Error('Assistant tool_calls must be an array');
      for (const call of message.tool_calls) {
        const proposal = readToolCallProposal(call, event);
        const key = callKey(event.runId, proposal.callId);
        if (proposals.has(key)) throw new Error('Duplicate model tool call in batch: ' + key);
        proposals.add(key);
      }
    }
    return;
  }
  if (event.type === 'tool_dispatch_committed') {
    const key = callKey(event.runId, event.callId);
    if (dispatches.has(key)) throw new Error('Duplicate tool dispatch in batch: ' + key);
    dispatches.add(key);
    return;
  }
  if (event.type === 'tool_result' || event.type === 'recovery_result') {
    const key = callKey(event.runId, event.callId);
    if (results.has(key)) throw new Error('Duplicate tool result in batch: ' + key);
    results.add(key);
  }
}

interface ToolCallProposal {
  readonly toolName: string;
  readonly argumentsJson: string;
  readonly turnId: string;
  readonly round: number;
}

/**
 * 验证模型工具调用、已提交分派与最终结果的身份和顺序。
 * @param event 当前事件。
 * @param proposals 已见模型调用。
 * @param dispatches 已提交工具分派。
 * @param results 已记录结果的调用身份。
 */
function validateCallPairing(
  event: SessionEvent,
  proposals: Map<string, ToolCallProposal>,
  dispatches: Map<string, ToolCallProposal>,
  results: Set<string>,
): void {
  if (event.type === 'model_message') {
    for (const message of event.messages) {
      if (message.role !== 'assistant') continue;
      const calls = message.tool_calls;
      if (calls === undefined) continue;
      if (!isJsonArray(calls)) throw new Error('Assistant tool_calls must be an array');
      for (const rawCall of calls) {
        const proposal = readToolCallProposal(rawCall, event);
        const key = callKey(event.runId, proposal.callId);
        if (proposals.has(key)) throw new Error('Duplicate model tool call: ' + key);
        proposals.set(key, proposal);
      }
    }
    return;
  }
  if (
    event.type !== 'tool_dispatch_committed' &&
    event.type !== 'tool_result' &&
    event.type !== 'recovery_result'
  ) {
    return;
  }

  const key = callKey(event.runId, event.callId);
  const proposal = proposals.get(key);
  if (!proposal) throw new Error('Tool event has no prior model call: ' + key);
  if (proposal.toolName !== event.toolName)
    throw new Error('Tool name does not match model call: ' + key);

  if (event.type === 'tool_dispatch_committed') {
    if (dispatches.has(key)) throw new Error('Duplicate tool dispatch: ' + key);
    if (proposal.argumentsJson !== event.argumentsJson) {
      throw new Error('Tool arguments do not match model call: ' + key);
    }
    dispatches.set(key, proposal);
    return;
  }
  if (results.has(key)) throw new Error('Duplicate tool result: ' + key);
  if (event.type === 'tool_result' && event.dispatchCommitted && !dispatches.has(key)) {
    throw new Error('Tool result has no committed dispatch: ' + key);
  }
  if (event.type === 'tool_result' && !event.dispatchCommitted && dispatches.has(key)) {
    throw new Error('Tool result dispatch marker does not match history: ' + key);
  }
  if (event.type === 'recovery_result') {
    const wasDispatched = dispatches.has(key);
    if (event.status === 'not_started' && wasDispatched) {
      throw new Error('Dispatched tool cannot be marked not started: ' + key);
    }
    if (event.status === 'outcome_unknown' && !wasDispatched) {
      throw new Error('Undispatched tool cannot have an unknown outcome: ' + key);
    }
  }
  results.add(key);
}

/**
 * 读取并验证一个 provider-neutral 工具调用对象。
 * @param value 待验证的工具调用 JSON。
 * @param event 包含该调用的模型事件。
 * @returns 稳定调用身份与原始参数。
 */
function readToolCallProposal(
  value: JsonValue,
  event: Extract<SessionEvent, { type: 'model_message' }>,
): ToolCallProposal & { callId: string } {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !isPlainObject(value) ||
    typeof value.id !== 'string' ||
    !value.id.trim()
  ) {
    throw new Error('Assistant tool call has an invalid id');
  }
  const fn = value.function;
  if (
    fn === null ||
    typeof fn !== 'object' ||
    Array.isArray(fn) ||
    !isPlainObject(fn) ||
    typeof fn.name !== 'string'
  ) {
    throw new Error('Assistant tool call has an invalid function: ' + value.id);
  }
  if (typeof fn.arguments !== 'string') {
    throw new Error('Assistant tool call has non-string arguments: ' + value.id);
  }
  return {
    callId: value.id,
    toolName: fn.name,
    argumentsJson: fn.arguments,
    turnId: event.turnId,
    round: event.round,
  };
}

/**
 * 判断 JSON 值是否为数组。
 * @param value 待判断值。
 * @returns 是否为 JSON 数组。
 */
function isJsonArray(value: JsonValue): value is JsonValue[] {
  return Array.isArray(value);
}

/**
 * 创建会话运行内唯一的调用键。
 * @param runId 运行标识。
 * @param callId 工具调用标识。
 * @returns 组合调用键。
 */
function callKey(runId: string, callId: string): string {
  return runId + ':' + callId;
}

/**
 * 深拷贝通过验证的 JSON 值，拒绝循环和非 JSON 类型。
 * @param value 待验证的值。
 * @param path 用于诊断的字段路径。
 * @param ancestors 当前对象的祖先集合。
 * @returns 防御性 JSON 拷贝。
 */
function cloneJson(value: unknown, path = 'event', ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number at ${path}`);
    return value;
  }
  if (typeof value !== 'object') throw new Error(`Non-JSON value at ${path}`);
  if (ancestors.has(value)) throw new Error(`Circular value at ${path}`);
  ancestors.add(value);
  try {
    if (Array.isArray(value))
      return value.map((item, index) => cloneJson(item, `${path}[${index}]`, ancestors));
    if (!isPlainObject(value)) throw new Error(`Non-plain object at ${path}`);
    const clone: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      clone[key] = cloneJson(child, `${path}.${key}`, ancestors);
    }
    return clone;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * 深拷贝事件载荷，同时保留已判别的事件类型。
 * @param event 已完成结构验证的事件。
 * @returns 不与调用者共享嵌套对象的事件副本。
 */
function cloneEvent(event: SessionEvent): SessionEvent {
  switch (event.type) {
    case 'user_message':
      return { ...event, content: cloneJson(event.content, 'content') };
    case 'model_message':
      return { ...event, messages: cloneMessages(event.messages) };
    case 'context_snapshot':
      return { ...event, messages: cloneMessages(event.messages) };
    case 'tool_catalog':
      return { ...event, tools: event.tools.map((tool) => cloneJson(tool, 'tool')) };
    case 'tool_result':
    case 'recovery_result':
      return { ...event, message: cloneMessage(event.message) };
    case 'turn_started':
    case 'tool_dispatch_committed':
    case 'approval':
    case 'run_terminal':
    case 'turn_interrupted':
      return { ...event };
    default:
      return assertNever(event);
  }
}

/**
 * 深拷贝结构化模型消息。
 * @param message 已验证模型消息。
 * @returns 不共享嵌套值的模型消息副本。
 */
function cloneMessage(message: SessionStoredModelMessage): SessionStoredModelMessage {
  const clone: { role: string; [key: string]: JsonValue | undefined } = { role: message.role };
  for (const [key, value] of Object.entries(message)) {
    if (key !== 'role') clone[key] = cloneJson(value, 'message.' + key);
  }
  return clone;
}

/**
 * 深拷贝一组模型消息。
 * @param messages 已验证消息列表。
 * @returns 防御性消息列表副本。
 */
function cloneMessages(
  messages: readonly SessionStoredModelMessage[],
): SessionStoredModelMessage[] {
  return messages.map(cloneMessage);
}

/**
 * 验证一个会话事件的公共身份字段。
 * @param event 待验证事件。
 * @param index 事件在输入数组中的索引。
 */
function assertEvent(event: SessionEvent, index: number): void {
  if (!event || typeof event !== 'object') throw new Error(`Invalid session event at ${index}`);
  for (const field of ['conversationId', 'eventId', 'runId', 'turnId', 'createdAt'] as const) {
    if (typeof event[field] !== 'string' || !event[field].trim()) {
      throw new Error(`Session event ${index} has an invalid ${field}`);
    }
  }
  assertPositiveInteger(event.seq, `event[${index}].seq`);
  if (typeof event.type !== 'string') throw new Error(`Session event ${index} has no type`);
}

/**
 * 验证事件载荷字段、消息角色与时间值。
 * @param event 待验证事件。
 */
function assertEventPayload(event: SessionEvent): void {
  switch (event.type) {
    case 'turn_started':
      if (event.originRunId !== undefined) requireText(event.originRunId, 'originRunId');
      if (event.recoveryActionId !== undefined) {
        requireText(event.recoveryActionId, 'recoveryActionId');
      }
      if (
        event.recoveryAction !== undefined &&
        event.recoveryAction !== 'continue' &&
        event.recoveryAction !== 'retry'
      ) {
        throw new Error('Recovery action must be continue or retry');
      }
      if (event.recoveryActionId !== undefined && event.originRunId === undefined) {
        throw new Error('Recovery action turn must reference its origin run');
      }
      return;
    case 'run_terminal':
    case 'turn_interrupted':
      return;
    case 'user_message':
      requireText(event.messageId, 'messageId');
      cloneJson(event.content, 'content');
      return;
    case 'model_message':
    case 'context_snapshot':
      assertPositiveInteger(event.round, 'round');
      if (event.type === 'model_message' && event.messageId !== undefined) {
        requireText(event.messageId, 'messageId');
      }
      if (event.type === 'context_snapshot') {
        requireText(event.source, 'source');
        if (event.scope === 'anchor') requireText(event.anchorMessageId ?? '', 'anchorMessageId');
        if (event.scope !== 'anchor' && event.anchorMessageId !== undefined) {
          throw new Error('Only anchored context may name an anchor message');
        }
      }
      assertMessages(event.messages);
      return;
    case 'tool_catalog':
      assertPositiveInteger(event.round, 'round');
      cloneJson(event.tools, 'tools');
      return;
    case 'tool_dispatch_committed':
      assertPositiveInteger(event.round, 'round');
      requireText(event.callId, 'callId');
      requireText(event.toolName, 'toolName');
      if (!['safe', 'idempotency_key', 'never'].includes(event.retrySafety)) {
        throw new Error(`Invalid retry safety: ${event.retrySafety}`);
      }
      assertJsonString(event.argumentsJson, 'argumentsJson');
      return;
    case 'tool_result':
      assertPositiveInteger(event.round, 'round');
      requireText(event.callId, 'callId');
      requireText(event.toolName, 'toolName');
      if (typeof event.dispatchCommitted !== 'boolean') {
        throw new Error('Tool result must identify whether dispatch was committed');
      }
      if (event.status === 'success' && !event.dispatchCommitted) {
        throw new Error('Tool cannot succeed before dispatch');
      }
      if (event.status === 'outcome_unknown' && !event.dispatchCommitted) {
        throw new Error('Tool outcome cannot be unknown before dispatch');
      }
      if (event.message.role !== 'tool' || event.message.tool_call_id !== event.callId) {
        throw new Error('Tool result message does not match call ' + event.callId);
      }
      if (
        event.durationMs !== undefined &&
        (!Number.isFinite(event.durationMs) || event.durationMs < 0)
      ) {
        throw new Error('Tool duration must be a non-negative finite number');
      }
      assertMessages([event.message]);
      return;
    case 'recovery_result':
      assertPositiveInteger(event.round, 'round');
      requireText(event.callId, 'callId');
      requireText(event.toolName, 'toolName');
      if (event.message.role !== 'tool' || event.message.tool_call_id !== event.callId) {
        throw new Error('Recovery message does not match call ' + event.callId);
      }
      assertMessages([event.message]);
      return;
    case 'approval':
      requireText(event.callId, 'callId');
      requireText(event.toolName, 'toolName');
      if (event.reason !== undefined) requireText(event.reason, 'reason');
      return;
    default:
      assertNever(event);
  }
}

/**
 * 验证适配器消息是可 JSON 持久化的普通对象并包含角色。
 * @param messages 待验证消息。
 */
function assertMessages(messages: readonly SessionStoredModelMessage[]): void {
  if (!Array.isArray(messages)) throw new Error('Session messages must be an array');
  messages.forEach((message, index) => {
    if (!isPlainObject(message) || typeof message.role !== 'string' || !message.role.trim()) {
      throw new Error(`Session message ${index} has no role`);
    }
    cloneJson(message, `messages[${index}]`);
  });
}

/**
 * 确认原始工具参数是合法 JSON 字符串，且 JSON 根值可安全存储。
 * @param value 原始参数字符串。
 * @param field 字段名。
 */
function assertJsonString(value: string, field: string): void {
  requireText(value, field);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON in ${field}`, { cause: error });
  }
  cloneJson(parsed, field);
}

/**
 * 要求文本字段非空。
 * @param value 字段值。
 * @param field 字段名。
 */
function requireText(value: string, field: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Session ${field} is required`);
}

/**
 * 验证安全正整数。
 * @param value 数值。
 * @param field 字段名。
 */
function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${field}: ${value}`);
}

/**
 * 确认对象使用普通 JSON 原型。
 * @param value 待判断值。
 * @returns 是否为普通对象。
 */
function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * 处理穷尽联合类型检查。
 * @param value 不应到达的事件类型。
 */
function assertNever(value: never): never {
  throw new Error(`Unknown session event: ${String(value)}`);
}
