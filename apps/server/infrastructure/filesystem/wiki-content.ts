import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import { isPathSafe } from './path-security.js';
import {
  createMintWikiLink,
  parseMintWikiLink,
  sanitizeWikiFilenamePath,
} from './wiki-link-protocol.js';

// ── Types ──

export interface Relationship {
  source: string;
  target: string;
  relation: string;
  reason?: string;
  evidence?: string;
  confidence?: number;
}

export interface CompiledPage {
  filename: string;
  title: string;
  summary?: string;
  tags: string[];
  created?: string;
  source?: string;
  content: string;
}

export interface WikiManifestEntry {
  id: string;
  sourceFile: string;
  archivedFiles: string[];
  pageFiles: string[];
  summary: string;
  createdAt: string;
}

export interface WikiManifest {
  version: number;
  entries: WikiManifestEntry[];
}

export interface WikiCategory {
  name: string;
  description: string;
  include: string[];
  exclude: string[];
}

export interface WikiSchema {
  version?: number;
  description?: string;
  categories: WikiCategory[];
  tags?: string[];
  [key: string]: unknown;
}

/** 将旧版字符串分类和新版对象分类统一为结构化定义。 */
export function normalizeWikiCategories(value: unknown): WikiCategory[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): WikiCategory | null => {
      if (typeof item === 'string') {
        const name = item.trim();
        return name ? { name, description: '', include: [], exclude: [] } : null;
      }
      if (!item || typeof item !== 'object') return null;

      const raw = item as Record<string, unknown>;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name) return null;
      const toStringArray = (candidate: unknown): string[] =>
        Array.isArray(candidate)
          ? candidate
              .map(String)
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
      return {
        name,
        description: typeof raw.description === 'string' ? raw.description.trim() : '',
        include: toStringArray(raw.include),
        exclude: toStringArray(raw.exclude),
      };
    })
    .filter((item): item is WikiCategory => item !== null);
}

/** 读取并规范化 Schema，兼容旧版 categories: string[]。 */
export function normalizeWikiSchema(value: unknown): WikiSchema {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    ...raw,
    categories: normalizeWikiCategories(raw.categories),
  } as WikiSchema;
}

export interface ParsedWikiPage {
  file: string;
  title: string;
  tags: string[];
  created: string;
  source: string;
  headings: string[];
  body: string;
}

export interface LooseWikiPage {
  filename: string;
  title: string;
  summary?: string;
  tags: string[];
  created: string;
  source: string;
  content: string;
}

export interface LooseWikiClaim {
  pageTitle: string;
  text: string;
  normalizedKey?: string;
  confidence?: number;
  importance?: number;
  evidence?: string;
  evidenceQuote?: string;
}

export interface LooseWikiParseResult {
  pages: LooseWikiPage[];
  claims?: LooseWikiClaim[];
  relationships: Relationship[];
  summary: string;
}

// ── Prompt ──

export const INGEST_SYSTEM_PROMPT = `你是一个知识编译助手，遵循 LLM Wiki 三层架构（Schema → Wiki → Sources）。

你的任务是将用户提供的原始资料编译为结构化的 Wiki 知识页面。

## 三层架构说明
- **Sources 层（sources/）**：原始资料已由工具保存，不可变
- **Wiki 知识层（pages/）**：你需要生成结构化的 Markdown 页面，放入 pages/ 目录
- **Schema 层（_schema.json）**：遵循此标签和分类规范

## 要求
1. 分析资料内容，提取关键知识点
2. 按独立知识主题拆分页面：短文且只有一个核心主题时可生成一篇；长文、包含多个章节或同时包含案例/方法/概念时，必须生成 2-6 篇页面。不要把整篇文章压缩成一篇总览页。
3. 每篇页面只承载一个核心主题，标题要能独立表达该主题；页面之间通过 relationships 和「关联页面」建立连接
4. 页面正文中的每个事实性结论都必须在 claims 中列出；不得补充原始资料没有的信息
5. 每个页面必须包含以下字段：
   - title: 页面标题
   - tags: [标签列表]
   - created: YYYY-MM-DD（当前日期）
   - source: {sourceFilename}（原始资料文件名）
6. 内容用 Markdown 编写，结构清晰
7. 文件名为 pages/分类/页面名.md，分类必须填写且不能为空。禁止将页面直接放在 pages/ 根目录下。
8. 页面分类必须从当前 Schema 提供的分类定义中选择，必须按页面自身主题判断，不得默认全部使用同一个分类
9. 页面之间使用 Mint Wiki 协议链接交叉引用
10. 每个页面正文末尾必须添加「关联页面」段落，引用已有知识库中相关的页面。格式：

## 关联页面
- [已有页面标题](mint-wiki://open?path=pages%2F分类%2F已有页面标题.md)
- 引用已有页面时必须使用 mint-wiki://open?path=，path 为 Wiki 根目录下的 URL 编码相对路径

输出前自检：长文是否已按独立主题拆成多页；每页分类是否符合当前 Schema 中的定义；如果所有页面都落入同一分类，必须重新检查是否遗漏了其他主题。

## 概念去重（重要）
在创建新页面之前，必须参考下方「已有知识库索引」，检查要创建的概念是否已存在。

{existingKnowledgeIndex}

判定规则：
- 如果新资料中的某个概念与已有页面「相同」（标题接近、主题重叠）→ 禁止为该概念创建新页面。改为在 relationships 中添加一条关系，将该概念关联到已有页面：
  - source: 新资料中涉及该概念的描述
  - target: 已有页面的 title
  - relation: "属于"或"基于"
  - reason: 说明为何判定为同一概念
- 如果新资料是对已有概念的补充或扩展 → 同样禁止创建新页面。将补充内容作为一条关系记录到 relationships 中。
- 如果新资料完全不涉及任何已有概念 → 正常创建新页面。
- 当新资料同时包含已有概念和新概念时 → 已有概念的仅建关系，新概念的正常创建页面。


## 关系提取

在 pages 数组外，额外输出 relationships 数组，描述本次生成的页面之间的语义关系。

预定义关系类型（必须从中选择，禁止自创）：

- 包含：父概念包含子概念，整体包含部分
- 属于：子类/实例属于父类/类别
- 基于：依赖/引用/前提关系
- 区别于：对比/区分，强调不同
- 演进到：旧方法/工具/范式 → 新方法/工具/范式的发展演进
- 演化自：当前方法/工具/范式 → 其前身或来源
- 提供：提供能力、输出、上下文
- 实现：实现/达成某个目标
- 支持：辅助、支撑某个能力
- 定义：定义/规范/约束
- 导致：原因、条件或问题 → 结果
- 应对：方案、机制或实践 → 它要解决的挑战
- 应用于：方法、技术或能力 → 使用场景
- 约束：规则、边界或条件 → 被限制的行为/方案
- 案例：实践或实例 → 所体现的方法/概念

关系必须符合源节点→目标节点的方向定义；如果无法判断方向或没有明确关系，不要输出该关系。

## 输出格式
纯 JSON（不要包含其他文字）：
{
  "pages": [
    {
      "filename": "pages/分类/页面名.md",
      "title": "页面标题",
      "summary": "一句话说明本页覆盖的核心主题",
      "tags": ["标签1"],
      "created": "YYYY-MM-DD",
      "source": "原始文件名",
      "content": "正文内容（纯 Markdown，不含 YAML frontmatter）"
    }
  ],
  "claims": [
    {
      "pageTitle": "页面标题",
      "text": "可独立验证的事实或结论",
      "normalizedKey": "稳定的主题键",
      "confidence": 0.0,
      "importance": 0.0,
      "evidenceQuote": "从原始资料逐字复制的证据片段"
    }
  ],
  "relationships": [
    {
      "source": "源页面标题",
      "target": "目标页面标题",
      "relation": "关系类型",
      "reason": "判断依据简明说明",
      "evidence": "来自原始资料的关键句或短语，最多 160 字",
      "confidence": 0.0
    }
  ],
  "summary": "一句话总结本次摄入"
}`;

// ── JSON Parse with fallback ──

/** AI 输出的 content 字段常含字面换行符和未转义双引号，
 *  标准 JSON.parse 必然失败。此函数通过逐字段提取绕过此问题：
 *  1. 先尝试标准 parse / 提取 {...}
 *  2. 若仍失败，用正则逐个提取 page 对象中的 filename/title/tags/content
 *  3. 对 content 字段，通过引号平衡算法安全截取原始内容并手动转义
 *  4. 对 claims / relationships 数组，保留仍可独立解析的 JSON 数组 */
function extractJsonArray(text: string, key: string): unknown[] | null {
  const keyMatch = new RegExp(`"${key}"\\s*:`).exec(text);
  if (!keyMatch) return null;

  const start = text.indexOf('[', keyMatch.index + keyMatch[0].length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(start, index + 1));
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** 将宽松解析得到的未知值收窄为可供证据校验使用的 Claim。 */
function parseLooseClaims(value: unknown[] | null): LooseWikiClaim[] {
  if (!value) return [];
  return value.filter(
    (item): item is LooseWikiClaim =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).pageTitle === 'string' &&
      typeof (item as Record<string, unknown>).text === 'string',
  );
}

/**
 * 从非标准 JSON 中提取结构化结果。
 */
export function tryParseLooseJson(text: string): LooseWikiParseResult | null {
  // 1. standard parse
  try {
    return JSON.parse(text);
  } catch {
    /* empty */
  }

  // 2. extract outermost { ... }
  const bs = text.indexOf('{');
  const be = text.lastIndexOf('}');
  if (bs >= 0 && be > bs) {
    try {
      return JSON.parse(text.slice(bs, be + 1));
    } catch {
      /* empty */
    }
  }

  // 3. field-by-field extraction when content has unescaped quotes/newlines
  const pages: LooseWikiPage[] = [];
  const pageRe =
    /\{\s*"filename"\s*:\s*"([^"]+)"\s*,\s*"title"\s*:\s*"([^"]+)"\s*,\s*(?:"summary"\s*:\s*"[^"]*"\s*,\s*)?"tags"\s*:\s*(\[[^\]]+\])\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = pageRe.exec(text)) !== null) {
    const filename = m[1];
    const title = m[2];
    let tags: string[];
    try {
      tags = JSON.parse(m[3]);
    } catch {
      tags = [];
    }

    const rest = text.slice(m.index + m[0].length);
    const contentKeyMatch = rest.match(/"content"\s*:\s*"/);
    if (!contentKeyMatch) continue;
    const contentStart = contentKeyMatch.index! + contentKeyMatch[0].length;
    let content = '';
    let esc = false;
    for (let i = contentStart; i < rest.length; i++) {
      const ch = rest[i];
      if (esc) {
        esc = false;
        if (ch === 'n') {
          content += '\n';
          continue;
        }
        if (ch === 'r') continue;
        if (ch === 't') {
          content += '\t';
          continue;
        }
        content += ch;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') {
        const after = rest.slice(i + 1).replace(/\s*\n?\s*/, '');
        if (after.startsWith('}') || after.startsWith(',') || after.startsWith(']')) break;
        content += '"';
        continue;
      }
      content += ch;
    }

    // extract optional created/source fields (appear after tags, before content)
    let created = '';
    let source = '';
    let summary = '';
    const beforeContent = rest.slice(0, contentKeyMatch.index!);
    const createdMatch = beforeContent.match(/"created"\s*:\s*"([^"]+)"/);
    if (createdMatch) created = createdMatch[1];
    const sourceMatch = beforeContent.match(/"source"\s*:\s*"([^"]+)"/);
    if (sourceMatch) source = sourceMatch[1];
    const summaryMatch = beforeContent.match(/"summary"\s*:\s*"([^"]+)"/);
    if (summaryMatch) summary = summaryMatch[1];

    pages.push({ filename, title, summary, tags, created, source, content });
  }

  if (pages.length > 0) {
    const claims = parseLooseClaims(extractJsonArray(text, 'claims'));
    const relationshipsValue = extractJsonArray(text, 'relationships');
    const relationships = relationshipsValue
      ? relationshipsValue.filter(
          (item): item is Relationship =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof (item as Record<string, unknown>).source === 'string' &&
            typeof (item as Record<string, unknown>).target === 'string' &&
            typeof (item as Record<string, unknown>).relation === 'string',
        )
      : [];
    return { pages, claims, relationships, summary: `成功提取 ${pages.length} 个页面` };
  }

  return null;
}

/**
 * 判断路径是否属于 Wiki 系统文件，系统文件不会参与普通 question 搜索结果。
 */
export function isSystemWikiPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const baseName = path.basename(normalized);
  return (
    normalized === '_index.md' ||
    normalized === '_schema.json' ||
    normalized === '_manifest.json' ||
    baseName.startsWith('_')
  );
}

/**
 * 从页面正文提取确定性摘要，作为 AI 摘要缺失时的展示兜底。
 *
 * @param content 页面 Markdown 正文
 * @returns 首个有效段落，找不到时返回空字符串
 */
export function getWikiPageSummary(content: string): string {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !/^#{1,6}\s+/.test(paragraph) && !/^```/.test(paragraph))
    .map((paragraph) => paragraph.replace(/^\s*[-*+]\s+/, '').trim())
    .filter(Boolean);
  return paragraphs[0] || '';
}

/**
 * 从 Markdown 中解析 YAML frontmatter。解析失败或不存在时返回 null。
 */
export function parseWikiFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const result: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (!key || rest.length === 0) continue;

    let value = rest.join(':').trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1);
      result[key.trim()] = value
        .split(',')
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      result[key.trim()] = value.replace(/^['"]|['"]$/g, '');
    }
  }

  return result;
}

/**
 * 去掉 Markdown frontmatter，仅保留正文内容。
 */
export function stripWikiFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

/**
 * 提取 Markdown 正文中的所有 heading 文本，供搜索与 lint 共享。
 */
export function extractWikiHeadings(content: string): string[] {
  const body = stripWikiFrontmatter(content);
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
    .filter(Boolean);
}

/**
 * 将 Wiki Markdown 页面统一解析为结构化对象，兼容缺失 frontmatter 的旧页面。
 */
export function parseWikiPage(relativePath: string, content: string): ParsedWikiPage {
  const frontmatter = parseWikiFrontmatter(content) || {};
  const title =
    typeof frontmatter.title === 'string' && frontmatter.title
      ? frontmatter.title
      : path.basename(relativePath, path.extname(relativePath));
  const tags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  const created = typeof frontmatter.created === 'string' ? frontmatter.created : '';
  const source = typeof frontmatter.source === 'string' ? frontmatter.source : '';
  const body = stripWikiFrontmatter(content);

  return {
    file: relativePath.replace(/\\/g, '/'),
    title,
    tags,
    created,
    source,
    headings: extractWikiHeadings(content),
    body,
  };
}

function getManifestPath(wikiPath: string): string {
  return path.join(wikiPath, '_manifest.json');
}

/**
 * 读取 `_manifest.json`，缺失或损坏时返回空 manifest 结构。
 */
export function readWikiManifest(wikiPath: string): WikiManifest {
  const manifestPath = getManifestPath(wikiPath);
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Partial<WikiManifest>;
    return {
      version: parsed.version || 1,
      entries: Array.isArray(parsed.entries) ? (parsed.entries as WikiManifestEntry[]) : [],
    };
  } catch {
    return { version: 1, entries: [] };
  }
}

/**
 * 覆盖写入 Wiki manifest。
 */
export function writeWikiManifest(wikiPath: string, manifest: WikiManifest): void {
  writeFileAtomically(getManifestPath(wikiPath), JSON.stringify(manifest, null, 2));
}

/**
 * 追加一条 manifest 记录，供共享编译服务统一调用。
 */
export function appendWikiManifestEntry(wikiPath: string, entry: WikiManifestEntry): void {
  const manifest = readWikiManifest(wikiPath);
  const existing = manifest.entries.find((item) => item.id === entry.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(entry)) {
      throw new Error(`Wiki manifest id 已存在但内容不匹配: ${entry.id}`);
    }
    return;
  }
  manifest.entries.push(entry);
  writeWikiManifest(wikiPath, manifest);
}

// ── Write pages ──

/**
 * 将页面正文中指向未 sanitized 路径的 Markdown 链接替换为 sanitized 后的路径。
 * 解决 AI 生成带空格的链接（如 [xxx](pages/分类/页面 名.md)）无法映射到实际文件的问题。
 */
function sanitizeContentLinks(content: string, pathMap: Map<string, string>): string {
  return content.replace(/\]\(([^)]+)\)/g, (full, href: string) => {
    const protocolTarget = parseMintWikiLink(href);
    if (protocolTarget) {
      const mappedProtocolPath = pathMap.get(protocolTarget.path);
      if (!mappedProtocolPath) return full;
      const mappedProtocol = createMintWikiLink(mappedProtocolPath, protocolTarget.fragment);
      return mappedProtocol ? `](${mappedProtocol})` : full;
    }

    let decoded = href;
    try {
      decoded = decodeURIComponent(href);
    } catch {
      // 保留无法解码的原始链接，避免破坏正文。
    }
    const mapped = pathMap.get(href) || pathMap.get(decoded);
    return mapped ? `](${mapped})` : full;
  });
}

/**
 * Write compiled pages to disk, assembling YAML frontmatter from separate fields + markdown body.
 */
export function prepareWikiPages(wikiPath: string, pages: CompiledPage[]): CompiledPage[] {
  // 第一遍：计算所有页面的 sanitized 路径，建立映射表
  const pathMap = new Map<string, string>();
  for (const page of pages) {
    const pagePath = page.filename.startsWith('pages/') ? page.filename : `pages/${page.filename}`;
    if (!isPathSafe(wikiPath, pagePath)) {
      throw new Error(`路径穿越被拒绝: ${pagePath}`);
    }
    const sanitized = sanitizeWikiFilenamePath(pagePath);
    pathMap.set(pagePath, sanitized);
    // 也注册去掉 .md 后的形式（AI 可能只引用目录+文件名，不带扩展名）
    if (pagePath.endsWith('.md')) {
      pathMap.set(pagePath.replace(/\.md$/, ''), sanitized.replace(/\.md$/, ''));
    }
  }

  // 第二遍：修正交叉链接并返回固定编译快照，不产生文件副作用。
  return pages.map((page) => {
    const pagePath = page.filename.startsWith('pages/') ? page.filename : `pages/${page.filename}`;
    const sanitizedPath = pathMap.get(pagePath) || sanitizeWikiFilenamePath(pagePath);
    const pathSegments = sanitizedPath.split('/');
    if (pathSegments.length < 3) {
      throw new Error(`页面缺少分类目录: ${sanitizedPath}，格式必须为 pages/分类/文件名.md`);
    }
    return {
      ...page,
      filename: sanitizedPath,
      tags: [...(page.tags || [])],
      content: sanitizeContentLinks(page.content, pathMap),
    };
  });
}

/** Build stable page summaries without writing files. */
export function summarizeWikiPages(
  pages: CompiledPage[],
): { filename: string; title: string; size: number; summary: string }[] {
  return pages.map((page) => {
    const content = renderWikiPage(page);
    return {
      filename: page.filename,
      title: page.title,
      size: Buffer.byteLength(content, 'utf-8'),
      summary: page.summary?.trim() || getWikiPageSummary(page.content) || '暂无摘要',
    };
  });
}

/** Persist pages that have already passed path normalization. */
export function writePreparedWikiPages(
  wikiPath: string,
  pages: CompiledPage[],
): { filename: string; title: string; size: number; summary: string }[] {
  for (const page of pages) {
    const resolvedPath = path.resolve(wikiPath, page.filename);
    if (!isPathSafe(wikiPath, page.filename)) throw new Error(`路径穿越被拒绝: ${page.filename}`);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    writeFileAtomically(resolvedPath, renderWikiPage(page));
  }
  return summarizeWikiPages(pages);
}

/** Normalize and atomically persist compiled pages. */
export function writeWikiPages(
  wikiPath: string,
  pages: CompiledPage[],
): { filename: string; title: string; size: number; summary: string }[] {
  return writePreparedWikiPages(wikiPath, prepareWikiPages(wikiPath, pages));
}

function renderWikiPage(page: CompiledPage): string {
  const frontmatterParts = [`title: ${page.title}`];
  if (page.tags && page.tags.length > 0) frontmatterParts.push(`tags: [${page.tags.join(', ')}]`);
  if (page.created) frontmatterParts.push(`created: ${page.created}`);
  if (page.source) frontmatterParts.push(`source: ${page.source}`);
  return ['---', ...frontmatterParts, '---', '', page.content].join('\n');
}

function writeFileAtomically(filePath: string, content: string): void {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, 'utf-8');
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

// ── Update _index.md ──

/** Parse YAML frontmatter title from markdown content. */
function parseFrontmatterTitle(md: string): string | null {
  const m = md.match(/^---\s*\ntitle:\s*(.+)\n/);
  return m ? m[1].trim() : null;
}

/** Scan pages/ directory recursively and group by top-level category. */
function scanPagesByCategory(
  wikiPath: string,
): Record<string, { filename: string; title: string }[]> {
  const pagesDir = path.join(wikiPath, 'pages');
  const grouped: Record<string, { filename: string; title: string }[]> = {};
  if (!fs.existsSync(pagesDir)) return grouped;

  const walk = (currentDir: string): void => {
    for (const entry of fs.readdirSync(currentDir).sort()) {
      const fullPath = path.join(currentDir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === '.gitkeep' || entry.startsWith('.')) continue;
        walk(fullPath);
        continue;
      }
      if (!entry.endsWith('.md') || entry === '.gitkeep') continue;
      try {
        const relativePath = path.relative(wikiPath, fullPath).replace(/\\/g, '/');
        const segments = relativePath.split('/');
        const category = segments.length >= 2 ? segments[1] : 'uncategorized';
        const fileContent = fs.readFileSync(fullPath, 'utf-8');
        const title = parseFrontmatterTitle(fileContent) || entry.replace(/\.md$/, '');
        if (!grouped[category]) grouped[category] = [];
        grouped[category].push({ filename: relativePath, title });
      } catch {
        /* skip unreadable files */
      }
    }
  };

  walk(pagesDir);
  return grouped;
}

/** Regenerate _index.md with category index + recent updates. */
export function updateIndexMd(
  wikiPath: string,
  newPages: { filename: string; title: string }[],
): void {
  const indexPath = path.join(wikiPath, '_index.md');

  // Scan current pages from disk
  const grouped = scanPagesByCategory(wikiPath);

  // Also merge newly added pages (in case they haven't been written yet)
  for (const p of newPages) {
    const segs = p.filename.replace(/^pages\//, '').split('/');
    const cat = segs.length >= 2 ? segs[0] : 'uncategorized';
    if (!grouped[cat]) grouped[cat] = [];
    if (!grouped[cat].find((e) => e.filename === p.filename)) {
      grouped[cat].push(p);
    }
  }

  // Build _index.md
  const lines: string[] = ['# Wiki 首页', '', '这是 LLM Wiki 知识库的首页。', ''];

  // Category index section
  const sortedCats = Object.keys(grouped).sort();
  if (sortedCats.length > 0) {
    lines.push('## 分类索引');
    lines.push('');
    for (const cat of sortedCats) {
      lines.push(`### ${cat}`);
      for (const page of grouped[cat]) {
        lines.push(`- [${page.title}](${page.filename})`);
      }
      lines.push('');
    }
  }

  // Recent updates
  const allPages = Object.values(grouped).flat();
  if (allPages.length > 0) {
    lines.push('## 最近更新');
    lines.push('');
    const recent = allPages.slice(-20).reverse();
    for (const page of recent) {
      lines.push(`- [${page.title}](${page.filename})`);
    }
    lines.push('');
  } else {
    lines.push('## 最近更新');
    lines.push('');
  }

  writeFileAtomically(indexPath, lines.join('\n'));
}

// ── Discover categories from pages/ ──

/** Auto-discover categories from existing pages/ subdirectories and merge into schema. */
export function discoverCategoriesFromDir(wikiPath: string, schema: Record<string, unknown>): void {
  const pagesDir = path.join(wikiPath, 'pages');
  const discovered: string[] = [];
  if (fs.existsSync(pagesDir)) {
    for (const entry of fs.readdirSync(pagesDir)) {
      const fullPath = path.join(pagesDir, entry);
      if (entry !== '.gitkeep' && !entry.startsWith('.') && fs.statSync(fullPath).isDirectory()) {
        discovered.push(entry);
      }
    }
  }
  if (discovered.length > 0) {
    const existing = normalizeWikiCategories(schema.categories);
    const existingNames = new Set(existing.map((category) => category.name));
    schema.categories = [
      ...existing,
      ...discovered
        .filter((category) => !existingNames.has(category))
        .map((name) => ({ name, description: '', include: [], exclude: [] })),
    ];
  }
}
