import { getDb } from '../../db.js';
import type { McpServerRow, McpServer } from '../../types.js';

function toCamelCase(row: McpServerRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    args: parseStringArray(row.args),
    env: parseStringRecord(row.env),
    url: row.url,
    headers: parseStringRecord(row.headers),
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('Invalid MCP server string array');
  }
  return parsed;
}

function parseStringRecord(value: string): Record<string, string> {
  const parsed: unknown = JSON.parse(value);
  if (!isStringRecord(parsed)) {
    throw new Error('Invalid MCP server string record');
  }
  return parsed;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

export function findAll(): McpServer[] {
  const db = getDb();
  const rows = db
    .prepare<[], McpServerRow>(
      'SELECT id, name, command, args, env, url, headers, status, error_message, created_at, updated_at FROM mcp_servers ORDER BY created_at ASC',
    )
    .all();
  return rows.map(toCamelCase);
}

export function findById(id: string): McpServer | null {
  const db = getDb();
  const row = db
    .prepare<[string], McpServerRow>(
      'SELECT id, name, command, args, env, url, headers, status, error_message, created_at, updated_at FROM mcp_servers WHERE id = ?',
    )
    .get(id);
  return row ? toCamelCase(row) : null;
}

export function findByName(name: string): McpServer | null {
  const db = getDb();
  const row = db
    .prepare<[string], McpServerRow>(
      'SELECT id, name, command, args, env, url, headers, status, error_message, created_at, updated_at FROM mcp_servers WHERE name = ?',
    )
    .get(name);
  return row ? toCamelCase(row) : null;
}

export function create({
  id,
  name,
  command,
  args,
  env,
  url,
  headers,
}: {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
}): McpServer {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO mcp_servers (id, name, command, args, env, url, headers, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    name,
    command,
    JSON.stringify(args),
    JSON.stringify(env),
    url || null,
    JSON.stringify(headers || {}),
    'inactive',
    now,
    now,
  );
  return {
    id,
    name,
    command,
    args,
    env,
    url: url || null,
    headers: headers || {},
    status: 'inactive',
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function update(
  id: string,
  fields: Partial<{
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    url: string | null;
    headers: Record<string, string>;
    status: string;
    errorMessage: string | null;
  }>,
): McpServer | null {
  const db = getDb();
  const now = new Date().toISOString();
  const setClauses: string[] = ['updated_at = ?'];
  const params: unknown[] = [now];

  if (fields.name !== undefined) {
    setClauses.push('name = ?');
    params.push(fields.name);
  }
  if (fields.command !== undefined) {
    setClauses.push('command = ?');
    params.push(fields.command);
  }
  if (fields.args !== undefined) {
    setClauses.push('args = ?');
    params.push(JSON.stringify(fields.args));
  }
  if (fields.env !== undefined) {
    setClauses.push('env = ?');
    params.push(JSON.stringify(fields.env));
  }
  if (fields.url !== undefined) {
    setClauses.push('url = ?');
    params.push(fields.url || null);
  }
  if (fields.headers !== undefined) {
    setClauses.push('headers = ?');
    params.push(JSON.stringify(fields.headers));
  }
  if (fields.status !== undefined) {
    setClauses.push('status = ?');
    params.push(fields.status);
  }
  if (fields.errorMessage !== undefined) {
    setClauses.push('error_message = ?');
    params.push(fields.errorMessage);
  }

  params.push(id);
  const result = db
    .prepare(`UPDATE mcp_servers SET ${setClauses.join(', ')} WHERE id = ?`)
    .run(...params);
  if (result.changes === 0) return null;
  return findById(id);
}

export function deleteById(id: string): { changes: number } {
  const db = getDb();
  return db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
}
