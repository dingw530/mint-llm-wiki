import * as fs from 'fs';
import * as path from 'path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WikiServiceContext } from '../index.js';
import {
  parseWikiFrontmatter,
  parseWikiPage,
  readWikiManifest,
} from '../../infrastructure/filesystem/wiki-content.js';
import {
  getWikiPathCandidates,
  resolveWikiMarkdownLink,
} from '../../infrastructure/filesystem/wiki-link-protocol.js';

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

const ISSUE_ORDER: Record<LintIssue['type'], number> = {
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

function findMdFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...findMdFiles(fullPath));
      } else if (entry.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  } catch {
    // skip
  }
  return files;
}

function readSchema(wikiPath: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(path.join(wikiPath, '_schema.json'), 'utf-8'));
  } catch {
    return {};
  }
}

function readIndexedPages(wikiPath: string): Set<string> {
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

function normalizeIssues(issues: LintIssue[]): LintIssue[] {
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
      ISSUE_ORDER[a.type] - ISSUE_ORDER[b.type] ||
      a.file.localeCompare(b.file) ||
      a.description.localeCompare(b.description),
  );
}

export function registerLintTool(server: McpServer, ctx: WikiServiceContext): void {
  server.registerTool(
    'mint_wiki_lint',
    {
      description:
        '检查 Wiki 知识库的健康状况。检查项：frontmatter 完整性、Schema 标签合规性、断裂链接、孤立页面、manifest 一致性、索引漂移、未编译原始资料',
    },
    async () => {
      const issues: LintIssue[] = [];

      // 读取 Schema 和 Manifest
      const schema = readSchema(ctx.wikiPath);
      const validTags = new Set<string>((schema.tags as string[]) || []);
      const manifest = readWikiManifest(ctx.wikiPath);
      const manifestPath = path.join(ctx.wikiPath, '_manifest.json');
      if (!fs.existsSync(manifestPath)) {
        issues.push({
          type: 'manifest_missing',
          file: '_manifest.json',
          description: 'manifest 文件不存在',
        });
      }

      // 扫描 sources/ 和 pages/
      const sourcesDir = path.join(ctx.wikiPath, 'sources');
      const pagesDir = path.join(ctx.wikiPath, 'pages');

      const sourceFiles = findMdFiles(sourcesDir);
      const pageFiles = findMdFiles(pagesDir);

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

      // 检查页面元数据 + 提取内部链接
      const linksToVerify: Array<{ source: string; target: string }> = [];
      const inboundTargets = new Set<string>();
      const indexedPages = readIndexedPages(ctx.wikiPath);
      const pageSet = new Set<string>();
      const manifestPageSet = new Set<string>();

      for (const entry of manifest.entries) {
        for (const pageFile of entry.pageFiles) {
          manifestPageSet.add(pageFile.replace(/\\/g, '/'));
        }
      }

      for (const filePath of pageFiles) {
        const relPath = path.relative(ctx.wikiPath, filePath);
        const normalizedRelPath = relPath.replace(/\\/g, '/');
        pageSet.add(normalizedRelPath);

        try {
          const content = fs.readFileSync(filePath, 'utf-8');

          // 检查 frontmatter
          if (!content.startsWith('---')) {
            issues.push({
              type: 'missing_frontmatter',
              file: normalizedRelPath,
              description: '缺少 YAML frontmatter',
            });
          } else {
            const frontmatter = parseWikiFrontmatter(content);
            if (frontmatter) {
              const tags: string[] = (frontmatter.tags as string[]) || [];
              for (const field of ['title', 'created', 'source'] as const) {
                if (
                  !frontmatter[field] ||
                  typeof frontmatter[field] !== 'string' ||
                  !(frontmatter[field] as string).trim()
                ) {
                  issues.push({
                    type: 'missing_required_field',
                    file: normalizedRelPath,
                    description: `frontmatter 缺少必填字段 "${field}"`,
                  });
                }
              }
              if (validTags.size > 0) {
                for (const tag of tags) {
                  if (!validTags.has(tag)) {
                    issues.push({
                      type: 'schema_mismatch',
                      file: normalizedRelPath,
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
            const resolved = resolveWikiMarkdownLink(normalizedRelPath, rawTarget);
            if (!resolved || !resolved.path.startsWith('pages/')) continue;
            linksToVerify.push({ source: normalizedRelPath, target: resolved.path });
          }

          // Manifest 一致性检查
          const parsed = parseWikiPage(normalizedRelPath, content);
          const entryByPageFile = manifest.entries.find((entry) =>
            entry.pageFiles.map((item) => item.replace(/\\/g, '/')).includes(parsed.file),
          );
          if (entryByPageFile) {
            const hasNoSource =
              !entryByPageFile.sourceFile && entryByPageFile.archivedFiles.length === 0;
            if (!hasNoSource) {
              const sourceCandidates = [
                entryByPageFile.sourceFile,
                ...entryByPageFile.archivedFiles,
              ].map((item) => path.basename(item));
              if (!parsed.source || !sourceCandidates.includes(path.basename(parsed.source))) {
                issues.push({
                  type: 'manifest_mismatch',
                  file: normalizedRelPath,
                  description: '页面 source 未匹配到 manifest 记录',
                });
              }
            }
          } else {
            const hasSourceMatch = parsed.source
              ? manifest.entries.some((entry) => {
                  const sourceCandidates = [entry.sourceFile, ...entry.archivedFiles].map((item) =>
                    path.basename(item),
                  );
                  return sourceCandidates.includes(path.basename(parsed.source!));
                })
              : false;
            if (!hasSourceMatch) {
              issues.push({
                type: 'manifest_mismatch',
                file: normalizedRelPath,
                description: '页面未匹配到对应的 manifest 记录',
              });
            }
          }
        } catch {
          // skip unreadable
        }
      }

      // 验证断裂链接
      if (linksToVerify.length > 0) {
        const seen = new Set<string>();
        const uniquePaths: string[] = [];
        for (const link of linksToVerify) {
          if (!seen.has(link.target)) {
            seen.add(link.target);
            uniquePaths.push(link.target);
          }
        }

        for (const candidatePath of uniquePaths) {
          const existingPath = getWikiPathCandidates(candidatePath).find((candidate) =>
            fs.existsSync(path.resolve(ctx.wikiPath, candidate)),
          );
          if (existingPath) {
            inboundTargets.add(existingPath);
          } else {
            linksToVerify
              .filter((l) => l.target === candidatePath)
              .forEach((l) => {
                issues.push({
                  type: 'broken_link',
                  file: l.source,
                  description: `断裂链接: "${candidatePath}" 目标页面不存在`,
                });
              });
          }
        }
      }

      // Manifest 页面存在性检查
      for (const manifestPage of manifestPageSet) {
        if (!pageSet.has(manifestPage)) {
          issues.push({
            type: 'manifest_mismatch',
            file: manifestPage,
            description: 'manifest 记录的页面不存在',
          });
        }
      }

      // 索引漂移 + 孤立页面
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

      // 未编译原始资料
      const compiledSources = new Set<string>();
      for (const filePath of pageFiles) {
        const relPath = path.relative(ctx.wikiPath, filePath);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const page = parseWikiPage(relPath, content);
          if (page.source) {
            compiledSources.add(path.basename(page.source));
          }
        } catch {
          // skip
        }
      }
      for (const filePath of sourceFiles) {
        const filename = path.basename(filePath);
        if (filename === '.gitkeep') continue;
        if (!compiledSources.has(filename)) {
          const relPath = path.relative(ctx.wikiPath, filePath);
          issues.push({
            type: 'uncompiled_source',
            file: relPath,
            description: `原始资料 "${filename}" 尚未被编译为 Wiki 页面`,
          });
        }
      }

      const normalizedIssues = normalizeIssues(issues);
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

      const summary =
        normalizedIssues.length === 0
          ? `Wiki 健康状态良好（${sourceFiles.length} 个原始资料，${pageFiles.length} 个页面）`
          : `发现 ${normalizedIssues.length} 个问题：` +
            (brokenCount ? `${brokenCount} 个断裂链接, ` : '') +
            (frontmatterCount ? `${frontmatterCount} 个缺少 frontmatter, ` : '') +
            (requiredFieldCount ? `${requiredFieldCount} 个缺少必填字段, ` : '') +
            (schemaCount ? `${schemaCount} 个 Schema 不匹配, ` : '') +
            (manifestCount ? `${manifestCount} 个 manifest 问题, ` : '') +
            (indexDriftCount ? `${indexDriftCount} 个索引漂移, ` : '') +
            (orphanCount ? `${orphanCount} 个孤立页面, ` : '') +
            (uncompiledCount ? `${uncompiledCount} 个未编译资料` : '');

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              healthy: normalizedIssues.length === 0,
              directoryTree,
              issues: normalizedIssues,
              totalSourceFiles: sourceFiles.filter((f) => !f.endsWith('.gitkeep')).length,
              totalPages: pageFiles.length,
              summary,
            }),
          },
        ],
      };
    },
  );
}
