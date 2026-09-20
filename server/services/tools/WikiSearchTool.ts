import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { BaseTool } from './BaseTool.js';
import type { ToolContext } from './BaseTool.js';
import { isPathSafe, getWikiPath } from '../utils/pathSecurity.js';
import { isSystemWikiPath, parseWikiPage } from '../utils/wikiShared.js';
import { createLogger } from '../../utils/logger.js';
import * as lifecycleRepo from '../../repositories/wikiLifecycleRepository.js';
import { calculateWikiRetentionScore } from '../utils/wikiRetention.js';
import { searchWiki } from '../api/wikiSearchService.js';

const log = createLogger('wiki-search');

const WikiSearchInputSchema = z.object({
  question: z.string().optional().describe('搜索问题或关键词（二选一：question 或 paths）'),
  paths: z
    .array(z.string())
    .optional()
    .describe('直接读取指定文件路径（相对 Wiki 根目录），跳过搜索（二选一：question 或 paths）'),
  maxResults: z.coerce.number().optional().default(5).describe('搜索时返回 top N 结果，默认 5'),
  includeContent: z.coerce
    .boolean()
    .optional()
    .default(true)
    .describe('是否返回当前证据粒度的完整内容，默认 true'),
});

type WikiSearchInput = z.infer<typeof WikiSearchInputSchema>;

interface WikiSearchResult {
  chunkId?: string;
  file: string;
  content: string;
  granularity?: 'chunk' | 'page' | 'source-family';
  score: number;
  title?: string;
  heading?: string;
  snippet?: string;
  matchTypes?: string[];
  pageStatus?: lifecycleRepo.WikiPageStatus | null;
  lastVerifiedAt?: string | null;
  claimId?: string | null;
}

interface WikiSearchOutput {
  results: WikiSearchResult[];
  total: number;
  message: string;
}

/**
 * 复合 Wiki 搜索工具：支持批量读取和关键词搜索。
 * 当你知道需要哪些文件时，始终用 paths 一次性批量读取多个文件，减少循环次数。
 */
export class WikiSearchTool extends BaseTool<WikiSearchInput, WikiSearchOutput> {
  readonly name = 'wiki_search';
  readonly description =
    '搜索并读取 Wiki 知识库。question 模式返回与 chunkId 对齐的章节证据，paths 模式返回 page 粒度的完整文件。原始结果提供 chunkId 和 granularity；聊天编排层会在返回给模型的工具结果中追加本轮 refId（如 C1），回答引用时只能使用实际返回的 refId。所有 Wiki 文件访问必须通过此工具，禁止使用 bash。当你需要多个文件时，把所有路径放入 paths 一次读完，不要分多次调用；先完成一次搜索并检查证据是否足够，再决定是否补充搜索。';
  readonly inputSchema = WikiSearchInputSchema;

  isReadOnly(): boolean {
    return true;
  }
  isConcurrencySafe(): boolean {
    return true;
  }

  /**
   * 返回 Wiki 搜索或批量读取开始时展示给用户的摘要。
   */
  getCallSummary(input: WikiSearchInput): string {
    if (input.paths && input.paths.length > 0) {
      return `正在读取 ${input.paths.length} 个 Wiki 文件`;
    }

    const question = (input.question || '相关内容').trim();
    return `正在查找：${question.length > 80 ? question.substring(0, 80) + '...' : question}`;
  }

  /**
   * 返回 Wiki 搜索或批量读取完成后的数量摘要。
   */
  getResultSummary(result: WikiSearchOutput): string {
    if (result.message.startsWith('已读取')) return `已读取 ${result.total} 个文件`;
    if (result.total > 0)
      return `找到 ${result.total} 个相关页面，返回前 ${result.results.length} 个`;
    return '未找到相关内容';
  }

  async execute(input: WikiSearchInput, context: ToolContext): Promise<WikiSearchOutput> {
    const normalizedInput = this.inputSchema.parse(input);
    const wikiPath = getWikiPath();
    if (!wikiPath) {
      throw new Error('Wiki 路径未配置，请在设置中配置 wikiPath');
    }

    // 路径模式：直接读取指定文件
    if (normalizedInput.paths && normalizedInput.paths.length > 0) {
      log.info('[wiki_search] mode=paths', {
        pathCount: normalizedInput.paths.length,
        paths: normalizedInput.paths.slice(0, 10),
      });
      const result = this.readFiles(wikiPath, normalizedInput.paths);
      log.info('[wiki_search] paths result', {
        totalResults: result.total,
        message: result.message,
      });
      return result;
    }

    if (!normalizedInput.question) {
      throw new Error('question 或 paths 至少需要提供一个');
    }

    // 搜索模式：关键词搜索 + 返回与 chunkId 对齐的证据内容
    log.info('[wiki_search] mode=question', {
      question: normalizedInput.question.substring(0, 100),
      maxResults: normalizedInput.maxResults,
      includeContent: normalizedInput.includeContent,
    });
    const result = await searchWiki(
      wikiPath,
      normalizedInput.question,
      normalizedInput.maxResults,
      normalizedInput.includeContent,
      context.runtimeContext,
    );
    log.info('[wiki_search] search result', {
      totalResults: result.total,
      topFiles: result.results.slice(0, 5).map((r) => r.file),
    });
    return result;
  }

  private readFiles(wikiPath: string, paths: string[]): WikiSearchOutput {
    const results: WikiSearchResult[] = [];

    for (const filePath of paths) {
      if (!isPathSafe(wikiPath, filePath)) {
        results.push({
          chunkId: `${filePath}#file`,
          file: filePath,
          content: `[路径不安全: ${filePath}]`,
          granularity: 'page',
          score: 0,
          title: filePath,
          snippet: '',
        });
        continue;
      }

      const resolvedPath = path.resolve(wikiPath, filePath);
      if (!fs.existsSync(resolvedPath)) {
        results.push({
          chunkId: `${filePath}#file`,
          file: filePath,
          content: `[文件不存在: ${filePath}]`,
          granularity: 'page',
          score: 0,
          title: filePath,
          snippet: '',
        });
        continue;
      }

      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        // 目录 → 列出内容
        const entries = fs.readdirSync(resolvedPath);
        const listing = entries
          .map((e) => {
            const full = path.join(resolvedPath, e);
            const isDir = fs.statSync(full).isDirectory();
            return `${isDir ? '[DIR]' : '[FILE]'} ${e}`;
          })
          .join('\n');
        results.push({
          chunkId: `${filePath}#listing`,
          file: filePath,
          content: listing,
          granularity: 'page',
          score: 1,
          title: filePath,
          snippet: '',
        });
      } else {
        const content = fs.readFileSync(resolvedPath, 'utf-8');
        const parsed = parseWikiPage(filePath, content);
        results.push({
          chunkId: `${filePath}#file`,
          file: filePath,
          content: content.substring(0, 100000),
          granularity: 'page',
          score: 1,
          title: parsed.title,
          snippet: '',
        });
      }
    }

    return {
      results,
      total: results.length,
      message: `已读取 ${results.length} 个文件`,
    };
  }

  private searchAndRead(
    wikiPath: string,
    question: string,
    maxResults: number,
    includeContent: boolean,
  ): WikiSearchOutput {
    maxResults = Math.max(1, maxResults);
    const keywords = this.extractKeywords(question);
    if (keywords.length === 0) {
      return { results: [], total: 0, message: '未能从问题中提取有效关键词' };
    }

    const pagesDir = path.join(wikiPath, 'pages');
    const mdFiles = this.findMdFiles(pagesDir);
    const scored: { file: string; score: number; content: string; snippet: string }[] = [];

    for (const filePath of mdFiles) {
      const relativePath = path.relative(wikiPath, filePath);
      if (isSystemWikiPath(relativePath)) continue;

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseWikiPage(relativePath, content);
        const baseScore = this.scorePage(parsed, keywords);
        let lifecycle: lifecycleRepo.WikiPage | null = null;
        try {
          lifecycle = lifecycleRepo.findPageByPath(relativePath);
        } catch {
          // 生命周期索引不可用时保留原有文件搜索能力。
        }
        if (lifecycle && ['superseded', 'archived', 'deleted'].includes(lifecycle.status)) continue;
        const retention = lifecycle ? calculateWikiRetentionScore(lifecycle) : 1;
        const score = baseScore * (1 + retention);
        if (baseScore > 0) {
          scored.push({
            file: relativePath,
            score,
            content,
            snippet: this.extractSnippet(parsed.body, keywords, parsed.headings),
          });
        }
      } catch {
        // 跳过无法读取的文件
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, maxResults);

    for (const item of top) {
      let lifecycle: lifecycleRepo.WikiPage | null = null;
      try {
        lifecycle = lifecycleRepo.findPageByPath(item.file);
      } catch {
        // 访问反馈是增强能力，不能阻塞搜索结果返回。
      }
      if (lifecycle) {
        try {
          lifecycleRepo.touchPage(lifecycle.id);
          lifecycleRepo.recordEvent(
            'page',
            lifecycle.id,
            'accessed',
            null,
            lifecycle.sourceId,
            item.file,
            'wiki_search result selected',
          );
        } catch {
          // 搜索结果已经确定，访问统计失败不影响响应。
        }
      }
    }

    const results: WikiSearchResult[] = top.map((item) => ({
      file: item.file,
      content: includeContent
        ? item.content.length <= 100000
          ? item.content
          : item.content.substring(0, 100000) + '...'
        : item.snippet,
      score: item.score,
    }));

    const filesList = results.map((r) => r.file).join('\n');
    return {
      results,
      total: scored.length,
      message:
        scored.length > 0
          ? `找到 ${scored.length} 个相关页面，已返回前 ${results.length} 个。可用 paths 直接读取以下文件：\n${filesList}`
          : '未找到相关内容',
    };
  }

  // ── 关键词提取 ──

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      '的',
      '了',
      '在',
      '是',
      '我',
      '有',
      '和',
      '就',
      '不',
      '人',
      '都',
      '一',
      '一个',
      '上',
      '也',
      '很',
      '到',
      '说',
      '要',
      '去',
      '你',
      '会',
      '着',
      '没有',
      '看',
      '好',
      '自己',
      '这',
      '他',
      '她',
      '它',
      '们',
      '什么',
      '怎么',
      '如何',
      '为什么',
      '哪些',
      '哪个',
      '请',
      '吗',
      '吧',
      '呢',
      '啊',
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'can',
      'shall',
      'to',
      'of',
      'in',
      'for',
      'on',
      'with',
      'at',
      'by',
      'from',
      'as',
      'into',
      'through',
      'during',
      'before',
      'after',
      'above',
      'below',
      'between',
      'about',
    ]);
    return text
      .split(/[\]\s,，。.！？、；：""''（）()【】[{}]+/)
      .filter((w) => w.length >= 2 && !stopWords.has(w.toLowerCase()));
  }

  private countMatches(content: string, keywords: string[]): number {
    const lowerContent = content.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      const lowerKw = kw.toLowerCase();
      const regex = new RegExp(lowerKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const matches = lowerContent.match(regex);
      if (matches) score += matches.length;
    }
    return score;
  }

  private scorePage(
    page: { file: string; title: string; tags: string[]; headings: string[]; body: string },
    keywords: string[],
  ): number {
    const pathScore = this.countMatches(page.file, keywords) * 40;
    const titleScore = this.countMatches(page.title, keywords) * 50;
    const tagScore = this.countMatches(page.tags.join(' '), keywords) * 35;
    const headingScore = this.countMatches(page.headings.join('\n'), keywords) * 20;
    const bodyScore = this.countMatches(page.body, keywords);
    return pathScore + titleScore + tagScore + headingScore + bodyScore;
  }

  private extractSnippet(content: string, keywords: string[], headings: string[]): string {
    const headingContext = headings.find((heading) =>
      keywords.some((kw) => heading.toLowerCase().includes(kw.toLowerCase())),
    );
    if (headingContext) {
      const headingIndex = content.toLowerCase().indexOf(headingContext.toLowerCase());
      if (headingIndex >= 0) {
        const start = Math.max(0, headingIndex - 80);
        const end = Math.min(content.length, headingIndex + 720);
        const prefix = start > 0 ? '...' : '';
        const suffix = end < content.length ? '...' : '';
        return prefix + content.substring(start, end) + suffix;
      }
    }

    const lowerContent = content.toLowerCase();
    let bestIdx = -1;
    for (const kw of keywords) {
      const idx = lowerContent.indexOf(kw.toLowerCase());
      if (idx >= 0) {
        bestIdx = idx;
        break;
      }
    }
    if (bestIdx < 0) return content.length <= 500 ? content : content.substring(0, 500) + '...';

    const start = Math.max(0, bestIdx - 200);
    const end = Math.min(content.length, bestIdx + 800);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < content.length ? '...' : '';
    return prefix + content.substring(start, end) + suffix;
  }

  private findMdFiles(dirPath: string): string[] {
    const files: string[] = [];
    try {
      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          files.push(...this.findMdFiles(fullPath));
        } else if (entry.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    } catch {
      // 跳过无法访问的目录
    }
    return files;
  }
}
