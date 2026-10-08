import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WikiServiceContext } from '../index.js';
import { isPathSafe } from '../../infrastructure/filesystem/path-security.js';
import { searchWiki } from '../../domains/wiki/index.js';

const SearchInputSchema = {
  question: z.string().optional().describe('搜索关键词或问题（与 paths 二选一）'),
  paths: z.array(z.string()).optional().describe('直接读取指定文件路径列表（与 question 二选一）'),
  maxResults: z.number().optional().default(5).describe('返回 top N 结果，默认 5'),
  includeContent: z.boolean().optional().default(true).describe('是否返回完整文件内容，默认 true'),
};

// ── 搜索逻辑 ──

interface WikiSearchResult {
  file: string;
  content: string;
  score: number;
}

interface WikiSearchOutput {
  results: WikiSearchResult[];
  total: number;
  message: string;
}

function readFiles(wikiPath: string, paths: string[]): WikiSearchOutput {
  const results: WikiSearchResult[] = [];

  for (const filePath of paths) {
    if (!isPathSafe(wikiPath, filePath)) {
      results.push({ file: filePath, content: `[路径不安全: ${filePath}]`, score: 0 });
      continue;
    }

    const resolvedPath = path.resolve(wikiPath, filePath);
    if (!fs.existsSync(resolvedPath)) {
      results.push({ file: filePath, content: `[文件不存在: ${filePath}]`, score: 0 });
      continue;
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(resolvedPath);
      const listing = entries
        .map((e) => {
          const full = path.join(resolvedPath, e);
          const isDir = fs.statSync(full).isDirectory();
          return `${isDir ? '[DIR]' : '[FILE]'} ${e}`;
        })
        .join('\n');
      results.push({ file: filePath, content: listing, score: 1 });
    } else {
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      results.push({ file: filePath, content: content.substring(0, 100000), score: 1 });
    }
  }

  return {
    results,
    total: results.length,
    message: `已读取 ${results.length} 个文件`,
  };
}

export function registerSearchTool(server: McpServer, ctx: WikiServiceContext): void {
  server.registerTool(
    'mint_wiki_search',
    {
      description:
        '搜索并读取 Wiki 知识库。支持 paths 批量读取多个文件，也支持 question 关键词搜索返回匹配页面。' +
        '推荐：知道具体文件时用 paths 一次性读取多个；不确定时用 question 搜索',
      inputSchema: SearchInputSchema,
    },
    async ({ question, paths, maxResults, includeContent }) => {
      const normalizedMaxResults = maxResults ?? 5;
      const normalizedIncludeContent = includeContent ?? true;

      // 路径模式
      if (paths && paths.length > 0) {
        const result = readFiles(ctx.wikiPath, paths);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      }

      if (!question) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'question 或 paths 至少需要提供一个' }),
            },
          ],
          isError: true,
        };
      }

      // 搜索模式
      const result = await searchWiki(
        ctx.wikiPath,
        question,
        normalizedMaxResults,
        normalizedIncludeContent,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}
