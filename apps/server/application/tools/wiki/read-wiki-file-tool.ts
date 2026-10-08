import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { BaseTool } from '../../../agent-runtime/tooling/base-tool.js';
import type { ToolContext } from '../../../agent-runtime/tooling/tool-contracts.js';
import { isPathSafe } from '../../../infrastructure/filesystem/path-security.js';
import { getWikiPath } from '../../wiki/wiki-path.js';

const ReadFileInputSchema = z.object({
  path: z.string().min(1).describe('文件路径（相对 wiki 根目录）'),
});

type ReadFileInput = z.infer<typeof ReadFileInputSchema>;

interface ReadFileOutput {
  content: string;
  path: string;
}

export class ReadFileTool extends BaseTool<ReadFileInput, ReadFileOutput> {
  readonly name = 'read_file';
  readonly description =
    '读取 Wiki 知识库中的文件内容。路径相对于 Wiki 根目录。也支持列出目录内容（当 path 指向目录时）。';
  readonly inputSchema = ReadFileInputSchema;

  isReadOnly(): boolean {
    return true;
  }

  isConcurrencySafe(): boolean {
    return true;
  }

  async execute(input: ReadFileInput, _context: ToolContext): Promise<ReadFileOutput> {
    const wikiPath = getWikiPath();
    if (!wikiPath) {
      throw new Error('Wiki 路径未配置，请在设置中配置 wikiPath');
    }

    if (!isPathSafe(wikiPath, input.path)) {
      throw new Error(`路径穿越被拒绝: ${input.path}`);
    }

    const resolvedPath = path.resolve(wikiPath, input.path);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`文件不存在: ${input.path}`);
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(resolvedPath);
      return {
        content: entries
          .map((e) => {
            const fullPath = path.join(resolvedPath, e);
            const isDir = fs.statSync(fullPath).isDirectory();
            return `${isDir ? '[DIR]' : '[FILE]'} ${e}`;
          })
          .join('\n'),
        path: input.path,
      };
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');
    return { content, path: input.path };
  }
}
