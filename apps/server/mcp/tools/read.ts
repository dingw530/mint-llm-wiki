import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WikiServiceContext } from '../index.js';

const ReadInputSchema = {
  path: z.string().describe('相对于 Wiki 根目录的文件路径，如 "pages/category/page.md"'),
  maxLength: z.number().optional().default(100000).describe('最大返回字符数，默认 100000'),
};

function isPathSafe(root: string, target: string): boolean {
  if (!root || !target) return false;
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, target);
  return resolvedTarget.startsWith(resolvedRoot + path.sep) || resolvedTarget === resolvedRoot;
}

export function registerReadTool(server: McpServer, ctx: WikiServiceContext): void {
  server.registerTool(
    'mint_wiki_read',
    {
      description: '按文件路径读取单个 Wiki 页面的完整内容（含 YAML frontmatter）。返回文件内容、路径、文件名、大小和截断标志',
      inputSchema: ReadInputSchema,
    },
    async ({ path: filePath, maxLength }) => {
      if (!filePath) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: '缺少 path 参数' }) }],
          isError: true,
        };
      }

      if (!isPathSafe(ctx.wikiPath, filePath)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: '路径穿越被拒绝' }) }],
          isError: true,
        };
      }

      const resolvedPath = path.resolve(ctx.wikiPath, filePath);
      if (!fs.existsSync(resolvedPath)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `文件不存在: ${filePath}` }) }],
          isError: true,
        };
      }

      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `路径是目录: ${filePath}` }) }],
          isError: true,
        };
      }

      const maxLen = maxLength ?? 100000;
      let content = fs.readFileSync(resolvedPath, 'utf-8');
      const truncated = content.length > maxLen;
      if (truncated) {
        content = content.substring(0, maxLen) + '\n\n...（已截断，原大小 ' + content.length + ' 字符）';
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              content,
              path: filePath,
              name: path.basename(filePath),
              size: stat.size,
              truncated,
            }),
          },
        ],
      };
    },
  );
}
