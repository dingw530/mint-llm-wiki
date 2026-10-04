import { z } from 'zod';
import { BaseTool } from './BaseTool.js';
import type { ToolContext } from './BaseTool.js';
import { mcpService } from '../../bootstrap/mcp-client.js';

const DiscoverInput = z.object({
  query: z.string().min(1).describe('需要发现的能力描述或关键词'),
  server: z.string().optional().describe('可选的 MCP Server 名称'),
  limit: z.coerce.number().int().min(1).max(20).optional().default(5),
});

export class DiscoverToolsTool extends BaseTool<z.infer<typeof DiscoverInput>, unknown> {
  readonly name = 'discover_tools';
  readonly description =
    '按能力描述搜索可用 MCP 工具。只返回候选目录，不执行工具，也不返回完整 Schema。';
  readonly inputSchema = DiscoverInput;

  isReadOnly(): boolean {
    return true;
  }
  isIdempotent(): boolean {
    return true;
  }
  isConcurrencySafe(): boolean {
    return true;
  }

  async execute(input: z.infer<typeof DiscoverInput>, _context: ToolContext) {
    const query = input.query.toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    const catalog = mcpService.getToolCatalog(input.server ? [input.server] : undefined);
    const scored = catalog
      .map((item) => {
        const text = `${item.name} ${item.description}`.toLowerCase();
        const score = terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
        return { ...item, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit);
    return { query: input.query, results: scored, total: scored.length };
  }
}

const LoadInput = z.object({
  tool: z.string().regex(/^[^_]+__.+$/, '工具名必须为 server__tool 格式'),
});

export class LoadToolTool extends BaseTool<z.infer<typeof LoadInput>, unknown> {
  readonly name = 'load_tool';
  readonly description =
    '按 server__tool 名称加载一个 MCP 工具的完整 Schema，使其可在后续轮次调用。';
  readonly inputSchema = LoadInput;

  isReadOnly(): boolean {
    return true;
  }
  isIdempotent(): boolean {
    return true;
  }

  async execute(input: z.infer<typeof LoadInput>, _context: ToolContext) {
    const definition = mcpService.getToolDefinition(input.tool);
    if (!definition) throw new Error(`MCP 工具不存在或 Server 未连接: ${input.tool}`);
    mcpService.markToolLoaded(input.tool);
    return { loaded: true, tool: definition };
  }
}
