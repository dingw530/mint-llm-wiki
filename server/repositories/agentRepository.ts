import { getDb } from '../db.js';
import type { AgentRow, Agent } from '../types.js';

function toCamelCase(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    systemPrompt: row.system_prompt,
    mcpServerIds: JSON.parse(row.mcp_server_ids),
    available: row.available === 1,
    errorMessage: row.error_message,
    triggerKeywords: row.trigger_keywords ? JSON.parse(row.trigger_keywords) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function findAll(): Agent[] {
  const db = getDb();
  const rows = db
    .prepare<[], AgentRow>(
      'SELECT id, name, description, type, system_prompt, mcp_server_ids, available, error_message, trigger_keywords, created_at, updated_at FROM agents ORDER BY created_at ASC',
    )
    .all();
  return rows.map(toCamelCase);
}

export function findById(id: string): Agent | null {
  const db = getDb();
  const row = db
    .prepare<[string], AgentRow>(
      'SELECT id, name, description, type, system_prompt, mcp_server_ids, available, error_message, trigger_keywords, created_at, updated_at FROM agents WHERE id = ?',
    )
    .get(id);
  return row ? toCamelCase(row) : null;
}

export function create({
  id,
  name,
  description,
  type,
  systemPrompt,
  mcpServerIds,
  available,
  triggerKeywords,
}: {
  id: string;
  name: string;
  description?: string;
  type?: string;
  systemPrompt?: string | null;
  mcpServerIds?: string[];
  available?: boolean;
  triggerKeywords?: string[];
}): Agent {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO agents (id, name, description, type, system_prompt, mcp_server_ids, available, trigger_keywords, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    name,
    description || '',
    type || 'custom',
    systemPrompt || null,
    JSON.stringify(mcpServerIds || []),
    (available ?? true) ? 1 : 0,
    JSON.stringify(triggerKeywords || []),
    now,
    now,
  );
  return {
    id,
    name,
    description: description || '',
    type: type || 'custom',
    systemPrompt: systemPrompt || null,
    mcpServerIds: mcpServerIds || [],
    available: available ?? true,
    errorMessage: null,
    triggerKeywords: triggerKeywords || [],
    createdAt: now,
    updatedAt: now,
  };
}

export function update(
  id: string,
  fields: Partial<{
    name: string;
    description: string;
    type: string;
    systemPrompt: string | null;
    mcpServerIds: string[];
    available: boolean;
    errorMessage: string | null;
    triggerKeywords: string[];
  }>,
): Agent | null {
  const db = getDb();
  const now = new Date().toISOString();
  const setClauses: string[] = ['updated_at = ?'];
  const params: unknown[] = [now];

  if (fields.name !== undefined) {
    setClauses.push('name = ?');
    params.push(fields.name);
  }
  if (fields.description !== undefined) {
    setClauses.push('description = ?');
    params.push(fields.description);
  }
  if (fields.type !== undefined) {
    setClauses.push('type = ?');
    params.push(fields.type);
  }
  if (fields.systemPrompt !== undefined) {
    setClauses.push('system_prompt = ?');
    params.push(fields.systemPrompt);
  }
  if (fields.mcpServerIds !== undefined) {
    setClauses.push('mcp_server_ids = ?');
    params.push(JSON.stringify(fields.mcpServerIds));
  }
  if (fields.available !== undefined) {
    setClauses.push('available = ?');
    params.push(fields.available ? 1 : 0);
  }
  if (fields.errorMessage !== undefined) {
    setClauses.push('error_message = ?');
    params.push(fields.errorMessage);
  }
  if (fields.triggerKeywords !== undefined) {
    setClauses.push('trigger_keywords = ?');
    params.push(JSON.stringify(fields.triggerKeywords));
  }

  params.push(id);
  const result = db
    .prepare(`UPDATE agents SET ${setClauses.join(', ')} WHERE id = ?`)
    .run(...params);
  if (result.changes === 0) return null;
  return findById(id);
}

export function deleteById(id: string): { changes: number } {
  const db = getDb();
  return db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}
