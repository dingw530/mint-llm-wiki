import { createHash } from 'node:crypto';
import * as fs from '../../infrastructure/filesystem/wiki-files.js';
import path from 'node:path';
import * as lifecycleRepo from '../../repositories/wikiLifecycleRepository.js';
import { parseWikiPage } from '../../infrastructure/filesystem/wiki-files.js';
import type { CompiledPage } from '../utils/wikiShared.js';
import type { WikiCompiledClaim } from '../utils/wikiCompiler.js';

const clamp = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

/** 将文本转换为稳定的 Claim 去重键。 */
export function normalizeClaimKey(text: string): string {
  return text.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ').slice(0, 240);
}

/** 计算内容 hash，用于 Source/Page 版本幂等和变更检测。 */
export function hashWikiContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * 将一次编译结果注册为 Source、Page 和 Claim 生命周期对象。
 * 页面内容仍由 Markdown 保存，本服务只维护可追溯的结构化索引。
 */
export function registerCompiledKnowledge(
  sourcePath: string,
  sourceText: string,
  pages: CompiledPage[],
  claims: WikiCompiledClaim[] = [],
  options: { sourceType?: string; pageEventReason?: string } = {},
): {
  source: lifecycleRepo.WikiSource;
  pages: lifecycleRepo.WikiPage[];
  claims: lifecycleRepo.WikiClaim[];
} {
  return lifecycleRepo.transaction(() => {
    const sourceHash = hashWikiContent(sourceText);
    const existingSource = lifecycleRepo.findSourceByHash(sourcePath, sourceHash);
    if (existingSource) {
      const existingRegistration = findExistingRegistration(existingSource, pages);
      if (existingRegistration) return existingRegistration;
    }
    const previousSource = existingSource ? null : lifecycleRepo.findLatestSource(sourcePath);
    const source =
      existingSource ||
      lifecycleRepo.createSource({
        path: sourcePath,
        contentHash: sourceHash,
        sourceType: options.sourceType ?? 'compiled',
      });
    if (
      previousSource &&
      previousSource.id !== source.id &&
      previousSource.status !== 'superseded'
    ) {
      lifecycleRepo.supersedeSource(previousSource.id, source.id);
      lifecycleRepo.recordEvent(
        'source',
        previousSource.id,
        'superseded',
        null,
        source.id,
        sourcePath,
        'source content hash changed',
      );
    }

    const registeredPages: lifecycleRepo.WikiPage[] = [];
    const registeredClaims: lifecycleRepo.WikiClaim[] = [];
    for (const page of pages) {
      const registration = registerCompiledPage(source, page, claims, options);
      registeredPages.push(registration.page);
      registeredClaims.push(...registration.claims);
    }
    const compiledSource = lifecycleRepo.markSourceCompiled(source.id);
    return { source: compiledSource, pages: registeredPages, claims: registeredClaims };
  });
}

/** Register one compiled page and its claims within the caller-owned transaction. */
function registerCompiledPage(
  source: lifecycleRepo.WikiSource,
  page: CompiledPage,
  claims: WikiCompiledClaim[],
  options: { pageEventReason?: string },
): { page: lifecycleRepo.WikiPage; claims: lifecycleRepo.WikiClaim[] } {
  const registeredPage = lifecycleRepo.createPage({
    path: page.filename,
    title: page.title,
    contentHash: hashWikiContent(page.content),
    sourceId: source.id,
    status: 'active',
    confidence: 0.7,
    importance: 0.6,
  });
  lifecycleRepo.recordEvent(
    'page',
    registeredPage.id,
    'created',
    null,
    source.id,
    page.filename,
    options.pageEventReason ?? 'compiled page registered',
  );

  const pageClaims = claims.filter((claim) => claim.pageTitle === page.title);
  const effectiveClaims =
    pageClaims.length > 0
      ? pageClaims
      : [
          {
            pageTitle: page.title,
            text: page.title,
            normalizedKey: `page:${normalizeClaimKey(page.title)}`,
            confidence: 0.45,
            importance: 0.4,
          },
        ];
  const registeredClaims: lifecycleRepo.WikiClaim[] = [];
  for (const claimInput of effectiveClaims) {
    const claim = registerCompiledClaim(source, page, registeredPage, claimInput);
    if (claim) registeredClaims.push(claim);
  }
  return { page: registeredPage, claims: registeredClaims };
}

/** Preserve reinforcement, conflict and confidence rules for one compiled claim. */
function registerCompiledClaim(
  source: lifecycleRepo.WikiSource,
  page: CompiledPage,
  registeredPage: lifecycleRepo.WikiPage,
  claimInput: WikiCompiledClaim,
): lifecycleRepo.WikiClaim | null {
  const claimText = claimInput.text.trim();
  if (!claimText) return null;
  const normalizedKey = claimInput.normalizedKey?.trim() || normalizeClaimKey(claimText);
  const active = lifecycleRepo.findActiveClaims(normalizedKey);
  const same = active.find((claim) => claim.claimText === claimText);
  if (same) {
    const nextConfidence = Math.min(1, same.confidence + (1 - same.confidence) * 0.12);
    const reinforced = lifecycleRepo.reinforceClaim(same.id, nextConfidence);
    lifecycleRepo.recordEvent(
      'claim',
      same.id,
      'reinforced',
      nextConfidence - same.confidence,
      source.id,
      page.filename,
      claimInput.evidence || 'same claim supported by a new compilation',
    );
    return reinforced;
  }
  const claim = lifecycleRepo.createClaim({
    pageId: registeredPage.id,
    claimText,
    normalizedKey,
    status:
      active.length > 0
        ? 'contested'
        : clamp(claimInput.confidence, 0.5) >= 0.8
          ? 'verified'
          : 'proposed',
    confidence: clamp(claimInput.confidence, 0.5),
    importance: clamp(claimInput.importance, 0.5),
  });
  lifecycleRepo.recordEvent(
    'claim',
    claim.id,
    active.length > 0 ? 'contradicted' : 'created',
    null,
    source.id,
    page.filename,
    claimInput.evidence || null,
  );
  return claim;
}

function findExistingRegistration(
  source: lifecycleRepo.WikiSource,
  pages: CompiledPage[],
): {
  source: lifecycleRepo.WikiSource;
  pages: lifecycleRepo.WikiPage[];
  claims: lifecycleRepo.WikiClaim[];
} | null {
  const registeredPages: lifecycleRepo.WikiPage[] = [];
  const registeredClaims: lifecycleRepo.WikiClaim[] = [];
  for (const page of pages) {
    const existing = lifecycleRepo.findPageByPath(page.filename);
    if (
      !existing ||
      existing.contentHash !== hashWikiContent(page.content) ||
      existing.sourceId !== source.id
    ) {
      return null;
    }
    registeredPages.push(existing);
    registeredClaims.push(...lifecycleRepo.findActiveClaimsForPage(existing.id));
  }
  return { source, pages: registeredPages, claims: registeredClaims };
}

export interface WikiLifecycleMigrationResult {
  scanned: number;
  migrated: number;
  unchanged: number;
  skipped: number;
  claimsCreated: number;
  errors: { path: string; message: string }[];
}

function findWikiSourcePath(wikiPath: string, pagePath: string, sourceHint: string): string {
  const candidates = sourceHint ? [sourceHint, path.join('sources', sourceHint)] : [];
  for (const candidate of candidates) {
    const resolved = path.resolve(wikiPath, candidate);
    if (resolved.startsWith(path.resolve(wikiPath) + path.sep) && fs.existsSync(resolved)) {
      return path.relative(wikiPath, resolved).replace(/\\/g, '/');
    }
  }
  return `legacy/${pagePath}`;
}

function scanWikiMarkdownPages(wikiPath: string): string[] {
  const pagesPath = path.join(wikiPath, 'pages');
  if (!fs.existsSync(pagesPath)) return [];
  const result: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === '.gitkeep') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        result.push(path.relative(wikiPath, absolute).replace(/\\/g, '/'));
      }
    }
  };
  walk(pagesPath);
  return result;
}

/**
 * 将旧版文件型 Wiki 页面回填到生命周期索引表；Markdown 文件本身不会被修改。
 * 相同路径和内容 hash 会被仓储层幂等跳过，可安全重复执行。
 */
export function migrateExistingWikiPages(wikiPath: string): WikiLifecycleMigrationResult {
  const result: WikiLifecycleMigrationResult = {
    scanned: 0,
    migrated: 0,
    unchanged: 0,
    skipped: 0,
    claimsCreated: 0,
    errors: [],
  };
  const absoluteWikiPath = path.resolve(wikiPath);
  if (!fs.existsSync(absoluteWikiPath) || !fs.statSync(absoluteWikiPath).isDirectory()) {
    throw new Error(`Wiki 路径不存在或不是目录: ${wikiPath}`);
  }

  for (const relativePath of scanWikiMarkdownPages(absoluteWikiPath)) {
    result.scanned++;
    migrateWikiPage(absoluteWikiPath, relativePath, result);
  }
  return result;
}

/** Migrate one legacy page and retain per-page error isolation and accounting. */
function migrateWikiPage(
  absoluteWikiPath: string,
  relativePath: string,
  result: WikiLifecycleMigrationResult,
): void {
  try {
    const pageContent = fs.readFileSync(path.join(absoluteWikiPath, relativePath), 'utf-8');
    const parsed = parseWikiPage(relativePath, pageContent);
    const sourcePath = findWikiSourcePath(absoluteWikiPath, relativePath, parsed.source);
    const sourceAbsolutePath = path.join(absoluteWikiPath, sourcePath);
    const sourceText =
      sourcePath.startsWith('legacy/') || !fs.existsSync(sourceAbsolutePath)
        ? pageContent
        : fs.readFileSync(sourceAbsolutePath, 'utf-8');
    const before = lifecycleRepo.findPageByPath(relativePath);
    const registered = registerCompiledKnowledge(
      sourcePath,
      sourceText,
      [{ filename: relativePath, title: parsed.title, tags: parsed.tags, content: pageContent }],
      [],
      { sourceType: 'legacy-migration', pageEventReason: 'legacy page migrated' },
    );
    const page = registered.pages[0];
    if (before && before.contentHash === page.contentHash) {
      result.unchanged++;
    } else {
      result.migrated++;
    }
    result.claimsCreated += registered.claims.filter((claim) => claim.pageId === page.id).length;
  } catch (error) {
    result.skipped++;
    result.errors.push({
      path: relativePath,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
