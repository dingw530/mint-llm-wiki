import * as fs from 'fs';
import * as path from 'path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WikiServiceContext } from '../index.js';

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

function buildFileTree(rootDir: string, currentDir: string): FileTreeNode[] {
  const entries: FileTreeNode[] = [];
  const items = fs.readdirSync(currentDir);

  for (const item of items.sort()) {
    const fullPath = path.join(currentDir, item);
    const stat = fs.statSync(fullPath);
    const relativePath = path.relative(rootDir, fullPath);

    if (stat.isDirectory()) {
      const children = buildFileTree(rootDir, fullPath);
      entries.push({ name: item, type: 'directory', path: relativePath, children });
    } else if (
      (item.endsWith('.md') || item === '_schema.json' || item === '_manifest.json' || /\.(html?|txt|pdf)$/i.test(item)) &&
      item !== '.gitkeep'
    ) {
      entries.push({ name: item, type: 'file', path: relativePath });
    }
  }
  return entries;
}

function countFiles(tree: FileTreeNode[]): number {
  let count = 0;
  for (const node of tree) {
    if (node.type === 'file') count++;
    if (node.children) count += countFiles(node.children);
  }
  return count;
}

export function registerListTool(server: McpServer, ctx: WikiServiceContext): void {
  server.registerTool(
    'mint_wiki_list',
    { description: '列出 Wiki 知识库目录树，展示所有页面、分类和系统文件' },
    async () => {
      if (!fs.existsSync(ctx.wikiPath)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ tree: [], total: 0 }) }],
        };
      }

      const tree = buildFileTree(ctx.wikiPath, ctx.wikiPath);
      const total = countFiles(tree);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ tree, total }, null, 2) }],
      };
    },
  );
}
