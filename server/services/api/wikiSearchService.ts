import * as fs from 'node:fs';
import * as path from 'node:path';
import * as lifecycleRepo from '../../repositories/wikiLifecycleRepository.js';
import * as searchRepo from '../../repositories/wikiSearchRepository.js';
import { getAiSettings, getJevSettings } from './settingsService.js';
import { createWikiVectorService, pruneWikiVectorOrphans } from '../vector/index.js';
import { baseRrfScore } from '../rerank/legacyRerankProvider.js';
import { rerankCandidates } from '../rerank/index.js';
import type {
  OpenAICompatibleEmbeddingConfig,
  VectorHealth,
  VectorSearchHit,
} from '../vector/types.js';
import type { RerankCandidate, RerankedCandidate } from '../rerank/types.js';
import { isSystemWikiPath, parseWikiPage } from '../utils/wikiShared.js';
import { createLogger } from '../../utils/logger.js';
import { ExternalServiceError } from '../resilience/index.js';

const log = createLogger('wiki-search');

export interface WikiSearchResult {
  chunkId: string;
  file: string;
  title: string;
  heading: string;
  content: string;
  granularity: 'chunk' | 'page' | 'source-family';
  snippet: string;
  score: number;
  matchTypes: string[];
  pageStatus: lifecycleRepo.WikiPageStatus | null;
  lastVerifiedAt: string | null;
  claimId: string | null;
  lexicalRank: number | null;
  vectorRank: number | null;
  distance: number | null;
}

export interface WikiSearchOutput {
  results: WikiSearchResult[];
  total: number;
  message: string;
}

interface Chunk {
  heading: string;
  body: string;
}

interface RankedDocument extends RerankedCandidate {
  aggregateMatchTypes?: string[];
}

function splitChunks(body: string): Chunk[] {
  const chunks: Chunk[] = [];
  let heading = '';
  let lines: string[] = [];
  const flush = (): void => {
    const content = lines.join('\n').trim();
    if (content) chunks.push({ heading, body: content });
    lines = [];
  };
  for (const line of body.split('\n')) {
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (match) {
      flush();
      heading = match[1].trim();
    } else {
      lines.push(line);
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [{ heading: '', body }];
}

function listMarkdownFiles(wikiPath: string): string[] {
  const pagesDir = path.join(wikiPath, 'pages');
  if (!fs.existsSync(pagesDir)) return [];
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir)) {
      const absolute = path.join(dir, entry);
      if (fs.statSync(absolute).isDirectory()) walk(absolute);
      else if (entry.endsWith('.md')) files.push(absolute);
    }
  };
  walk(pagesDir);
  return files;
}

function embeddingConfig(
  settings: ReturnType<typeof getAiSettings>,
): OpenAICompatibleEmbeddingConfig {
  return {
    apiUrl: settings.embeddingApiUrl,
    model: settings.embeddingModel,
    dimensions: settings.embeddingDimensions,
    vectorStore: settings.vectorStore,
    chromaUrl: settings.chromaUrl,
    chromaApiKey: settings.chromaApiKey,
  };
}

function documentText(document: searchRepo.WikiSearchDocumentInput): string {
  return `${document.title}\n${document.heading}\n${document.body}`;
}

function buildDocuments(relative: string, content: string): searchRepo.WikiSearchDocumentInput[] {
  const parsed = parseWikiPage(relative, content);
  const chunks = splitChunks(parsed.body);
  return chunks.map((chunk, index) => ({
    id: `${relative}#chunk:${index}`,
    pageId: null,
    sourcePath: relative,
    title: parsed.title,
    heading: chunk.heading,
    body: `${parsed.tags.join(' ')}\n${chunk.body}`,
    documentType: 'chunk',
    contentHash: searchRepo.hashSearchContent(`${parsed.title}\n${chunk.heading}\n${chunk.body}`),
  }));
}

function addClaims(
  relative: string,
  documents: searchRepo.WikiSearchDocumentInput[],
  page: lifecycleRepo.WikiPage | null,
  title: string,
): void {
  if (!page) return;
  const claims = lifecycleRepo.findActiveClaimsForPage(page.id);
  documents.push(
    ...claims.map((claim) => ({
      id: `${relative}#claim:${claim.id}`,
      pageId: page.id,
      sourcePath: relative,
      title,
      heading: 'Claim',
      body: claim.claimText,
      documentType: 'claim' as const,
      contentHash: searchRepo.hashSearchContent(claim.claimText),
    })),
  );
}

/** 全量重建 Wiki FTS 索引，并按 hash 增量同步向量。 */
export async function rebuildWikiSearchIndex(
  wikiPath: string,
  config?: OpenAICompatibleEmbeddingConfig,
): Promise<void> {
  const startedAt = performance.now();
  log.info('wiki search index rebuild started', {
    wikiPath,
    vectorIndexing: Boolean(config),
    embeddingModel: config?.model,
    embeddingDimensions: config?.dimensions,
  });
  try {
    const activeSourcePaths = new Set<string>();
    const vectorService = config ? createWikiVectorService(config, documentText) : null;
    for (const absolute of listMarkdownFiles(wikiPath)) {
      const relative = path.relative(wikiPath, absolute).replaceAll(path.sep, '/');
      if (isSystemWikiPath(relative)) continue;
      let content: string;
      try {
        content = fs.readFileSync(absolute, 'utf8');
      } catch {
        continue;
      }
      const parsed = parseWikiPage(relative, content);
      const page = lifecycleRepo.findPageByPath(relative);
      if (page && ['deleted', 'superseded'].includes(page.status)) continue;
      activeSourcePaths.add(relative);
      const documents = buildDocuments(relative, content);
      documents.forEach((document) => {
        document.pageId = page?.id ?? null;
      });
      addClaims(relative, documents, page, parsed.title);
      const indexChange = searchRepo.replacePageDocuments(relative, documents);
      await vectorService?.removeDocuments(indexChange.removedDocumentIds);
      if (vectorService) {
        try {
          await vectorService.syncDocuments(documents);
        } catch (error) {
          log.warn('wiki vector indexing unavailable; FTS index retained', {
            sourcePath: relative,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    const removed = searchRepo.removeStaleSearchDocuments([...activeSourcePaths]);
    const pruned = await pruneWikiVectorOrphans();
    if (removed > 0 || pruned > 0)
      log.info('wiki search stale index entries removed', {
        removedDocuments: removed,
        orphanVectors: pruned,
      });
  } finally {
    log.duration('wiki.search.index_rebuild', startedAt, {
      wikiPath,
      vectorIndexing: Boolean(config),
      embeddingModel: config?.model,
      embeddingDimensions: config?.dimensions,
    });
  }
}

function buildSnippet(body: string, terms: string[]): string {
  const cleanedBody = body
    .replace(/\r\n?/g, '\n')
    .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^---+$/.test(line) &&
        !/^(title|tags|created|source)\s*:/i.test(line) &&
        !/^#{1,6}\s+/.test(line),
    )
    .join(' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[ `*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = cleanedBody.toLocaleLowerCase();
  const index =
    terms
      .map((term) => lower.indexOf(term.toLocaleLowerCase()))
      .filter((value) => value >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, index - 160);
  const end = Math.min(cleanedBody.length, start + 520);
  return `${start > 0 ? '...' : ''}${cleanedBody.slice(start, end)}${end < cleanedBody.length ? '...' : ''}`;
}

function mergeCandidates(
  lexical: searchRepo.WikiSearchDocumentInput[],
  vector: VectorSearchHit<searchRepo.WikiSearchDocumentInput>[],
): RerankCandidate[] {
  const candidates = new Map<string, RerankCandidate>();
  lexical.forEach((document, index) => {
    candidates.set(document.id, {
      document,
      lexicalRank: index + 1,
      vectorRank: null,
      vectorDistance: null,
    });
  });
  vector.forEach((hit, index) => {
    const existing = candidates.get(hit.document.id);
    if (existing) {
      existing.vectorRank = index + 1;
      existing.vectorDistance = hit.distance;
    } else
      candidates.set(hit.document.id, {
        document: hit.document,
        lexicalRank: null,
        vectorRank: index + 1,
        vectorDistance: hit.distance,
      });
  });
  return [...candidates.values()];
}

function evidenceBoost(document: searchRepo.WikiSearchDocumentInput, terms: string[]): number {
  const lowerTerms = terms.map((term) => term.toLocaleLowerCase());
  return (
    (document.title && lowerTerms.some((term) => document.title.toLocaleLowerCase().includes(term))
      ? 8
      : 0) +
    (document.heading &&
    lowerTerms.some((term) => document.heading.toLocaleLowerCase().includes(term))
      ? 5
      : 0)
  );
}

function effectiveRankScore(candidate: RerankedCandidate): number {
  return candidate.semanticScore === undefined ? baseRrfScore(candidate) : candidate.rankScore;
}

/** 将 chunk 级融合候选聚合为页面级结果，并保留最佳证据片段。 */
function aggregatePageCandidates(
  candidates: RerankedCandidate[],
  terms: string[],
): RankedDocument[] {
  const pages = new Map<string, RankedDocument>();
  for (const candidate of candidates) {
    const existing = pages.get(candidate.document.sourcePath);
    if (!existing) {
      pages.set(candidate.document.sourcePath, {
        ...candidate,
        aggregateMatchTypes: resultMatchTypes(candidate.document, terms, candidate, false),
      });
      continue;
    }
    existing.lexicalRank = Math.min(
      existing.lexicalRank ?? Number.POSITIVE_INFINITY,
      candidate.lexicalRank ?? Number.POSITIVE_INFINITY,
    );
    existing.vectorRank = Math.min(
      existing.vectorRank ?? Number.POSITIVE_INFINITY,
      candidate.vectorRank ?? Number.POSITIVE_INFINITY,
    );
    existing.lexicalRank = Number.isFinite(existing.lexicalRank) ? existing.lexicalRank : null;
    existing.vectorRank = Number.isFinite(existing.vectorRank) ? existing.vectorRank : null;
    existing.aggregateMatchTypes = [
      ...new Set([
        ...(existing.aggregateMatchTypes || []),
        ...resultMatchTypes(candidate.document, terms, candidate, false),
      ]),
    ];
    const existingRank = effectiveRankScore(existing) + evidenceBoost(existing.document, terms);
    const candidateRank = effectiveRankScore(candidate) + evidenceBoost(candidate.document, terms);
    if (candidateRank > existingRank) {
      existing.document = candidate.document;
      existing.vectorDistance = candidate.vectorDistance;
      existing.rankScore = candidate.rankScore;
      existing.semanticScore = candidate.semanticScore;
    }
  }
  return [...pages.values()].map((page) => ({
    ...page,
    rankScore: effectiveRankScore(page),
  }));
}

function extractTerms(question: string): string[] {
  return question.match(/[A-Za-z0-9_]+|[\u4e00-\u9fff]{2,}/g) ?? [];
}

function resultMatchTypes(
  candidate: searchRepo.WikiSearchDocumentInput,
  terms: string[],
  ranked: RankedDocument,
  fallback: boolean,
): string[] {
  const tagLine = candidate.body.split('\n', 1)[0] || '';
  return [
    ranked.lexicalRank ? 'keyword' : '',
    ranked.vectorRank ? 'vector' : '',
    candidate.title &&
    terms.some((term) => candidate.title.toLocaleLowerCase().includes(term.toLocaleLowerCase()))
      ? 'title'
      : '',
    candidate.heading &&
    terms.some((term) => candidate.heading.toLocaleLowerCase().includes(term.toLocaleLowerCase()))
      ? 'heading'
      : '',
    terms.some((term) => tagLine.toLocaleLowerCase().includes(term.toLocaleLowerCase()))
      ? 'tag'
      : '',
    candidate.documentType === 'claim' ? 'claim' : 'body',
    fallback ? 'keyword-fallback' : '',
  ].filter(Boolean);
}

function toSearchResult(
  candidate: RankedDocument,
  wikiPath: string,
  terms: string[],
  includeContent: boolean,
  fallback: boolean,
): WikiSearchResult | null {
  const document = candidate.document;
  const page = document.pageId
    ? lifecycleRepo.findPageById(document.pageId)
    : lifecycleRepo.findPageByPath(document.sourcePath);
  if (page && ['deleted', 'superseded', 'archived'].includes(page.status)) return null;
  const matchTypes = [
    ...new Set([
      ...(candidate.aggregateMatchTypes || []),
      ...resultMatchTypes(document, terms, candidate, fallback),
    ]),
  ];
  const score =
    candidate.rankScore +
    (matchTypes.includes('title') ? 8 : 0) +
    (matchTypes.includes('heading') ? 5 : 0) +
    (matchTypes.includes('tag') ? 5 : 0) +
    (matchTypes.includes('claim') ? 3 : 0) +
    (page ? lifecycleRepo.getSearchRelevanceBoost(page) : 0);
  const snippet = `${document.heading ? `## ${document.heading}\n` : ''}${buildSnippet(document.body, terms)}`;
  const evidenceContent = document.heading
    ? `## ${document.heading}\n${document.body}`
    : document.body;
  return {
    chunkId: document.id,
    file: document.sourcePath,
    title: document.title,
    heading: document.heading,
    // Keep model-visible content at the same granularity as document.id.
    content: includeContent ? evidenceContent : snippet,
    granularity: 'chunk',
    snippet,
    score,
    matchTypes,
    pageStatus: page?.status ?? null,
    lastVerifiedAt: page?.lastConfirmedAt ?? null,
    claimId: document.documentType === 'claim' ? (document.id.split('#claim:')[1] ?? null) : null,
    lexicalRank: candidate.lexicalRank,
    vectorRank: candidate.vectorRank,
    distance: candidate.vectorDistance,
  };
}

/** 返回当前 Wiki 搜索文档的向量健康度。 */
export async function getWikiVectorHealth(
  config: OpenAICompatibleEmbeddingConfig,
): Promise<VectorHealth> {
  return createWikiVectorService(config, documentText).getHealth();
}

/**
 * 首个命中页来自多页拆分的同一原始资料时，补足其兄弟页，帮助回答跨主题的综合问题。
 */
function expandSourceFamilyResults(
  wikiPath: string,
  results: WikiSearchResult[],
  maxResults: number,
  includeContent: boolean,
): WikiSearchResult[] {
  if (results.length === 0 || results.length >= maxResults) return results;
  const leadPath = path.join(wikiPath, resultPath(results[0].file));
  let source = '';
  try {
    source = parseWikiPage(results[0].file, fs.readFileSync(leadPath, 'utf8')).source;
  } catch {
    return results;
  }
  if (!source) return results;

  const existing = new Set(results.map((result) => result.file));
  for (const absolute of listMarkdownFiles(wikiPath)) {
    if (results.length >= maxResults) break;
    const file = path.relative(wikiPath, absolute).replaceAll(path.sep, '/');
    if (existing.has(file)) continue;
    let content: string;
    let page: ReturnType<typeof parseWikiPage>;
    try {
      content = fs.readFileSync(absolute, 'utf8');
      page = parseWikiPage(file, content);
    } catch {
      continue;
    }
    if (page.source !== source) continue;
    const lifecycle = lifecycleRepo.findPageByPath(file);
    if (lifecycle && ['deleted', 'superseded', 'archived'].includes(lifecycle.status)) continue;
    results.push({
      chunkId: `${file}#source-family`,
      file,
      title: page.title,
      heading: '',
      content: includeContent ? content : '',
      snippet: `同源资料：${source}`,
      granularity: 'source-family',
      score: Math.max(0, results[0].score - results.length * 0.01),
      matchTypes: ['source-family'],
      pageStatus: lifecycle?.status ?? null,
      lastVerifiedAt: lifecycle?.lastConfirmedAt ?? null,
      claimId: null,
      lexicalRank: null,
      vectorRank: null,
      distance: null,
    });
    existing.add(file);
  }
  return results;
}

/** 为指定搜索文档逐项回填向量，单项失败不会阻断后续页面。 */
export async function backfillWikiEmbeddings(
  documents: searchRepo.WikiSearchDocument[],
  config: OpenAICompatibleEmbeddingConfig,
  onProgress?: (
    processed: number,
    indexed: number,
    skipped: number,
    failed: number,
    currentPath: string,
  ) => void,
): Promise<{ indexed: number; skipped: number; failed: number }> {
  return createWikiVectorService(config, documentText).backfill(documents, onProgress);
}

/** 构建或复用 Wiki 索引，并执行 FTS + 向量 RRF 融合。 */
export async function searchWiki(
  wikiPath: string,
  question: string,
  maxResults: number,
  includeContent: boolean,
): Promise<WikiSearchOutput> {
  const startedAt = performance.now();
  const terms = extractTerms(question);
  const settings = getAiSettings();
  const config = settings.wikiSearchMode === 'hybrid' ? embeddingConfig(settings) : undefined;
  const searchMode = config ? 'hybrid' : 'keyword';
  log.info('wiki search started', {
    searchMode,
    queryLength: question.length,
    maxResults,
    includeContent,
    embeddingModel: config?.model,
    embeddingDimensions: config?.dimensions,
  });
  if (terms.length === 0) {
    log.info('wiki search skipped: no searchable terms', { searchMode });
    return { results: [], total: 0, message: '未能从问题中提取有效关键词' };
  }
  const hasAnyPathIndex = listMarkdownFiles(wikiPath).some((absolute) => {
    const relative = path.relative(wikiPath, absolute).replaceAll(path.sep, '/');
    return !isSystemWikiPath(relative) && searchRepo.hasSearchDocumentsForPath(relative);
  });
  if (!hasAnyPathIndex) {
    log.debug('wiki search index missing; rebuilding before query', { wikiPath, searchMode });
    await rebuildWikiSearchIndex(wikiPath, config);
  }

  const lexical = searchRepo.searchDocuments(question, Math.max(maxResults * 8, 30));
  log.debug('wiki lexical candidates ready', { count: lexical.length });
  let vector: VectorSearchHit<searchRepo.WikiSearchDocumentInput>[] = [];
  let fallback = false;
  if (config) {
    try {
      const vectorService = createWikiVectorService(config, documentText);
      vector = await vectorService.search(question, Math.max(maxResults * 8, 30));
      log.info('wiki vector candidates ready', {
        count: vector.length,
        model: config.model,
        dimensions: config.dimensions,
      });
      log.info('wiki vector search results', {
        totalCandidates: vector.length,
        results: vector.slice(0, maxResults).map((hit, index) => ({
          rank: index + 1,
          chunkId: hit.document.id,
          sourcePath: hit.document.sourcePath,
          title: hit.document.title,
          heading: hit.document.heading,
          distance: hit.distance,
        })),
      });
    } catch (error) {
      fallback = true;
      const fallbackReason =
        error instanceof ExternalServiceError
          ? error.circuitState === 'open'
            ? 'circuit-open'
            : error.category
          : 'service-unavailable';
      log.warn('wiki vector query failed; using FTS fallback', {
        model: config.model,
        dimensions: config.dimensions,
        fallbackReason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const retrievedCandidates = mergeCandidates(lexical, vector);
  const fusedCandidateCount = retrievedCandidates.length;
  const rerankResult = await rerankCandidates(
    { query: question, candidates: retrievedCandidates },
    { jev: getJevSettings() },
  );
  const ranked = rerankResult.kind === 'ranked' ? rerankResult.candidates : [];
  log.info('wiki rerank completed', {
    provider: rerankResult.kind === 'ranked' ? rerankResult.providerId : 'unavailable',
    candidateCount: retrievedCandidates.length,
    semanticCandidates: ranked.filter((candidate) => candidate.semanticScore !== undefined).length,
    fallback: rerankResult.kind === 'unavailable' || rerankResult.providerId.includes(':fallback:'),
    fallbackReason: rerankResult.kind === 'unavailable' ? rerankResult.reason : undefined,
  });
  const pageCandidates = aggregatePageCandidates(ranked, terms);
  pageCandidates.sort((left, right) => right.rankScore - left.rankScore);
  const results: WikiSearchResult[] = [];
  for (const candidate of pageCandidates) {
    if (results.length >= maxResults) break;
    const result = toSearchResult(candidate, wikiPath, terms, includeContent, fallback);
    if (!result) continue;
    results.push(result);
  }
  expandSourceFamilyResults(wikiPath, results, maxResults, includeContent);
  results.sort((a, b) => b.score - a.score);
  for (const result of results) {
    const page = lifecycleRepo.findPageByPath(result.file);
    if (page) lifecycleRepo.touchPage(page.id);
  }
  const modeMessage = fallback ? '向量服务不可用，已降级为关键词搜索。' : '';
  log.duration('wiki.search', startedAt, {
    searchMode,
    lexicalCandidates: lexical.length,
    vectorCandidates: vector.length,
    fusedCandidates: fusedCandidateCount,
    returnedResults: results.length,
    fusedPages: pageCandidates.length,
    fallback,
    embeddingModel: config?.model,
    embeddingDimensions: config?.dimensions,
  });
  return {
    results,
    total: pageCandidates.length,
    message:
      results.length > 0
        ? `找到 ${fusedCandidateCount} 个相关片段，聚合为 ${pageCandidates.length} 个页面，已返回 ${results.length} 个页面证据。${modeMessage}`
        : `${modeMessage || '未找到相关内容'}`,
  };
}

function resultPath(relativePath: string): string {
  return relativePath.replaceAll('/', path.sep);
}
