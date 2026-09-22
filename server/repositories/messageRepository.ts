import { getDb } from '../db.js';
import type { MessageRow, Message, HistoryMessage, CreateMessageParams } from '../types.js';

// 数据库 snake_case → API camelCase 转换
function toCamelCase(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    reasoning: row.reasoning,
    createdAt: row.created_at,
  };
}

// 获取会话的全部消息（按创建时间升序）
export function findByConversationId(conversationId: string): Message[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT id, conversation_id, role, content, reasoning, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    )
    .all(conversationId) as MessageRow[];
  return rows.map(toCamelCase);
}

export function create(params: CreateMessageParams): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, reasoning, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    params.id,
    params.conversationId,
    params.role,
    params.content,
    params.reasoning ?? null,
    params.createdAt,
  );
}

// 获取消息历史（精简字段，用于发送给 AI）
export function getHistory(conversationId: string): HistoryMessage[] {
  const db = getDb();
  return db
    .prepare(
      'SELECT role, content, reasoning FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    )
    .all(conversationId) as HistoryMessage[];
}

/** Returns conversation history ending at a durable user-message reference. */
export function getHistoryThroughMessageId(
  conversationId: string,
  messageId: string,
): HistoryMessage[] {
  const messages = findByConversationId(conversationId);
  const endIndex = messages.findIndex((message) => message.id === messageId);
  if (endIndex < 0) throw new Error('Recovery origin message was not found');
  return messages.slice(0, endIndex + 1).map((message) => ({
    role: message.role,
    content: message.content,
    reasoning: message.reasoning,
  }));
}

// 同步更新会话的最新活动时间
export function updateConversationTimestamp(conversationId: string, timestamp: string): void {
  const db = getDb();
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(timestamp, conversationId);
}
