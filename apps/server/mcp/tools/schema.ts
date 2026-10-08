import * as fs from 'fs';
import * as path from 'path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WikiServiceContext } from '../index.js';

export function registerSchemaTool(server: McpServer, ctx: WikiServiceContext): void {
  server.registerTool(
    'mint_wiki_schema',
    { description: '获取 Wiki 知识库架构，包括可用分类（categories）和标签（tags）' },
    async () => {
      const schemaPath = path.join(ctx.wikiPath, '_schema.json');
      if (!fs.existsSync(schemaPath)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ categories: [], tags: [] }) }],
        };
      }

      try {
        const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                categories: schema.categories ?? [],
                tags: schema.tags ?? [],
                version: schema.version ?? 1,
                description: schema.description ?? '',
              }),
            },
          ],
        };
      } catch {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ categories: [], tags: [] }) }],
        };
      }
    },
  );
}
