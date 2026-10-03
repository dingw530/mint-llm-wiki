import { getDb } from '../../db.js';
import type { ConversationRow, Conversation } from '../../types.js';

// 数据库 snake_case → API camelCase 转换
function toCamelCase(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lockedAgent: row.locked_agent || null,
    routingMode: row.routing_mode || 'auto',
  };
}

// 获取所有会话，按更新时间降序，可选按 type 过滤
export function findAll(type?: string): Conversation[] {
  const db = getDb();
  let sql =
    'SELECT id, title, type, created_at, updated_at, locked_agent, routing_mode FROM conversations';
  const params: string[] = [];
  if (type) {
    sql += ' WHERE type = ?';
    params.push(type);
  }
  sql += ' ORDER BY updated_at DESC';
  const rows = db.prepare<string[], ConversationRow>(sql).all(...params);
  return rows.map(toCamelCase);
}

export function findById(id: string): Conversation | null {
  const db = getDb();
  const row = db
    .prepare<[string], ConversationRow>(
      'SELECT id, title, type, created_at, updated_at, locked_agent, routing_mode FROM conversations WHERE id = ?',
    )
    .get(id);
  return row ? toCamelCase(row) : null;
}

export function create({
  id,
  title,
  type,
  routingMode,
}: {
  id: string;
  title: string;
  type?: string;
  routingMode?: string;
}): Conversation {
  const db = getDb();
  const now = new Date().toISOString();
  const convType = type || 'text';
  const mode = routingMode || 'auto';
  db.prepare(
    'INSERT INTO conversations (id, title, type, created_at, updated_at, locked_agent, routing_mode) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, title, convType, now, now, null, mode);
  return {
    id,
    title,
    type: convType,
    createdAt: now,
    updatedAt: now,
    lockedAgent: null,
    routingMode: mode,
  };
}

// 删除会话，返回受影响行数（调用方据此判断是否 404）
export function deleteById(id: string): { changes: number } {
  const db = getDb();
  return db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

// 清空所有会话（messages 通过 CASCADE 自动删除）
export function deleteAll(): { changes: number } {
  const db = getDb();
  return db.prepare('DELETE FROM conversations').run();
}

export function updateTitle(id: string, title: string): Conversation | null {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
    .run(title, now, id);
  if (result.changes === 0) return null;
  return findById(id);
}

// 更新锁定 Agent（为 null 时解锁）
export function updateLockedAgent(id: string, lockedAgent: string | null): Conversation | null {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare('UPDATE conversations SET locked_agent = ?, updated_at = ? WHERE id = ?')
    .run(lockedAgent, now, id);
  if (result.changes === 0) return null;
  return findById(id);
}
