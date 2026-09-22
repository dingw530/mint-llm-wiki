import { getDb } from '../db.js';
import type { EndpointRow, Endpoint } from '../types.js';

function toCamelCase(row: EndpointRow): Endpoint {
  return {
    id: row.id,
    name: row.name,
    apiUrl: row.api_url,
    apiKey: row.api_key,
    modelId: row.model_id,
    apiType: row.api_type,
    verifiedAt: row.verified_at ?? null,
    isActive: row.is_active === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAll(): Endpoint[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT id, name, api_url, api_key, model_id, api_type, verified_at, is_active, sort_order, created_at, updated_at FROM model_endpoints ORDER BY sort_order, created_at',
    )
    .all() as EndpointRow[];
  return rows.map(toCamelCase);
}

export function getActive(): Endpoint | null {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT id, name, api_url, api_key, model_id, api_type, is_active, sort_order, created_at, updated_at FROM model_endpoints WHERE is_active = 1 LIMIT 1',
    )
    .get() as EndpointRow | undefined;
  return row ? toCamelCase(row) : null;
}

export function getById(id: string): Endpoint | null {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT id, name, api_url, api_key, model_id, api_type, verified_at, is_active, sort_order, created_at, updated_at FROM model_endpoints WHERE id = ?',
    )
    .get(id) as EndpointRow | undefined;
  return row ? toCamelCase(row) : null;
}

export function insert(endpoint: {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  modelId: string;
  apiType?: string;
  isActive: boolean;
  sortOrder: number;
}): Endpoint {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO model_endpoints (id, name, api_url, api_key, model_id, api_type, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    endpoint.id,
    endpoint.name,
    endpoint.apiUrl,
    endpoint.apiKey,
    endpoint.modelId,
    endpoint.apiType || 'openai-chat',
    endpoint.isActive ? 1 : 0,
    endpoint.sortOrder,
    now,
    now,
  );
  return {
    id: endpoint.id,
    name: endpoint.name,
    apiUrl: endpoint.apiUrl,
    apiKey: endpoint.apiKey,
    modelId: endpoint.modelId,
    apiType: endpoint.apiType || 'openai-chat',
    isActive: endpoint.isActive,
    sortOrder: endpoint.sortOrder,
    createdAt: now,
    updatedAt: now,
  };
}

export function update(
  id: string,
  fields: Partial<{
    name: string;
    apiUrl: string;
    apiKey: string;
    modelId: string;
    apiType: string;
    isActive: boolean;
    sortOrder: number;
  }>,
): Endpoint | null {
  const db = getDb();
  const now = new Date().toISOString();
  const setClauses: string[] = ['updated_at = ?'];
  const params: unknown[] = [now];

  if (fields.name !== undefined) {
    setClauses.push('name = ?');
    params.push(fields.name);
  }
  if (fields.apiUrl !== undefined) {
    setClauses.push('api_url = ?');
    params.push(fields.apiUrl);
  }
  if (fields.apiKey !== undefined) {
    setClauses.push('api_key = ?');
    params.push(fields.apiKey);
  }
  if (fields.modelId !== undefined) {
    setClauses.push('model_id = ?');
    params.push(fields.modelId);
  }
  if (fields.apiType !== undefined) {
    setClauses.push('api_type = ?');
    params.push(fields.apiType);
  }
  if (fields.isActive !== undefined) {
    setClauses.push('is_active = ?');
    params.push(fields.isActive ? 1 : 0);
  }
  if (fields.sortOrder !== undefined) {
    setClauses.push('sort_order = ?');
    params.push(fields.sortOrder);
  }

  params.push(id);
  const result = db
    .prepare(`UPDATE model_endpoints SET ${setClauses.join(', ')} WHERE id = ?`)
    .run(...params);
  if (result.changes === 0) return null;
  return getById(id);
}

export function del(id: string): { changes: number } {
  const db = getDb();
  return db.prepare('DELETE FROM model_endpoints WHERE id = ?').run(id);
}

export function setActive(id: string): void {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare('UPDATE model_endpoints SET is_active = 0').run();
    db.prepare('UPDATE model_endpoints SET is_active = 1, updated_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      id,
    );
  });
  transaction();
}

export function count(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as cnt FROM model_endpoints').get() as { cnt: number };
  return row.cnt;
}

/** Returns the active text endpoint only when it has a successful connection verification. */
export function getVerifiedActive(): Endpoint | null {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT id, name, api_url, api_key, model_id, api_type, verified_at, is_active, sort_order, created_at, updated_at FROM model_endpoints WHERE is_active = 1 AND verified_at IS NOT NULL LIMIT 1',
    )
    .get() as EndpointRow | undefined;
  return row ? toCamelCase(row) : null;
}

/** Marks one endpoint as verified after a successful live model request. */
export function markVerified(id: string, verifiedAt: string): Endpoint | null {
  const db = getDb();
  const result = db
    .prepare('UPDATE model_endpoints SET verified_at = ?, updated_at = ? WHERE id = ?')
    .run(verifiedAt, verifiedAt, id);
  return result.changes > 0 ? getById(id) : null;
}

/** Invalidates a connection verification after its endpoint settings change. */
export function clearVerification(id: string): void {
  const db = getDb();
  db.prepare('UPDATE model_endpoints SET verified_at = NULL, updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}
