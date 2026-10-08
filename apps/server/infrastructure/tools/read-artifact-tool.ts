import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { BaseTool } from '../../agent-runtime/tooling/base-tool.js';
import type { ToolContext } from '../../agent-runtime/tooling/tool-contracts.js';
import { getArtifactRoot } from './tool-result-artifact.js';

const ReadArtifactInputSchema = z.object({
  path: z.string().min(1).describe('artifact 的绝对路径'),
  offset: z.coerce.number().int().min(0).optional().default(0).describe('字符偏移量，默认 0'),
  max_chars: z.coerce
    .number()
    .int()
    .min(1)
    .max(30_000)
    .optional()
    .default(12_000)
    .describe('最多读取的字符数，默认 12000'),
});

type ReadArtifactInput = z.infer<typeof ReadArtifactInputSchema>;

interface ReadArtifactOutput {
  path: string;
  content: string;
  offset: number;
  totalChars: number;
  truncated: boolean;
  sha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 读取上下文 artifact，严格限制在 Mint artifact 根目录内。
 * @param input artifact 路径及分页参数
 * @param _context 工具执行上下文
 * @returns artifact 内容片段及完整性信息
 */
export class ReadArtifactTool extends BaseTool<ReadArtifactInput, ReadArtifactOutput> {
  readonly name = 'read_artifact';
  readonly description =
    '读取大工具结果保存的 artifact。只能读取 Mint context-artifacts 目录内的 JSON 文件，支持 offset 和 max_chars 分页。';
  readonly inputSchema = ReadArtifactInputSchema;

  isReadOnly(): boolean {
    return true;
  }

  isIdempotent(): boolean {
    return true;
  }

  isConcurrencySafe(): boolean {
    return true;
  }

  getCallSummary(input: ReadArtifactInput): string {
    return `读取 artifact：${path.basename(input.path)}`;
  }

  getResultSummary(result: ReadArtifactOutput): string {
    if (!isRecord(result) || typeof result.content !== 'string') {
      return '已读取 artifact（结果格式异常）';
    }

    const offset =
      typeof result.offset === 'number' && Number.isFinite(result.offset) ? result.offset : 0;
    const totalChars =
      typeof result.totalChars === 'number' && Number.isFinite(result.totalChars)
        ? result.totalChars
        : offset + result.content.length;
    return `已读取 artifact ${offset}-${offset + result.content.length}/${totalChars}`;
  }

  async execute(input: ReadArtifactInput, _context: ToolContext): Promise<ReadArtifactOutput> {
    const artifactRoot = await realpath(getArtifactRoot());
    const requestedPath = path.resolve(input.path);
    const resolvedPath = await realpath(requestedPath).catch(() => '');

    if (
      !resolvedPath ||
      !resolvedPath.startsWith(`${artifactRoot}${path.sep}`) ||
      path.extname(resolvedPath).toLowerCase() !== '.json'
    ) {
      throw new Error(`artifact 路径不安全或不存在: ${input.path}`);
    }

    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) {
      throw new Error(`artifact 不是文件: ${input.path}`);
    }

    const content = await readFile(resolvedPath, 'utf8');
    const offset = Math.min(input.offset, content.length);
    const end = Math.min(content.length, offset + input.max_chars);
    const slice = content.slice(offset, end);

    return {
      path: resolvedPath,
      content: slice,
      offset,
      totalChars: content.length,
      truncated: end < content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  }
}
