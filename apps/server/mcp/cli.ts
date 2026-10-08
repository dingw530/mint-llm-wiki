#!/usr/bin/env node
/**
 * MCP Wiki Server — stdio 模式入口
 * 用于 Claude Code 通过 stdio 直接连接，不依赖 HTTP 端口
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as path from 'path';
import { registerListTool } from './tools/list.js';
import { registerReadTool } from './tools/read.js';
import { registerSearchTool } from './tools/search.js';
import { registerSchemaTool } from './tools/schema.js';
import { registerLintTool } from './tools/lint.js';

async function main() {
  // 从环境变量获取 wiki 路径
  const wikiPath = process.env.WIKI_PATH;
  if (!wikiPath) {
    console.error('错误: 必须设置 WIKI_PATH 环境变量');
    process.exit(1);
  }

  const resolvedPath = path.resolve(wikiPath);

  const server = new McpServer({
    name: 'mint-wiki-server',
    version: '1.0.0',
  });

  registerListTool(server, { wikiPath: resolvedPath });
  registerReadTool(server, { wikiPath: resolvedPath });
  registerSearchTool(server, { wikiPath: resolvedPath });
  registerSchemaTool(server, { wikiPath: resolvedPath });
  registerLintTool(server, { wikiPath: resolvedPath });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP 服务器错误:', err);
  process.exit(1);
});
