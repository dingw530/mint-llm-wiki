import * as fs from '../../infrastructure/filesystem/wiki-files.js';
import * as path from 'path';
import { getConfiguredWikiPath } from '../../infrastructure/config/wiki-settings.js';
import { normalizeWikiSchema } from '../../infrastructure/filesystem/wiki-files.js';
import type { WikiCategory, WikiSchema } from '../../services/utils/wikiShared.js';
import * as lifecycleRepo from '../../infrastructure/persistence/wiki-lifecycle-repository.js';
import { calculateWikiRetentionScore } from './wiki-retention.js';

interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  modifiedAt: number;
  children?: FileTreeNode[];
}

interface WikiListResponse {
  tree: FileTreeNode[];
  total: number;
}

interface WikiReadResponse {
  content: string;
  path: string;
  name: string;
  size: number;
}

export interface WikiHeatPage {
  id: string;
  path: string;
  title: string;
  status: lifecycleRepo.WikiPageStatus;
  accessCount: number;
  confidence: number;
  importance: number;
  retentionScore: number;
  lastAccessedAt: string | null;
  lastConfirmedAt: string | null;
}

export interface WikiHeatResponse {
  summary: {
    totalPages: number;
    activePages: number;
    stalePages: number;
    archivedPages: number;
    totalAccesses: number;
  };
  pages: WikiHeatPage[];
}

function getRootPath(): string {
  const wikiPath = getConfiguredWikiPath();
  if (!wikiPath) throw new Error('Wiki 路径未配置');
  return wikiPath;
}

function isPathSafe(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, target);
  return resolvedTarget.startsWith(resolvedRoot + path.sep) || resolvedTarget === resolvedRoot;
}

/**
 * 生成用于兼容 Wiki 文件名规范化差异的比较键。
 *
 * @param fileName 文件名
 * @returns 忽略连字符、空白和大小写后的比较键
 */
function getWikiFileNameKey(fileName: string): string {
  const name = fileName
    .normalize('NFC')
    .replace(/[\s-]+/g, '')
    .toLocaleLowerCase();
  return name;
}

/**
 * 在同一目录中解析因 AI 省略文件名连字符而产生的唯一候选文件。
 *
 * @param requestedPath 请求的 Wiki 文件路径
 * @returns 唯一匹配的实际路径，无法唯一匹配时返回 null
 */
function resolveNormalizedWikiFilePath(requestedPath: string): string | null {
  const directory = path.dirname(requestedPath);
  const requestedName = path.basename(requestedPath);
  if (!fs.existsSync(directory)) return null;

  const requestedKey = getWikiFileNameKey(requestedName);
  const candidates = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => getWikiFileNameKey(entry.name) === requestedKey)
    .map((entry) => path.join(directory, entry.name));
  return candidates.length === 1 ? candidates[0] : null;
}

export function listWiki(): WikiListResponse {
  const rootPath = getRootPath();
  if (!fs.existsSync(rootPath)) {
    return { tree: [], total: 0 };
  }
  const tree = buildFileTree(rootPath, rootPath);
  const total = countFiles(tree);
  return { tree, total };
}

export function readWiki(filePath: string): WikiReadResponse {
  if (!filePath) throw new Error('缺少 path 参数');

  const rootPath = getRootPath();
  if (!isPathSafe(rootPath, filePath)) throw new Error('路径穿越被拒绝');

  let resolvedPath = path.resolve(rootPath, filePath);
  if (!fs.existsSync(resolvedPath)) {
    const normalizedPath = resolveNormalizedWikiFilePath(resolvedPath);
    if (!normalizedPath) throw new Error('文件不存在');
    resolvedPath = normalizedPath;
  }

  const stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) throw new Error('路径是目录，请指定文件');

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  return {
    content,
    path: path.relative(rootPath, resolvedPath),
    name: path.basename(filePath),
    size: stat.size,
  };
}

/** 返回知识库热度排行和生命周期汇总。 */
export function getWikiHeat(limit = 30): WikiHeatResponse {
  const pages = lifecycleRepo.listPagesForHeat();
  const summary = {
    totalPages: pages.length,
    activePages: pages.filter((page) => page.status === 'active').length,
    stalePages: pages.filter((page) => page.status === 'stale').length,
    archivedPages: pages.filter((page) => page.status === 'archived').length,
    totalAccesses: pages.reduce((total, page) => total + page.accessCount, 0),
  };
  const ranked = pages
    .filter((page) => !['deleted', 'superseded'].includes(page.status))
    .map((page) => ({
      id: page.id,
      path: page.path,
      title: page.title,
      status: page.status,
      accessCount: page.accessCount,
      confidence: page.confidence,
      importance: page.importance,
      retentionScore: calculateWikiRetentionScore(page),
      lastAccessedAt: page.lastAccessedAt,
      lastConfirmedAt: page.lastConfirmedAt,
    }))
    .sort((a, b) => b.retentionScore - a.retentionScore || b.accessCount - a.accessCount)
    .slice(0, Math.max(1, Math.min(limit, 100)));
  return { summary, pages: ranked };
}

function buildFileTree(rootDir: string, currentDir: string): FileTreeNode[] {
  const entries: FileTreeNode[] = [];
  const items = fs.readdirSync(currentDir);

  for (const item of items.sort()) {
    const entry = buildFileEntry(rootDir, currentDir, item);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Build one visible entry using the existing directory and supported-file rules. */
function buildFileEntry(rootDir: string, currentDir: string, item: string): FileTreeNode | null {
  const fullPath = path.join(currentDir, item);
  const stat = fs.statSync(fullPath);
  const relativePath = path.relative(rootDir, fullPath);

  if (stat.isDirectory()) {
    const children = buildFileTree(rootDir, fullPath);
    return {
      name: item,
      type: 'directory',
      path: relativePath,
      modifiedAt: stat.mtimeMs,
      children,
    };
  } else if (
    (item.endsWith('.md') ||
      item === '_schema.json' ||
      item === '_manifest.json' ||
      /\.(html?|txt|pdf)$/i.test(item)) &&
    item !== '.gitkeep'
  ) {
    return { name: item, type: 'file', path: relativePath, modifiedAt: stat.mtimeMs };
  }
  return null;
}

function countFiles(tree: FileTreeNode[]): number {
  let count = 0;
  for (const node of tree) {
    if (node.type === 'file') count++;
    if (node.children) count += countFiles(node.children);
  }
  return count;
}

// ── Schema / Category Management ──

export function getSchema(): WikiSchema {
  const rootPath = getRootPath();
  const schemaPath = path.join(rootPath, '_schema.json');
  if (!fs.existsSync(schemaPath)) {
    return { categories: [] };
  }
  try {
    const schema = normalizeWikiSchema(JSON.parse(fs.readFileSync(schemaPath, 'utf-8')));
    fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2), 'utf-8');
    return schema;
  } catch {
    return { categories: [] };
  }
}

export function updateSchema(schema: WikiSchema): WikiSchema {
  const rootPath = getRootPath();
  const schemaPath = path.join(rootPath, '_schema.json');
  const normalized = normalizeWikiSchema(schema);
  const names = new Set<string>();
  for (const category of normalized.categories) {
    if (names.has(category.name)) throw new Error(`分类 "${category.name}" 已存在`);
    names.add(category.name);
  }
  fs.writeFileSync(schemaPath, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

export function addCategory(category: string): WikiSchema {
  const schema = getSchema();
  if (!schema.categories) schema.categories = [];
  const cat = category.trim();
  if (!cat) throw new Error('分类名不能为空');
  if (schema.categories.some((item) => item.name === cat)) throw new Error(`分类 "${cat}" 已存在`);
  schema.categories.push({ name: cat, description: '', include: [], exclude: [] });
  schema.categories.sort((a, b) => a.name.localeCompare(b.name));
  return updateSchema(schema);
}

export function removeCategory(category: string): WikiSchema {
  const schema = getSchema();
  if (!schema.categories) schema.categories = [];
  schema.categories = schema.categories.filter((c: WikiCategory) => c.name !== category);
  return updateSchema(schema);
}
