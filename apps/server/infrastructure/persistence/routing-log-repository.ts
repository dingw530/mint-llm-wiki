import { getDb } from '../../db.js';

export interface RoutingLogEntry {
  id: string;
  conversation_id: string | null;
  message_id: string | null;
  agent_id: string;
  confidence: number;
  method: string;
  latency_ms: number;
  message_preview: string | null;
  locked_agent: string | null;
  routing_mode: string | null;
  created_at: string;
}

export interface RoutingLogFilter {
  conversationId?: string;
  page?: number;
  pageSize?: number;
}

export interface RoutingLogResult {
  id: string;
  conversationId: string | null;
  messageId: string | null;
  agentId: string;
  confidence: number;
  method: string;
  latencyMs: number;
  messagePreview: string | null;
  lockedAgent: string | null;
  routingMode: string | null;
  createdAt: string;
}

function toCamelCase(row: RoutingLogEntry): RoutingLogResult {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    agentId: row.agent_id,
    confidence: row.confidence,
    method: row.method,
    latencyMs: row.latency_ms,
    messagePreview: row.message_preview,
    lockedAgent: row.locked_agent,
    routingMode: row.routing_mode,
    createdAt: row.created_at,
  };
}

export function create(entry: RoutingLogEntry): void {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO routing_logs (id, conversation_id, message_id, agent_id, confidence, method, latency_ms, message_preview, locked_agent, routing_mode, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    entry.id,
    entry.conversation_id,
    entry.message_id,
    entry.agent_id,
    entry.confidence,
    entry.method,
    entry.latency_ms,
    entry.message_preview,
    entry.locked_agent,
    entry.routing_mode,
    entry.created_at,
  );
}

export function findAll(filter: RoutingLogFilter = {}): RoutingLogResult[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.conversationId) {
    conditions.push('conversation_id = ?');
    params.push(filter.conversationId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = filter.page || 1;
  const pageSize = filter.pageSize || 20;
  const offset = (page - 1) * pageSize;

  const rows = db
    .prepare(`SELECT * FROM routing_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as RoutingLogEntry[];

  return rows.map(toCamelCase);
}
