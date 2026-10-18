import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';
import {
  normalizeWikiCategories,
  parseWikiFrontmatter,
  stripWikiFrontmatter,
} from '../../infrastructure/filesystem/wiki-content.js';
import {
  createMintWikiLink,
  resolveWikiMarkdownLink,
} from '../../infrastructure/filesystem/wiki-link-protocol.js';
import { getAdapter } from '../../infrastructure/ai/adapters/api-adapter.js';
import { isWikiRelativePathSafe } from './wiki-path-safety.js';
import type {
  CompiledPage,
  Relationship,
  WikiCategory,
} from '../../infrastructure/filesystem/wiki-content.js';
import {
  INGEST_SYSTEM_PROMPT as SHARED_PROMPT,
  getWikiPageSummary,
  tryParseLooseJson,
  prepareWikiPages,
  summarizeWikiPages,
  writePreparedWikiPages,
  updateIndexMd,
  discoverCategoriesFromDir,
} from '../../infrastructure/filesystem/wiki-content.js';
import type { AiSettings } from '../../types.js';
import type { JevSettings } from '../../types.js';
import { resolveWikiPageIdentity } from './identity/wiki-identity-resolver.js';
import type {
  WikiIdentityCandidate,
  WikiIdentityDecision,
  WikiIdentityInput,
  WikiIdentityProviderCall,
} from './identity/types.js';

export interface CompileResult {
  pages: { filename: string; title: string; size: number; summary: string }[];
  compiledPages: CompiledPage[]; // 完整页面数据（含 tags/content），供图构建使用
  relationships: Relationship[]; // AI 输出的页面间语义关系
  claims: WikiCompiledClaim[]; // AI 输出的可追溯事实，旧模型缺失时由摄入层生成 fallback
  summary: string;
}

interface ParsedCompileOutput {
  pages: CompiledPage[];
  claims?: WikiCompiledClaim[];
  relationships?: Relationship[];
  summary: string;
}

/** 面向任务中心展示的 Wiki 编译阶段。 */
export type WikiCompileProgressStage = 'prepare' | 'evidence' | 'pages';

export interface CompileSourceOptions {
  title?: string;
  category?: string;
  jevSettings?: JevSettings;
  jevIdentityProvider?: WikiIdentityProviderCall;
  /** Return a durable compilation snapshot without writing pages or the index. */
  persistPages?: boolean;
  /** 编译进入真实阶段时通知异步摄入任务。 */
  onProgress?: (stage: WikiCompileProgressStage) => void;
}

export interface WikiCompiledClaim {
  pageTitle: string;
  text: string;
  normalizedKey?: string;
  confidence?: number;
  importance?: number;
  evidence?: string;
  evidenceQuote?: string;
}

/** Prepared merge data; no files or lifecycle records have been written yet. */
export interface WikiPageMergePlan {
  sourcePath: string;
  sourceMarkdown: string;
  sourcePage: CompiledPage;
  candidates: WikiIdentityCandidate[];
  decision: WikiIdentityDecision;
  mergedTargetPage?: CompiledPage;
}

/** 将原文与证据片段规范化，允许换行和空格差异但不放宽文字内容。 */
function normalizeEvidenceText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[\s*_`]/g, '');
}

/** 从模型拼接的证据中恢复一条仍与原文连续匹配的完整句子。 */
function findMatchingEvidence(sourceText: string, evidence: string): string | undefined {
  const normalizedSource = normalizeEvidenceText(sourceText);
  const normalizedEvidence = normalizeEvidenceText(evidence);
  if (normalizedSource.includes(normalizedEvidence)) return evidence;

  const candidates = evidence
    .split(/[。！？!?；;：:\n…]+/)
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length >= 8)
    .sort((left, right) => right.length - left.length);
  return candidates.find((candidate) =>
    normalizedSource.includes(normalizeEvidenceText(candidate)),
  );
}

/** 为超长文档选择页面正文中能回指原文的片段。 */
function fallbackEvidenceForPage(sourceText: string, page: CompiledPage, index: number): string {
  const contentCandidates = page.content
    .split(/\n+/)
    .map((line) => line.replace(/^#{1,6}\s+|^[-*+]\s+/, '').trim())
    .filter((line) => line.length >= 12);
  for (const candidate of contentCandidates) {
    const matching = findMatchingEvidence(sourceText, candidate);
    if (matching) return matching;
  }

  const sourceCandidates = sourceText
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 12 && !/^置⾝钉内.*\d+\s*\/\s*\d+$/.test(line));
  return sourceCandidates[index % Math.max(1, sourceCandidates.length)] || sourceText.slice(0, 80);
}

/** 长文模型无法可靠产出 claims 时，生成仅由原文片段组成的低置信度兜底。 */
function buildFallbackClaims(sourceText: string, pages: CompiledPage[]): WikiCompiledClaim[] {
  return pages.map((page, index) => {
    const evidence = fallbackEvidenceForPage(sourceText, page, index);
    return {
      pageTitle: page.title,
      text: evidence,
      normalizedKey: `fallback:${page.title}`,
      confidence: 0.2,
      importance: 0.2,
      evidence,
      evidenceQuote: evidence,
    };
  });
}

/** 在 Wiki 写入前验证 AI Claim 是否能被当前原始资料直接支持。 */
function validateCompiledClaims(
  sourceText: string,
  pages: CompiledPage[],
  claims: WikiCompiledClaim[],
): void {
  const failures: string[] = [];
  const pageTitles = new Set(pages.map((page) => page.title));
  const claimsByPage = new Map<string, number>();

  for (const claim of claims) {
    const pageTitle = typeof claim.pageTitle === 'string' ? claim.pageTitle.trim() : '';
    const claimText = typeof claim.text === 'string' ? claim.text.trim() : '';
    const evidence =
      typeof claim.evidenceQuote === 'string' && claim.evidenceQuote.trim()
        ? claim.evidenceQuote
        : claim.evidence;

    if (!pageTitles.has(pageTitle)) {
      failures.push(`Claim 指向不存在的页面：${pageTitle || '（空标题）'}`);
      continue;
    }
    claimsByPage.set(pageTitle, (claimsByPage.get(pageTitle) || 0) + 1);
    if (!claimText) {
      failures.push(`页面「${pageTitle}」存在空 Claim`);
      continue;
    }
    if (typeof evidence !== 'string' || !evidence.trim()) {
      failures.push(`页面「${pageTitle}」的 Claim 缺少原文证据`);
      continue;
    }
    const matchingEvidence = findMatchingEvidence(sourceText, evidence);
    if (!matchingEvidence) {
      failures.push(`页面「${pageTitle}」的证据不在原始资料中：${evidence.trim().slice(0, 120)}`);
    } else if (matchingEvidence !== evidence) {
      claim.evidence = matchingEvidence;
      claim.evidenceQuote = matchingEvidence;
    }
  }

  if (claims.length === 0) failures.push('AI 未返回可验证的 Wiki Claim');
  for (const page of pages) {
    if (!claimsByPage.has(page.title)) failures.push(`页面「${page.title}」没有关联 Claim`);
  }
  if (failures.length > 0) {
    throw new Error(`Wiki 证据校验失败：${failures.join('；')}`);
  }
}

/**
 * 从资料开头提取可独立检索的事实，避免编译摘要遗漏文章首先声明的核心对象或定义。
 */
function extractLeadFacts(sourceText: string): string[] {
  return sourceText
    .split(/\r?\n+/)
    .map((line) => line.replace(/^[#>*\-\s]+/, '').trim())
    .filter((line) => line.length >= 12 && line.length <= 280)
    .filter((line) => !/^={3,}|^第\s*\d+\s*页/.test(line))
    .filter((line) => /(?:是|为|有|属于|来自|达到|超过|包含|可以|会|被)/.test(line))
    .slice(0, 3);
}

/** 计算事实与页面的字符二元组重叠，用于把补充证据放回最相关的主题页。 */
function leadFactRelevance(fact: string, page: CompiledPage): number {
  const haystack = normalizeEvidenceText(`${page.title}\n${page.tags.join(' ')}\n${page.content}`);
  const normalizedFact = normalizeEvidenceText(fact);
  let score = 0;
  for (let index = 0; index < normalizedFact.length - 1; index += 1) {
    if (haystack.includes(normalizedFact.slice(index, index + 2))) score += 1;
  }
  return score;
}

/**
 * 将编译结果未覆盖的开篇事实原文追加到最相关页面，保证 Sources 中的关键定义可被 Wiki 搜索。
 */
function preserveLeadFacts(sourceText: string, pages: CompiledPage[]): void {
  const facts = extractLeadFacts(sourceText).filter(
    (fact) =>
      !pages.some((page) =>
        normalizeEvidenceText(page.content).includes(normalizeEvidenceText(fact)),
      ),
  );
  if (facts.length === 0 || pages.length === 0) return;

  for (const fact of facts) {
    const target = [...pages].sort(
      (left, right) => leadFactRelevance(fact, right) - leadFactRelevance(fact, left),
    )[0];
    target.content = `${target.content.trim()}\n\n## 原始资料关键事实\n\n${fact}`;
  }
}

/**
 * 扫描 pages/ 目录，返回已有页面的身份候选字段。
 * 供候选召回与编译提示索引共用。
 */
type ExistingWikiPage = WikiIdentityCandidate;

/** Read a frontmatter array while dropping blank and non-string presentation noise. */
function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function scanExistingPages(wikiPath: string): ExistingWikiPage[] {
  const pagesDir = path.join(wikiPath, 'pages');
  if (!fs.existsSync(pagesDir)) return [];

  const entries: ExistingWikiPage[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir).sort()) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === '.gitkeep' || entry.startsWith('.')) continue;
        walk(fullPath);
        continue;
      }
      if (!entry.endsWith('.md')) continue;
      const fileContent = fs.readFileSync(fullPath, 'utf-8');
      const fm = parseWikiFrontmatter(fileContent);
      const relativePath = path.relative(wikiPath, fullPath).replace(/\\/g, '/');
      const segments = relativePath.split('/');
      const category = segments.length >= 3 ? segments[1] : 'uncategorized';
      const title = fm?.title ? String(fm.title) : entry.replace(/\.md$/, '');
      const tags = readStringArray(fm?.tags);
      const aliases = readStringArray(fm?.aliases);
      const summary =
        typeof fm?.summary === 'string'
          ? fm.summary
          : getWikiPageSummary(stripWikiFrontmatter(fileContent));
      entries.push({ title, filename: relativePath, category, tags, aliases, summary });
    }
  };
  walk(pagesDir);
  return entries;
}

/**
 * 构建已有知识索引的格式化文本，注入 AI prompt 做概念去重参考。
 */
function buildExistingKnowledgeIndex(wikiPath: string): string {
  const entries = scanExistingPages(wikiPath);
  if (entries.length === 0) return '（暂无已有知识库）';

  const lines = entries.map(
    (e) =>
      '  - 页面: ' +
      e.title +
      ' (分类: ' +
      e.category +
      (e.aliases.length ? ', 别名: ' + e.aliases.join(', ') : '') +
      (e.tags.length ? ', 标签: ' + e.tags.join(', ') : '') +
      ')',
  );
  return '已有 ' + entries.length + ' 个知识页面：\n' + lines.join('\n');
}

/**
 * 计算两个字符串的字符级 Dice 系数（bigram 重叠度）。
 * 返回值 0~1，越高越相似。适用于中英文混合标题。
 */
function titleSimilarity(a: string, b: string): number {
  const bigrams = (s: string): Set<string> => {
    const result = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      result.add(s.substring(i, i + 2));
    }
    return result;
  };

  const setA = bigrams(a.replace(/\s+/g, ''));
  const setB = bigrams(b.replace(/\s+/g, ''));

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  return (2 * intersection) / (setA.size + setB.size);
}

/** Normalize titles and aliases for safe exact identity comparisons. */
function normalizeIdentityName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, '');
}

/** Find exact title or explicit alias matches before model-based classification. */
function exactIdentityCandidates(
  page: CompiledPage,
  existingPages: ExistingWikiPage[],
): ExistingWikiPage[] {
  const incomingNames = [page.title, ...(page.aliases || [])].map(normalizeIdentityName);
  return existingPages.filter(
    (candidate) =>
      incomingNames.includes(normalizeIdentityName(candidate.title)) ||
      candidate.aliases.some((alias) => incomingNames.includes(normalizeIdentityName(alias))),
  );
}

/** Score title similarity against a page's title and aliases for candidate recall. */
const WIKI_IDENTITY_CANDIDATE_TOP_K = 5;
const WIKI_IDENTITY_CANDIDATE_SIMILARITY_FLOOR = 0.75;

/** Score one incoming title or alias against an existing page's names. */
function candidateSimilarity(incomingName: string, candidate: ExistingWikiPage): number {
  const normalizedIncomingName = normalizeIdentityName(incomingName);
  const candidateNames = [candidate.title, ...candidate.aliases].map(normalizeIdentityName);
  return Math.max(
    ...candidateNames.map((existing) => titleSimilarity(normalizedIncomingName, existing)),
    0,
  );
}

/** Recall a bounded, independent Top-K for each distinct incoming name. */
function recallIdentityCandidates(
  page: CompiledPage,
  existingPages: ExistingWikiPage[],
): ExistingWikiPage[] {
  const queryByNormalizedName = new Map<string, string>();
  for (const name of [page.title, ...(page.aliases || [])]) {
    const normalizedName = normalizeIdentityName(name);
    if (normalizedName && !queryByNormalizedName.has(normalizedName)) {
      queryByNormalizedName.set(normalizedName, name);
    }
  }

  const candidatesByPath = new Map<string, { candidate: ExistingWikiPage; similarity: number }>();
  for (const query of queryByNormalizedName.values()) {
    const topCandidates = existingPages
      .map((candidate) => ({
        candidate,
        similarity: candidateSimilarity(query, candidate),
      }))
      .filter((item) => item.similarity >= WIKI_IDENTITY_CANDIDATE_SIMILARITY_FLOOR)
      .sort(
        (left, right) =>
          right.similarity - left.similarity ||
          left.candidate.filename.localeCompare(right.candidate.filename),
      )
      .slice(0, WIKI_IDENTITY_CANDIDATE_TOP_K);

    for (const item of topCandidates) {
      const existing = candidatesByPath.get(item.candidate.filename);
      if (!existing || item.similarity > existing.similarity) {
        candidatesByPath.set(item.candidate.filename, item);
      }
    }
  }

  return [...candidatesByPath.values()]
    .sort(
      (left, right) =>
        right.similarity - left.similarity ||
        left.candidate.filename.localeCompare(right.candidate.filename),
    )
    .map((item) => item.candidate);
}

/** Build the bounded state used for one incoming compiled page. */
function buildIdentityInput(page: CompiledPage): WikiIdentityInput {
  return {
    title: page.title,
    category: page.filename.split('/')[1] || '未分类',
    aliases: page.aliases || [],
    tags: page.tags,
    summary: page.summary || getWikiPageSummary(page.content),
    content: page.content.slice(0, 1800),
  };
}

/** Remap Markdown links that resolve to a retired source page. */
export function remapWikiPageLinks(
  content: string,
  pagePath: string,
  sourcePath: string,
  targetPath: string,
): string {
  return content.replace(/\]\(([^)]+)\)/g, (match, href: string) => {
    const target = resolveWikiMarkdownLink(pagePath, href);
    if (target?.path !== sourcePath) return match;
    const canonicalLink = createMintWikiLink(targetPath, target.fragment);
    return canonicalLink ? `](${canonicalLink})` : match;
  });
}

/** Resolve one page against its own exact or similarity-recalled candidates. */
async function resolvePageIdentity(
  settings: AiSettings,
  page: CompiledPage,
  existingPages: ExistingWikiPage[],
  jevSettings: JevSettings | undefined,
  jevIdentityProvider?: WikiIdentityProviderCall,
): Promise<{
  candidates: ExistingWikiPage[];
  stage: 'exact' | 'similarity';
  decision: WikiIdentityDecision;
}> {
  const exactMatches = exactIdentityCandidates(page, existingPages);
  if (exactMatches.length === 1) {
    return {
      candidates: exactMatches,
      stage: 'exact',
      decision: {
        kind: 'match',
        targetPath: exactMatches[0].filename,
        provider: 'deterministic',
      },
    };
  }
  if (exactMatches.length > 8) {
    return {
      candidates: exactMatches,
      stage: 'exact',
      decision: {
        kind: 'uncertain',
        provider: 'deterministic',
        reason: 'too_many_exact_alias_targets',
      },
    };
  }

  const candidates = exactMatches.length
    ? exactMatches
    : recallIdentityCandidates(page, existingPages);
  if (candidates.length === 0) {
    return {
      candidates,
      stage: 'similarity',
      decision: { kind: 'different', provider: 'deterministic' },
    };
  }
  const decision = await resolveWikiPageIdentity(
    buildIdentityInput(page),
    candidates,
    { jevEnabled: jevSettings?.wikiIdentityEnabled === true, jevSettings, aiSettings: settings },
    { jev: jevIdentityProvider },
  );
  return { candidates, stage: exactMatches.length ? 'exact' : 'similarity', decision };
}

/** Replace incoming page titles with canonical titles in extracted relationships. */
function remapRelationships(
  relationships: Relationship[],
  canonicalTitleByIncomingTitle: Map<string, string>,
): Relationship[] {
  return relationships.map((relationship) => ({
    ...relationship,
    source: canonicalTitleByIncomingTitle.get(relationship.source) || relationship.source,
    target: canonicalTitleByIncomingTitle.get(relationship.target) || relationship.target,
  }));
}

/** Combine pages that resolve to the same canonical path into one pending write. */
function coalescePagesByPath(pages: CompiledPage[]): CompiledPage[] {
  const grouped = new Map<string, CompiledPage[]>();
  for (const page of pages) {
    const group = grouped.get(page.filename) || [];
    group.push(page);
    grouped.set(page.filename, group);
  }
  return [...grouped.values()].map((group) => {
    if (group.length === 1) return group[0];
    const first = group[0];
    return {
      ...first,
      tags: mergeLists(
        [],
        group.flatMap((page) => page.tags),
      ),
      summary: mergeLists([], group.map((page) => page.summary || '').filter(Boolean)).join(' '),
      content: group
        .map((page, index) => `### 补充内容 ${index + 1}\n\n${page.content.trim()}`)
        .join('\n\n'),
    };
  });
}

/** Assign a stable new path when a non-match would otherwise overwrite an existing page. */
function keepPageAtUniquePath(page: CompiledPage, reservedPaths: Set<string>): CompiledPage {
  if (!reservedPaths.has(page.filename)) {
    reservedPaths.add(page.filename);
    return page;
  }
  const directory = path.posix.dirname(page.filename);
  const extension = path.posix.extname(page.filename) || '.md';
  const basename = path.posix.basename(page.filename, extension);
  const suffix = createHash('sha256').update(page.title).digest('hex').slice(0, 8);
  let candidate = path.posix.join(directory, `${basename}-${suffix}${extension}`);
  let collisionIndex = 2;
  while (reservedPaths.has(candidate)) {
    candidate = path.posix.join(directory, `${basename}-${suffix}-${collisionIndex}${extension}`);
    collisionIndex += 1;
  }
  reservedPaths.add(candidate);
  return { ...page, filename: candidate };
}

/** Log candidate structure without exposing page summaries or body content. */
function logIdentityCandidates(
  page: CompiledPage,
  stage: 'exact' | 'similarity',
  candidates: ExistingWikiPage[],
): void {
  console.info('[wikiCompiler] identity-candidates', {
    stage,
    incomingTitle: page.title,
    candidateCount: candidates.length,
    candidates: candidates.map((candidate) => ({
      title: candidate.title,
      filename: candidate.filename,
      category: candidate.category,
      aliases: candidate.aliases,
      tags: candidate.tags,
    })),
  });
}

/** Resolve title-similar pages to canonical paths without dropping new content. */
async function resolvePageIdentities(
  settings: AiSettings,
  newPages: CompiledPage[],
  existingPages: ExistingWikiPage[],
  jevSettings: JevSettings | undefined,
  jevIdentityProvider?: WikiIdentityProviderCall,
): Promise<{ pages: CompiledPage[]; canonicalTitleByIncomingTitle: Map<string, string> }> {
  const pages: CompiledPage[] = [];
  const canonicalTitleByIncomingTitle = new Map<string, string>();
  const reservedPaths = new Set(existingPages.map((page) => page.filename));

  for (const page of newPages) {
    console.info('[wikiCompiler] identity-candidate-search:start', {
      incomingTitle: page.title,
      existingPageCount: existingPages.length,
    });
    const resolution = await resolvePageIdentity(
      settings,
      page,
      existingPages,
      jevSettings,
      jevIdentityProvider,
    );
    const { candidates, decision } = resolution;
    logIdentityCandidates(page, resolution.stage, candidates);
    if (candidates.length > 8) {
      console.warn('[wikiCompiler] identity-resolution skipped: too many exact alias targets', {
        candidateCount: candidates.length,
      });
      pages.push(keepPageAtUniquePath(page, reservedPaths));
      continue;
    }
    if (decision.kind !== 'match') {
      if (candidates.length > 0) {
        console.info('[wikiCompiler] identity-resolution', {
          provider: decision.provider,
          decision: decision.kind,
          fallbackReason: decision.fallbackReason,
        });
      }
      pages.push(keepPageAtUniquePath(page, reservedPaths));
      continue;
    }

    const target = candidates.find((candidate) => candidate.filename === decision.targetPath);
    if (!target) {
      pages.push(keepPageAtUniquePath(page, reservedPaths));
      continue;
    }
    canonicalTitleByIncomingTitle.set(page.title, target.title);
    pages.push({ ...page, filename: target.filename, title: target.title });
  }

  return {
    pages: coalescePagesByPath(pages),
    canonicalTitleByIncomingTitle,
  };
}

/** Prepare a same-identity merge from an existing source page without writing files. */
export async function prepareExistingWikiPageMerge(
  settings: AiSettings,
  wikiPath: string,
  sourcePath: string,
  jevSettings?: JevSettings,
  jevIdentityProvider?: WikiIdentityProviderCall,
): Promise<WikiPageMergePlan> {
  const normalizedSourcePath = sourcePath.replace(/\\/g, '/');
  if (
    !normalizedSourcePath.startsWith('pages/') ||
    !normalizedSourcePath.endsWith('.md') ||
    !isWikiRelativePathSafe(wikiPath, normalizedSourcePath)
  ) {
    throw new Error('源页路径必须是 Wiki 根目录内 pages/ 下的 Markdown 文件');
  }

  const absoluteSourcePath = path.resolve(wikiPath, normalizedSourcePath);
  if (!fs.existsSync(absoluteSourcePath) || !fs.statSync(absoluteSourcePath).isFile()) {
    throw new Error(`源 Wiki 页面不存在: ${normalizedSourcePath}`);
  }

  const sourceMarkdown = fs.readFileSync(absoluteSourcePath, 'utf-8');
  const frontmatter = parseWikiFrontmatter(sourceMarkdown);
  const content = stripWikiFrontmatter(sourceMarkdown);
  const sourcePage: CompiledPage = {
    filename: normalizedSourcePath,
    title:
      typeof frontmatter?.title === 'string'
        ? frontmatter.title
        : path.posix.basename(normalizedSourcePath, '.md'),
    summary:
      typeof frontmatter?.summary === 'string' ? frontmatter.summary : getWikiPageSummary(content),
    tags: readStringArray(frontmatter?.tags),
    aliases: readStringArray(frontmatter?.aliases),
    created: typeof frontmatter?.created === 'string' ? frontmatter.created : undefined,
    source: typeof frontmatter?.source === 'string' ? frontmatter.source : undefined,
    content,
  };
  const existingPages = scanExistingPages(wikiPath).filter(
    (candidate) => candidate.filename !== normalizedSourcePath,
  );

  console.info('[wikiCompiler] identity-candidate-search:start', {
    incomingTitle: sourcePage.title,
    sourcePath: normalizedSourcePath,
    existingPageCount: existingPages.length,
  });
  const resolution = await resolvePageIdentity(
    settings,
    sourcePage,
    existingPages,
    jevSettings,
    jevIdentityProvider,
  );
  logIdentityCandidates(sourcePage, resolution.stage, resolution.candidates);

  const originalDecision = resolution.decision;
  const target =
    originalDecision.kind === 'match'
      ? resolution.candidates.find(
          (candidate) => candidate.filename === originalDecision.targetPath,
        )
      : undefined;
  const decision: WikiIdentityDecision =
    originalDecision.kind === 'match' && !target
      ? {
          kind: 'uncertain',
          provider: originalDecision.provider,
          reason: 'target_not_in_candidate_set',
        }
      : originalDecision;
  if (!target || decision.kind !== 'match') {
    return {
      sourcePath: normalizedSourcePath,
      sourceMarkdown,
      sourcePage,
      candidates: resolution.candidates,
      decision,
    };
  }

  const incomingPage = {
    ...sourcePage,
    filename: target.filename,
    title: target.title,
    content: remapWikiPageLinks(
      sourcePage.content,
      normalizedSourcePath,
      normalizedSourcePath,
      target.filename,
    ),
  };
  const mergedTargetPage = await mergePageIfExists(incomingPage, wikiPath, settings);
  return {
    sourcePath: normalizedSourcePath,
    sourceMarkdown,
    sourcePage,
    candidates: resolution.candidates,
    decision,
    mergedTargetPage: {
      ...mergedTargetPage,
      content: remapWikiPageLinks(
        mergedTargetPage.content,
        target.filename,
        normalizedSourcePath,
        target.filename,
      ),
    },
  };
}

/**
 * 当多篇页面全部落入同一分类时，调用一次轻量 LLM 审计分类。
 * 只修改 pages/ 下的分类目录，不改页面标题和正文。
 */
async function auditPageCategories(
  settings: AiSettings,
  pages: CompiledPage[],
  categories: WikiCategory[],
): Promise<CompiledPage[]> {
  if (pages.length < 2 || categories.length < 2) return pages;

  const currentCategories = new Set(
    pages.map((page) => page.filename.split('/')[1]).filter(Boolean),
  );
  if (currentCategories.size > 1) return pages;

  const adapter = getAdapter(settings.apiType || 'openai-chat');
  if (!adapter) return pages;

  const pageSummaries = pages.map((page, index) => ({
    index,
    filename: page.filename,
    title: page.title,
    content: page.content.slice(0, 1600),
  }));
  const prompt = `请审计以下 Wiki 页面分类。可选分类定义：${JSON.stringify(categories, null, 2)}

当前所有页面被分到了同一个分类，请重新逐页判断。允许最终仍然全部属于同一分类，但不能依据原始文章的整体类型判断，必须依据页面自身的核心主题。
只输出 JSON 数组，不要输出解释：
[{"index":0,"category":"分类名"}]

页面：
${JSON.stringify(pageSummaries, null, 2)}`;

  try {
    const result = await adapter.call(
      [
        { role: 'system', content: '你是 Wiki 分类审计器，只返回合法 JSON。' },
        { role: 'user', content: prompt },
      ],
      { modelId: settings.modelId },
      settings.apiUrl,
      settings.apiKey,
      { maxTokens: 2048, temperature: 0.1 },
    );
    const start = result.indexOf('[');
    const end = result.lastIndexOf(']');
    if (start < 0 || end <= start) return pages;

    const assignments = JSON.parse(result.slice(start, end + 1)) as unknown;
    if (!Array.isArray(assignments)) return pages;

    const validCategories = new Set(categories.map((category) => category.name));
    const audited = pages.map((page, index) => {
      const assignment = assignments.find(
        (item) => item && typeof item === 'object' && (item as { index?: unknown }).index === index,
      ) as { category?: unknown } | undefined;
      const category = typeof assignment?.category === 'string' ? assignment.category : '';
      if (!validCategories.has(category)) return page;

      const parts = page.filename.split('/');
      if (parts.length < 3) return page;
      parts[1] = category;
      return { ...page, filename: parts.join('/') };
    });
    console.log(
      '[wikiCompiler] page category audit completed:',
      audited.map((page) => `${page.title} -> ${page.filename.split('/')[1]}`).join(', '),
    );
    return audited;
  } catch (err) {
    console.warn(
      '[wikiCompiler] page category audit failed, keeping original categories:',
      err instanceof Error ? err.message : String(err),
    );
    return pages;
  }
}

/**
 * 调用 AI API 将原始资料编译为 Wiki 页面
 */
async function callAiForCompilation(
  settings: AiSettings,
  sourceText: string,
  sourceFilename: string,
  schema: Record<string, unknown>,
  existingKnowledgeIndex: string,
  title?: string,
  category?: string,
): Promise<string> {
  const schemaInfo = JSON.stringify(schema, null, 2);
  const categories = normalizeWikiCategories(schema.categories);
  const categoryGuidance = `
分类定义（必须以 Schema 为准）：
${JSON.stringify(categories, null, 2)}
分类必须根据页面自身的核心内容判断，不能因为原始文章整体属于某一类型就把所有页面都归为同一分类。`;
  const prompt = SHARED_PROMPT.replace('{sourceFilename}', sourceFilename);
  const userMessage = `标题：${title || '（AI 自动生成）'}
分类：${category || '（AI 自动归类）'}
原始文件名：${sourceFilename}

已有知识索引：
${existingKnowledgeIndex}

当前可用分类：${JSON.stringify(categories)}
${categoryGuidance}
当前 Schema 规范：
\`\`\`json
${schemaInfo}
\`\`\`

原始资料：
${sourceText}`;

  console.log(`[wikiCompiler] calling AI: url=${settings.apiUrl}, model=${settings.modelId}`);

  const adapter = getAdapter(settings.apiType || 'openai-chat');
  if (!adapter) throw new Error('Adapter not found');

  // 长文需要输出多个完整页面。固定 4096 tokens 会迫使模型把整篇资料压成一页，
  // 甚至在 JSON 尚未完成时被截断；长文提高输出上限，但保持在常见兼容模型的上限内。
  const maxTokens = sourceText.length >= 8000 ? 8192 : 4096;
  const messages = [
    { role: 'system', content: prompt },
    { role: 'user', content: userMessage },
  ];

  let result: string;
  try {
    result = await adapter.call(
      messages,
      { modelId: settings.modelId },
      settings.apiUrl,
      settings.apiKey,
      { maxTokens, temperature: 0.3, thinking: false },
    );
  } catch (error) {
    if (maxTokens <= 4096) throw error;
    console.warn('[wikiCompiler] long-source request failed; retrying with maxTokens=4096');
    result = await adapter.call(
      messages,
      { modelId: settings.modelId },
      settings.apiUrl,
      settings.apiKey,
      { maxTokens: 4096, temperature: 0.3, thinking: false },
    );
  }

  // 部分 OpenAI 兼容网关在长上下文 + 大输出预算时会返回空 message；
  // 降低输出预算重试，避免把可恢复的供应商行为误报为格式错误。
  if (!result.trim() && maxTokens > 4096) {
    console.warn('[wikiCompiler] AI returned an empty response; retrying with maxTokens=4096');
    result = await adapter.call(
      messages,
      { modelId: settings.modelId },
      settings.apiUrl,
      settings.apiKey,
      { maxTokens: 4096, temperature: 0.3, thinking: false },
    );
  }

  console.log(`[wikiCompiler] AI response received, length=${result.length}`);

  return result;
}

/**
 * 当页面编译响应因长度限制省略 claims 时，单独提取页面级原文证据。
 */
async function callAiForClaims(
  settings: AiSettings,
  sourceText: string,
  pages: CompiledPage[],
): Promise<WikiCompiledClaim[]> {
  const pageTitles = pages.map((page) => page.title);
  const adapter = getAdapter(settings.apiType || 'openai-chat');
  if (!adapter) return [];
  const result = await adapter.call(
    [
      {
        role: 'system',
        content: '你是一个严格的证据抽取助手，只输出 JSON，不要输出 Markdown 或解释文字。',
      },
      {
        role: 'user',
        content: `请为下列每个 Wiki 页面生成至少一条可独立验证的 Claim。
要求：
1. pageTitle 必须逐字匹配给定页面标题；
2. text 是原始资料明确支持的事实或结论；
3. evidenceQuote 必须从原始资料逐字复制，不能改写；
4. 只输出以下格式，pages 必须为空数组：
{"pages":[],"claims":[{"pageTitle":"页面标题","text":"事实或结论","evidenceQuote":"原文证据"}],"relationships":[],"summary":""}

页面标题：
${JSON.stringify(pageTitles)}

原始资料：
${sourceText}`,
      },
    ],
    { modelId: settings.modelId },
    settings.apiUrl,
    settings.apiKey,
    { maxTokens: 4096, temperature: 0.1, thinking: false },
  );

  if (!result?.trim()) return [];
  const parsed = tryParseLooseJson(result);
  return parsed?.claims || [];
}

// ── Page Merge ───────────────────────────────────────────────────
// 当摄入新资料生成的页面与磁盘上已有页面路径相同时，不直接覆盖，
// 而是由 LLM 将新旧内容合并为一篇连贯的知识文章。

/** 前端数组字段：合并时取并集。 */
const UNION_FIELDS = ['tags', 'aliases'];

/** Body 安全阈值：LLM 合并后的正文长度不得低于原正文与新正文最大值 * 该比值。 */
const BODY_SHRINK_THRESHOLD = 0.7;

/** Union-merge 两个字符串数组，大小写不敏感去重，先出现的大小写为准。 */
function mergeLists(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...existing, ...incoming]) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Merge array metadata before deciding whether a Wiki page needs an LLM call. */
function mergeExistingPageMetadata(
  page: CompiledPage,
  existingParsed: Record<string, unknown> | null,
): CompiledPage {
  const mergedPage = { ...page };
  for (const field of UNION_FIELDS) {
    const existingValues: string[] = (existingParsed?.[field] as string[] | undefined) ?? [];
    const newValues = ((mergedPage as Record<string, unknown>)[field] as string[]) ?? [];
    if (existingValues.length > 0 || newValues.length > 0) {
      (mergedPage as Record<string, unknown>)[field] = mergeLists(existingValues, newValues);
    }
  }
  return mergedPage;
}

/** Lock fields that stay owned by the existing Wiki page after an update. */
function preserveExistingPageMetadata(
  mergedPage: CompiledPage,
  existingParsed: Record<string, unknown> | null,
): CompiledPage {
  if (existingParsed?.title) mergedPage.title = String(existingParsed.title);
  if (existingParsed?.created) mergedPage.created = String(existingParsed.created);
  return mergedPage;
}

function mergePageWithoutLlm(
  mergedPage: CompiledPage,
  existingParsed: Record<string, unknown> | null,
  existingBody: string,
  newBody: string,
): CompiledPage {
  const existing = existingBody.trim();
  const incoming = newBody.trim();
  mergedPage.content =
    !incoming || existing.includes(incoming)
      ? existing
      : `${existing}\n\n## 新资料补充\n\n${incoming}`;
  mergedPage.tags = mergeLists(
    (existingParsed?.tags as string[] | undefined) ?? [],
    mergedPage.tags,
  );
  mergedPage.aliases = mergeLists(
    (existingParsed?.aliases as string[] | undefined) ?? [],
    mergedPage.aliases ?? [],
  );
  return preserveExistingPageMetadata(mergedPage, existingParsed);
}

/** Validate and apply an LLM page merge; invalid output keeps both page bodies. */
function applyLlmPageMerge(
  page: CompiledPage,
  mergedPage: CompiledPage,
  existingParsed: Record<string, unknown> | null,
  existingBody: string,
  newBody: string,
  llmResult: string,
): CompiledPage {
  const llmParsed = parseWikiFrontmatter(llmResult);
  const llmBody = stripWikiFrontmatter(llmResult);
  if (!llmParsed?.title) {
    console.warn(
      '[wikiCompiler] page-merge: LLM output has no valid frontmatter for "' +
        page.title +
        '", append new content to preserve both versions',
    );
    return mergePageWithoutLlm(mergedPage, existingParsed, existingBody, newBody);
  }
  const maxBodyLen = Math.max(existingBody.length, newBody.length);
  const threshold = maxBodyLen * BODY_SHRINK_THRESHOLD;
  if (llmBody.length < threshold) {
    console.warn(
      '[wikiCompiler] page-merge: LLM body length ' +
        llmBody.length +
        ' below threshold ' +
        threshold.toFixed(0) +
        ' for "' +
        page.title +
        '", fallback',
    );
    return mergePageWithoutLlm(mergedPage, existingParsed, existingBody, newBody);
  }
  mergedPage.content = llmBody;
  preserveExistingPageMetadata(mergedPage, existingParsed);
  mergedPage.tags = mergeLists(
    (existingParsed?.tags as string[] | undefined) ?? [],
    Array.isArray(llmParsed.tags)
      ? llmParsed.tags.filter((tag): tag is string => typeof tag === 'string')
      : (page.tags ?? []),
  );
  mergedPage.aliases = mergeLists(
    (existingParsed?.aliases as string[] | undefined) ?? [],
    Array.isArray(llmParsed.aliases)
      ? llmParsed.aliases.filter((alias): alias is string => typeof alias === 'string')
      : (page.aliases ?? []),
  );
  console.log(
    `[wikiCompiler] page-merge: merged "${page.title}" via LLM (existing=${existingBody.length} new=${newBody.length} merged=${llmBody.length})`,
  );
  return mergedPage;
}

/** Ask the configured AI adapter to merge one existing page with new content. */
async function requestMergedPage(
  page: CompiledPage,
  mergedPage: CompiledPage,
  existingParsed: Record<string, unknown> | null,
  existingMd: string,
  existingBody: string,
  newBody: string,
  settings: AiSettings,
): Promise<CompiledPage> {
  const mergePrompt = `你是一名知识库管理员。磁盘上已存在一个同名页面，现在有新的摄入内容需要对它进行补充。

请将已有内容和新增内容合并为一篇连贯、无重复、信息完整的 Wiki 页面。
- 保留已有内容的全部实质性信息，不可丢失。
- 新内容中与已有内容重复的部分只保留一次。
- 新内容中不重复的部分补充到合适的位置。
- 输出完整的合并后 Markdown（含 frontmatter），保持已有页面的标题。

已有页面（frontmatter + 正文）：
"""
${existingMd}
"""

新增内容（正文）：
"""
${newBody}
"""

仅输出合并后的完整 Markdown 页面，不要加任何说明文字。`;
  try {
    const adapter = getAdapter(settings.apiType || 'openai-chat');
    if (!adapter) throw new Error('Adapter not found');
    const llmResult = await adapter.call(
      [
        {
          role: 'system',
          content: '你是一个严谨的知识库编辑专家，输出纯 Markdown 页面，含 frontmatter。',
        },
        { role: 'user', content: mergePrompt },
      ],
      { modelId: settings.modelId },
      settings.apiUrl,
      settings.apiKey,
      { maxTokens: 4096, temperature: 0.3 },
    );
    return applyLlmPageMerge(page, mergedPage, existingParsed, existingBody, newBody, llmResult);
  } catch (error) {
    console.warn(
      '[wikiCompiler] page-merge: LLM call failed for "' +
        page.title +
        '", append new content to preserve both versions: ' +
        (error instanceof Error ? error.message : String(error)),
    );
    return mergePageWithoutLlm(mergedPage, existingParsed, existingBody, newBody);
  }
}

/** Merge one compiled page with its existing Wiki file, if present. */
async function mergePageIfExists(
  page: CompiledPage,
  wikiPath: string,
  settings: AiSettings,
): Promise<CompiledPage> {
  const sanitizedPath = page.filename.startsWith('pages/')
    ? page.filename
    : `pages/${page.filename}`;
  const resolvedPath = path.resolve(wikiPath, sanitizedPath);
  if (!fs.existsSync(resolvedPath)) return page;
  const existingMd = fs.readFileSync(resolvedPath, 'utf-8');
  const existingParsed = parseWikiFrontmatter(existingMd);
  const mergedPage = mergeExistingPageMetadata(page, existingParsed);
  const existingBody = stripWikiFrontmatter(existingMd);
  const newBody = page.content || '';
  if (existingBody.trim() === newBody.trim()) {
    console.log(
      '[wikiCompiler] page-merge: body identical for "' + page.title + '", frontmatter union only',
    );
    return preserveExistingPageMetadata(mergedPage, existingParsed);
  }
  return requestMergedPage(
    page,
    mergedPage,
    existingParsed,
    existingMd,
    existingBody,
    newBody,
    settings,
  );
}

/** Read a Wiki schema, falling back to an empty definition if it is absent or invalid. */
function readWikiCompilerSchema(wikiPath: string): Record<string, unknown> {
  const schemaPath = path.join(wikiPath, '_schema.json');
  let schema: Record<string, unknown> = {};
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  } catch {
    // schema 不存在或无法解析时使用空对象
  }
  return schema;
}

/** Compile the AI response and enforce claim evidence before any page writes. */
async function compileAndValidateOutput(
  settings: AiSettings,
  sourceText: string,
  sourceFilename: string,
  schema: Record<string, unknown>,
  existingIndex: string,
  options?: CompileSourceOptions,
): Promise<ParsedCompileOutput> {
  const aiResult = await callAiForCompilation(
    settings,
    sourceText,
    sourceFilename,
    schema,
    existingIndex,
    options?.title,
    options?.category,
  );

  // AI 常在 content 字段中输出字面换行符，导致 JSON.parse 失败，先尝试宽松解析
  const parsed = tryParseLooseJson(aiResult);
  if (!parsed) {
    console.error(`[wikiCompiler] AI 返回非 JSON 格式 (len=${aiResult.length})`);
    throw new Error('AI 返回格式异常，完整返回已打印到日志');
  }
  const compiled: ParsedCompileOutput = parsed;

  if (!compiled.pages || compiled.pages.length === 0) {
    throw new Error('AI 未生成任何 Wiki 页面');
  }

  options?.onProgress?.('evidence');
  const initialClaims = compiled.claims || [];
  if (initialClaims.length === 0) {
    console.warn('[wikiCompiler] AI response omitted claims; extracting claims separately');
    compiled.claims = await callAiForClaims(settings, sourceText, compiled.pages);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      validateCompiledClaims(sourceText, compiled.pages, compiled.claims || []);
      break;
    } catch (error) {
      if (attempt === 1) {
        if (sourceText.length < 8000) throw error;
        console.warn(
          '[wikiCompiler] claims remained invalid; using deterministic long-source fallback',
        );
        compiled.claims = buildFallbackClaims(sourceText, compiled.pages);
        validateCompiledClaims(sourceText, compiled.pages, compiled.claims);
        break;
      }
      console.warn(
        initialClaims.length === 0
          ? '[wikiCompiler] extracted claims failed evidence validation; retrying extraction'
          : '[wikiCompiler] AI claims failed evidence validation; extracting claims separately',
      );
      compiled.claims = await callAiForClaims(settings, sourceText, compiled.pages);
    }
  }
  return compiled;
}

/** Apply page-level policy, merge existing pages, and persist the finalized output. */
async function finalizeCompiledPages(
  settings: AiSettings,
  wikiPath: string,
  sourceText: string,
  schema: Record<string, unknown>,
  compiled: ParsedCompileOutput,
  options?: CompileSourceOptions,
): Promise<{ pages: CompileResult['pages']; compiledPages: CompiledPage[] }> {
  const categories = normalizeWikiCategories(schema.categories);
  compiled.pages = await auditPageCategories(settings, compiled.pages, categories);
  preserveLeadFacts(sourceText, compiled.pages);

  // 概念去重校验：检查 AI 输出的页面标题是否与已有页面重复
  const existingPages = scanExistingPages(wikiPath);
  if (existingPages.length > 0 && compiled.pages.length > 0) {
    const resolution = await resolvePageIdentities(
      settings,
      compiled.pages,
      existingPages,
      options?.jevSettings,
      options?.jevIdentityProvider,
    );
    compiled.pages = resolution.pages;
    compiled.relationships = remapRelationships(
      compiled.relationships || [],
      resolution.canonicalTitleByIncomingTitle,
    );
    compiled.claims = (compiled.claims || []).map((claim) => ({
      ...claim,
      pageTitle: resolution.canonicalTitleByIncomingTitle.get(claim.pageTitle) || claim.pageTitle,
    }));
  }

  // 同一规范路径只合并写入一次，避免多个新页面互相覆盖目标文件。
  const mergedPages: CompiledPage[] = [];
  for (const page of coalescePagesByPath(compiled.pages)) {
    const merged = await mergePageIfExists(
      {
        ...page,
        summary: page.summary?.trim() || getWikiPageSummary(page.content) || undefined,
      },
      wikiPath,
      settings,
    );
    mergedPages.push(merged);
  }

  const preparedPages = prepareWikiPages(wikiPath, mergedPages);
  const results =
    options?.persistPages === false
      ? summarizeWikiPages(preparedPages)
      : writePreparedWikiPages(wikiPath, preparedPages);
  if (options?.persistPages !== false) updateIndexMd(wikiPath, preparedPages);
  compiled.pages = preparedPages;

  return { pages: results, compiledPages: compiled.pages };
}

/**
 * Compile source text into Wiki pages and return summaries and structured relations.
 */
export async function compileSource(
  settings: AiSettings,
  wikiPath: string,
  sourceText: string,
  sourceFilename: string,
  options?: CompileSourceOptions,
): Promise<CompileResult> {
  const schema = readWikiCompilerSchema(wikiPath);
  discoverCategoriesFromDir(wikiPath, schema);
  const existingIndex = buildExistingKnowledgeIndex(wikiPath);
  options?.onProgress?.('prepare');
  const compiled = await compileAndValidateOutput(
    settings,
    sourceText,
    sourceFilename,
    schema,
    existingIndex,
    options,
  );
  options?.onProgress?.('pages');
  const finalized = await finalizeCompiledPages(
    settings,
    wikiPath,
    sourceText,
    schema,
    compiled,
    options,
  );
  return {
    pages: finalized.pages,
    compiledPages: finalized.compiledPages,
    relationships: compiled.relationships || [],
    claims: compiled.claims || [],
    summary: compiled.summary || `成功创建 ${finalized.pages.length} 个 Wiki 页面`,
  };
}
