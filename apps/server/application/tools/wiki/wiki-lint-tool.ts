import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { BaseTool } from '../../../agent-runtime/tooling/base-tool.js';
import type { ToolContext } from '../../../agent-runtime/tooling/tool-contracts.js';
import { getWikiPath } from '../../wiki/wiki-path.js';
import {
  parseWikiFrontmatter,
  parseWikiPage,
  readWikiManifest,
} from '../../../infrastructure/filesystem/wiki-content.js';
import {
  getWikiPathCandidates,
  resolveWikiMarkdownLink,
} from '../../../infrastructure/filesystem/wiki-link-protocol.js';
import { WikiSearchTool } from './wiki-search-tool.js';

const WikiLintInputSchema = z.object({});

type WikiLintInput = z.infer<typeof WikiLintInputSchema>;

interface LintIssue {
  type:
    | 'orphan'
    | 'broken_link'
    | 'missing_frontmatter'
    | 'missing_required_field'
    | 'schema_mismatch'
    | 'uncompiled_source'
    | 'manifest_missing'
    | 'manifest_mismatch'
    | 'index_drift';
  file: string;
  description: string;
}

interface WikiLintOutput {
  healthy: boolean;
  directoryTree: string;
  issues: LintIssue[];
  totalSourceFiles: number;
  totalPages: number;
  summary: string;
}

export class WikiLintTool extends BaseTool<WikiLintInput, WikiLintOutput> {
  readonly name = 'wiki_lint';
  readonly description = `检查 Wiki 知识库的健康状况。输出目录结构、元数据检查，并通过 wiki_search 验证所有内部链接是否断裂。
检查范围：pages/（Wiki 知识层）和 sources/（Sources 层）。
检查项：缺少 frontmatter、必填字段缺失、Schema 标签合规性、未编译资料、断裂链接、孤立页面、manifest 一致性、索引漂移。`;
  readonly inputSchema = WikiLintInputSchema;

  isReadOnly(): boolean {
    return true;
  }

  isConcurrencySafe(): boolean {
    return true;
  }

  /**
   * 返回 Wiki 健康检查开始时展示给用户的摘要。
   */
  getCallSummary(_input: WikiLintInput): string {
    return '正在检查 Wiki 健康状况';
  }

  /**
   * 返回 Wiki 健康检查完成后的状态和问题数量摘要。
   */
  getResultSummary(result: WikiLintOutput): string {
    return result.healthy
      ? `Wiki 检查完成：健康，${result.issues.length} 个问题`
      : `Wiki 检查完成：发现问题，${result.issues.length} 个问题`;
  }

  async execute(_input: WikiLintInput, _context: ToolContext): Promise<WikiLintOutput> {
    const wikiPath = getWikiPath();
    if (!wikiPath) {
      throw new Error('Wiki 路径未配置，请在设置中配置 wikiPath');
    }

    const issues: LintIssue[] = [];

    // 读取 Schema
    const schema = this.readSchema(wikiPath);
    const validTags = new Set<string>((schema.tags as string[]) || []);
    const manifest = readWikiManifest(wikiPath);
    const manifestPath = path.join(wikiPath, '_manifest.json');
    if (!fs.existsSync(manifestPath)) {
      issues.push({
        type: 'manifest_missing',
        file: '_manifest.json',
        description: 'manifest 文件不存在',
      });
    }

    // 扫描 sources/ 和 pages/
    const sourcesDir = path.join(wikiPath, 'sources');
    const pagesDir = path.join(wikiPath, 'pages');

    const sourceFiles = this.findMdFiles(sourcesDir);
    const pageFiles = this.findMdFiles(pagesDir);

    // 生成目录树
    const treeLines: string[] = ['pages/'];
    for (const filePath of pageFiles) {
      const relPath = path.relative(pagesDir, filePath);
      treeLines.push('  ' + relPath);
    }
    treeLines.push('sources/');
    for (const filePath of sourceFiles) {
      const relPath = path.relative(sourcesDir, filePath);
      if (relPath === '.gitkeep') continue;
      treeLines.push('  ' + relPath);
    }
    const directoryTree = treeLines.join('\n');

    // 第二轮：检查页面元数据 + 提取内部链接
    const linksToVerify: Array<{ source: string; target: string }> = [];
    const inboundTargets = new Set<string>();
    const indexedPages = this.readIndexedPages(wikiPath);
    const pageSet = new Set<string>();
    const manifestPageSet = new Set<string>();
    for (const entry of manifest.entries) {
      for (const pageFile of entry.pageFiles) {
        manifestPageSet.add(pageFile.replace(/\\/g, '/'));
      }
    }

    for (const filePath of pageFiles) {
      const relPath = path.relative(wikiPath, filePath);
      pageSet.add(relPath.replace(/\\/g, '/'));

      try {
        const content = fs.readFileSync(filePath, 'utf-8');

        // 检查 frontmatter
        if (!content.startsWith('---')) {
          issues.push({
            type: 'missing_frontmatter',
            file: relPath,
            description: '缺少 YAML frontmatter',
          });
        } else {
          const frontmatter = parseWikiFrontmatter(content);
          if (frontmatter) {
            const tags: string[] = (frontmatter.tags as string[]) || [];
            for (const field of ['title', 'created', 'source']) {
              if (
                !frontmatter[field] ||
                typeof frontmatter[field] !== 'string' ||
                !(frontmatter[field] as string).trim()
              ) {
                issues.push({
                  type: 'missing_required_field',
                  file: relPath,
                  description: `frontmatter 缺少必填字段 "${field}"`,
                });
              }
            }
            if (validTags.size > 0) {
              for (const tag of tags) {
                if (!validTags.has(tag)) {
                  issues.push({
                    type: 'schema_mismatch',
                    file: relPath,
                    description: `标签 "${tag}" 不在 _schema.json 的 tags 中`,
                  });
                }
              }
            }
          }
        }

        // 提取内部 Markdown 链接
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let match: RegExpExecArray | null;
        while ((match = linkRegex.exec(content)) !== null) {
          const rawTarget = match[2];
          const resolved = resolveWikiMarkdownLink(relPath, rawTarget);
          if (!resolved || !resolved.path.startsWith('pages/')) continue;

          linksToVerify.push({ source: relPath, target: resolved.path });
        }

        const page = parseWikiPage(relPath, content);
        const entryByPageFile = manifest.entries.find((entry) =>
          entry.pageFiles.map((item) => item.replace(/\\/g, '/')).includes(page.file),
        );
        if (entryByPageFile) {
          // 如果 manifest 记录明确无源文件（sourceFile 为空且无 archivedFiles），
          // 说明是手动创建的页面，不报 mismatch
          const hasNoSource =
            !entryByPageFile.sourceFile && entryByPageFile.archivedFiles.length === 0;
          if (!hasNoSource) {
            const sourceCandidates = [
              entryByPageFile.sourceFile,
              ...entryByPageFile.archivedFiles,
            ].map((item) => path.basename(item));
            if (!page.source || !sourceCandidates.includes(path.basename(page.source))) {
              issues.push({
                type: 'manifest_mismatch',
                file: relPath,
                description: '页面 source 未匹配到 manifest 记录',
              });
            }
          }
        } else {
          const hasSourceMatch = page.source
            ? manifest.entries.some((entry) => {
                const sourceCandidates = [entry.sourceFile, ...entry.archivedFiles].map((item) =>
                  path.basename(item),
                );
                return sourceCandidates.includes(path.basename(page.source));
              })
            : false;
          if (!hasSourceMatch) {
            issues.push({
              type: 'manifest_mismatch',
              file: relPath,
              description: '页面未匹配到对应的 manifest 记录',
            });
          }
        }
      } catch {
        /* skip unreadable */
      }
    }

    // 第三轮：用 WikiSearchTool 批量验证链接有效性
    if (linksToVerify.length > 0) {
      // 去重，只验证每个目标文件一次
      const seen = new Set<string>();
      const uniquePaths: string[] = [];
      const candidatePathsByTarget = new Map<string, string[]>();
      for (const link of linksToVerify) {
        if (candidatePathsByTarget.has(link.target)) continue;
        const candidates = getWikiPathCandidates(link.target);
        candidatePathsByTarget.set(link.target, candidates);
        for (const candidate of candidates) {
          if (!seen.has(candidate)) {
            seen.add(candidate);
            uniquePaths.push(candidate);
          }
        }
      }

      const wsTool = new WikiSearchTool();
      const verifyResult = await wsTool.execute(
        { paths: uniquePaths, maxResults: 1, includeContent: false },
        { conversationId: '' },
      );

      // 收集不存在的文件路径
      const existingPaths = new Set<string>();
      for (const r of verifyResult.results) {
        if (!r.content.startsWith('[文件不存在')) existingPaths.add(r.file);
      }

      // 原路映射回所有引用关系
      for (const link of linksToVerify) {
        const existingPath = candidatePathsByTarget
          .get(link.target)
          ?.find((candidate) => existingPaths.has(candidate));
        if (existingPath) {
          inboundTargets.add(existingPath);
        } else {
          issues.push({
            type: 'broken_link',
            file: link.source,
            description: `断裂链接: "${link.target}" 目标页面不存在`,
          });
        }
      }
    }

    for (const manifestPage of manifestPageSet) {
      if (!pageSet.has(manifestPage)) {
        issues.push({
          type: 'manifest_mismatch',
          file: manifestPage,
          description: 'manifest 记录的页面不存在',
        });
      }
    }

    for (const page of pageSet) {
      if (!indexedPages.has(page)) {
        issues.push({
          type: 'index_drift',
          file: '_index.md',
          description: `页面 "${page}" 未被索引覆盖`,
        });
      }
      if (!indexedPages.has(page) && !inboundTargets.has(page)) {
        issues.push({
          type: 'orphan',
          file: page,
          description: '页面未被索引也未被其他页面引用',
        });
      }
    }

    for (const indexedPage of indexedPages) {
      if (!pageSet.has(indexedPage)) {
        issues.push({
          type: 'index_drift',
          file: '_index.md',
          description: `索引引用了不存在的页面 "${indexedPage}"`,
        });
      }
    }

    // 检查未编译的原始资料
    const compiledSources = new Set<string>();
    for (const filePath of pageFiles) {
      const relPath = path.relative(wikiPath, filePath);
      const content = fs.readFileSync(filePath, 'utf-8');
      const page = parseWikiPage(relPath, content);
      if (page.source) {
        compiledSources.add(path.basename(page.source));
      }
    }
    for (const filePath of sourceFiles) {
      const filename = path.basename(filePath);
      if (filename === '.gitkeep') continue;
      if (!compiledSources.has(filename)) {
        const relPath = path.relative(wikiPath, filePath);
        issues.push({
          type: 'uncompiled_source',
          file: relPath,
          description: `原始资料 "${filename}" 尚未被编译为 Wiki 页面`,
        });
      }
    }

    const normalizedIssues = this.normalizeIssues(issues);
    const brokenCount = normalizedIssues.filter((i) => i.type === 'broken_link').length;
    const frontmatterCount = normalizedIssues.filter(
      (i) => i.type === 'missing_frontmatter',
    ).length;
    const requiredFieldCount = normalizedIssues.filter(
      (i) => i.type === 'missing_required_field',
    ).length;
    const schemaCount = normalizedIssues.filter((i) => i.type === 'schema_mismatch').length;
    const uncompiledCount = normalizedIssues.filter((i) => i.type === 'uncompiled_source').length;
    const orphanCount = normalizedIssues.filter((i) => i.type === 'orphan').length;
    const manifestCount = normalizedIssues.filter(
      (i) => i.type === 'manifest_missing' || i.type === 'manifest_mismatch',
    ).length;
    const indexDriftCount = normalizedIssues.filter((i) => i.type === 'index_drift').length;

    return {
      healthy: normalizedIssues.length === 0,
      directoryTree,
      issues: normalizedIssues,
      totalSourceFiles: sourceFiles.filter((f) => !f.endsWith('.gitkeep')).length,
      totalPages: pageFiles.length,
      summary:
        normalizedIssues.length === 0
          ? `Wiki 健康状态良好（${sourceFiles.length} 个原始资料，${pageFiles.length} 个页面）`
          : `发现 ${normalizedIssues.length} 个问题：` +
            (brokenCount ? brokenCount + ' 个断裂链接, ' : '') +
            (frontmatterCount ? frontmatterCount + ' 个缺少 frontmatter, ' : '') +
            (requiredFieldCount ? requiredFieldCount + ' 个缺少必填字段, ' : '') +
            (schemaCount ? schemaCount + ' 个 Schema 不匹配, ' : '') +
            (manifestCount ? manifestCount + ' 个 manifest 问题, ' : '') +
            (indexDriftCount ? indexDriftCount + ' 个索引漂移, ' : '') +
            (orphanCount ? orphanCount + ' 个孤立页面, ' : '') +
            (uncompiledCount ? uncompiledCount + ' 个未编译资料' : ''),
    };
  }

  private readSchema(wikiPath: string): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(path.join(wikiPath, '_schema.json'), 'utf-8'));
    } catch {
      return {};
    }
  }

  private normalizeIssues(issues: LintIssue[]): LintIssue[] {
    const order: Record<LintIssue['type'], number> = {
      manifest_missing: 0,
      manifest_mismatch: 1,
      missing_frontmatter: 2,
      missing_required_field: 3,
      schema_mismatch: 4,
      broken_link: 5,
      index_drift: 6,
      orphan: 7,
      uncompiled_source: 8,
    };

    const deduped = new Map<string, LintIssue>();
    for (const issue of issues) {
      const formatted: LintIssue = {
        ...issue,
        description: `Wiki 健康检查 / ${issue.file} / ${issue.description}`,
      };
      const dedupeKey = `${formatted.type}|${formatted.file}`;
      if (!deduped.has(dedupeKey)) {
        deduped.set(dedupeKey, formatted);
      }
    }

    return Array.from(deduped.values()).sort(
      (a, b) =>
        order[a.type] - order[b.type] ||
        a.file.localeCompare(b.file) ||
        a.description.localeCompare(b.description),
    );
  }

  private findMdFiles(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) return [];
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
      /* skip */
    }
    return files;
  }

  private readIndexedPages(wikiPath: string): Set<string> {
    const indexPath = path.join(wikiPath, '_index.md');
    if (!fs.existsSync(indexPath)) return new Set();

    const content = fs.readFileSync(indexPath, 'utf-8');
    const linkRegex = /\[[^\]]+\]\((pages\/[^)]+\.md)\)/g;
    const indexedPages = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(content)) !== null) {
      indexedPages.add(match[1].replace(/\\/g, '/'));
    }
    return indexedPages;
  }
}
