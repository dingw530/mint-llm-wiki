import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { BaseTool } from './BaseTool.js';
import type { ToolContext } from './BaseTool.js';
import { isPathSafe, getWikiPath } from '../utils/pathSecurity.js';

const WriteFileInputSchema = z.object({
  path: z.string().min(1).describe('文件路径（相对 wiki 根目录）'),
  content: z.string().describe('要写入的文件内容'),
});

type WriteFileInput = z.infer<typeof WriteFileInputSchema>;

interface WriteFileOutput {
  path: string;
  size: number;
}

export class WriteFileTool extends BaseTool<WriteFileInput, WriteFileOutput> {
  readonly name = 'write_file';
  readonly description = `当用户要求写入文件到知识库时调用此工具。请求写入文件到 Wiki 知识库。调用本工具会先触发审批，未获得用户批准不会执行写入`;
  readonly inputSchema = WriteFileInputSchema;

  isReadOnly(): boolean {
    return false;
  }

  isIdempotent(): boolean {
    return true;
  }

  async execute(input: WriteFileInput, _context: ToolContext): Promise<WriteFileOutput> {
    const wikiPath = getWikiPath();
    if (!wikiPath) {
      throw new Error('Wiki 路径未配置，请在设置中配置 wikiPath');
    }

    if (!isPathSafe(wikiPath, input.path)) {
      throw new Error(`路径穿越被拒绝: ${input.path}`);
    }

    const resolvedPath = path.resolve(wikiPath, input.path);

    // 自动创建子目录
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolvedPath, input.content, 'utf-8');
    const stat = fs.statSync(resolvedPath);

    return {
      path: input.path,
      size: stat.size,
    };
  }
}
