import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import { normalizeGraphRelation } from '../utils/graphOntology.js';

// ── 类型定义 ──

export interface GraphNodeRow {
  id: string;
  label: string;
  type: string;
  source_file: string | null;
  properties: string;
  created_at: string;
  updated_at: string;
}

export interface GraphEdgeRow {
  id: string;
  source_id: string;
  relation: string;
  target_id: string;
  properties: string;
  source: string;
  created_at: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  sourceFile: string | null;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  relation: string;
  targetId: string;
  properties: Record<string, unknown>;
  source: string;
  createdAt: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface CreateNodeParams {
  label: string;
  type: string;
  sourceFile?: string | null;
  properties?: Record<string, unknown>;
}

export interface CreateEdgeParams {
  sourceId: string;
  relation: string;
  targetId: string;
  properties?: Record<string, unknown>;
  source?: 'manual' | 'auto-extracted' | 'ai-generated';
}

// ── Converter ──

function toCamelCaseNode(row: GraphNodeRow): GraphNode {
  return {
    id: row.id,
    label: row.label,
    type: row.type,
    sourceFile: row.source_file,
    properties: parseJson(row.properties),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCamelCaseEdge(row: GraphEdgeRow): GraphEdge {
  return {
    id: row.id,
    sourceId: row.source_id,
    relation: row.relation,
    targetId: row.target_id,
    properties: parseJson(row.properties),
    source: row.source,
    createdAt: row.created_at,
  };
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ── Graph Data ──

export function getGraphData(): GraphData {
  const db = getDb();
  const nodes = db
    .prepare<unknown[], GraphNodeRow>(
      'SELECT id, label, type, source_file, properties, created_at, updated_at FROM graph_nodes ORDER BY label',
    )
    .all();
  const edges = db
    .prepare<unknown[], GraphEdgeRow>(
      'SELECT id, source_id, relation, target_id, properties, source, created_at FROM graph_edges ORDER BY created_at',
    )
    .all();
  return {
    nodes: nodes.map(toCamelCaseNode),
    edges: edges.map(toCamelCaseEdge),
  };
}

export function getNode(id: string): GraphNode | null {
  const db = getDb();
  const row = db
    .prepare<unknown[], GraphNodeRow>(
      'SELECT id, label, type, source_file, properties, created_at, updated_at FROM graph_nodes WHERE id = ?',
    )
    .get(id);
  return row ? toCamelCaseNode(row) : null;
}

export function getNodeNeighbors(id: string): { node: GraphNode; edges: GraphEdge[] } | null {
  const db = getDb();
  const row = db
    .prepare<unknown[], GraphNodeRow>(
      'SELECT id, label, type, source_file, properties, created_at, updated_at FROM graph_nodes WHERE id = ?',
    )
    .get(id);
  if (!row) return null;

  const edges = db
    .prepare<unknown[], GraphEdgeRow>(
      `SELECT id, source_id, relation, target_id, properties, source, created_at
     FROM graph_edges WHERE source_id = ? OR target_id = ?`,
    )
    .all(id, id);

  return { node: toCamelCaseNode(row), edges: edges.map(toCamelCaseEdge) };
}

export function searchNodes(query: string): GraphNode[] {
  const db = getDb();
  const rows = db
    .prepare<unknown[], GraphNodeRow>(
      'SELECT id, label, type, source_file, properties, created_at, updated_at FROM graph_nodes WHERE label LIKE ? ORDER BY label',
    )
    .all(`%${query}%`);
  return rows.map(toCamelCaseNode);
}

/**
 * 查询所有带 source_file 的节点（即有对应 wiki 页面的节点）。
 * 用于跨批次 TF-IDF 对比时读取已有页面内容。
 */
export function getAllNodesWithSource(): GraphNode[] {
  const db = getDb();
  const rows = db
    .prepare<unknown[], GraphNodeRow>(
      'SELECT id, label, type, source_file, properties, created_at, updated_at FROM graph_nodes WHERE source_file IS NOT NULL ORDER BY label',
    )
    .all();
  return rows.map(toCamelCaseNode);
}

/**
 * 获取所有边。
 * 用于跨批次对比时的去重检查。
 */
export function getAllEdges(): GraphEdge[] {
  const db = getDb();
  const rows = db
    .prepare<unknown[], GraphEdgeRow>(
      'SELECT id, source_id, relation, target_id, properties, source, created_at FROM graph_edges ORDER BY created_at',
    )
    .all();
  return rows.map(toCamelCaseEdge);
}

export function createNode(params: CreateNodeParams): GraphNode {
  if (!params.label || !params.label.trim()) {
    throw Object.assign(new Error('节点名称不能为空'), { status: 400 });
  }
  const db = getDb();
  const now = new Date().toISOString();
  const id = uuidv4();
  const properties = JSON.stringify(params.properties || {});

  db.prepare(
    'INSERT INTO graph_nodes (id, label, type, source_file, properties, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, params.label.trim(), params.type, params.sourceFile || null, properties, now, now);

  return {
    id,
    label: params.label.trim(),
    type: params.type,
    sourceFile: params.sourceFile || null,
    properties: params.properties || {},
    createdAt: now,
    updatedAt: now,
  };
}

/** 更新已有页面节点的 Schema 分类。 */
export function updateNodeType(id: string, type: string): void {
  const db = getDb();
  db.prepare('UPDATE graph_nodes SET type = ?, updated_at = ? WHERE id = ?').run(
    type,
    new Date().toISOString(),
    id,
  );
}

export function createEdge(params: CreateEdgeParams): GraphEdge {
  if (!params.relation || !params.relation.trim()) {
    throw Object.assign(new Error('关系类型不能为空'), { status: 400 });
  }
  const relation = normalizeGraphRelation(params.relation);
  if (!relation) {
    throw Object.assign(new Error(`不支持的关系类型: ${params.relation}`), { status: 400 });
  }
  const db = getDb();
  const now = new Date().toISOString();
  const id = uuidv4();
  const properties = JSON.stringify(params.properties || {});

  // Verify source and target nodes exist
  const source = db.prepare('SELECT id FROM graph_nodes WHERE id = ?').get(params.sourceId);
  const target = db.prepare('SELECT id FROM graph_nodes WHERE id = ?').get(params.targetId);
  if (!source) throw Object.assign(new Error(`源节点不存在: ${params.sourceId}`), { status: 400 });
  if (!target)
    throw Object.assign(new Error(`目标节点不存在: ${params.targetId}`), { status: 400 });

  db.prepare(
    'INSERT INTO graph_edges (id, source_id, relation, target_id, properties, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, params.sourceId, relation, params.targetId, properties, params.source || 'manual', now);

  return {
    id,
    sourceId: params.sourceId,
    relation,
    targetId: params.targetId,
    properties: params.properties || {},
    source: params.source || 'manual',
    createdAt: now,
  };
}

export function deleteNode(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM graph_nodes WHERE id = ?').run(id);
}

export function deleteEdge(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM graph_edges WHERE id = ?').run(id);
}

/**
 * 检查是否存在相同 sourceId + relation + targetId 的边。
 * 用于批量创建时的去重判断。
 */
export function findEdgeByTriple(
  sourceId: string,
  relation: string,
  targetId: string,
): GraphEdge | null {
  const db = getDb();
  const row = db
    .prepare<unknown[], GraphEdgeRow>(
      'SELECT id, source_id, relation, target_id, properties, source, created_at FROM graph_edges WHERE source_id = ? AND relation = ? AND target_id = ?',
    )
    .get(sourceId, relation, targetId);
  return row ? toCamelCaseEdge(row) : null;
}

// ── Transaction Support ──

/**
 * 在事务中执行回调函数。
 * 函数正常返回时自动提交，抛出异常时自动回滚。
 */
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  const wrapped = db.transaction(fn);
  return wrapped();
}
