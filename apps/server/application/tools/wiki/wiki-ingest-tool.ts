import { z } from 'zod';
import { BaseTool } from '../../../agent-runtime/tooling/base-tool.js';
import type { ToolContext, ToolMetadata } from '../../../agent-runtime/tooling/tool-contracts.js';
import { getWikiPath } from '../../wiki/wiki-path.js';
import * as settingsService from '../../../application/settings/settings-service.js';
import { wikiIngestionJobService } from '../../../application/wiki/wiki-ingestion-job-service.js';

const FileInputSchema = z.object({
  name: z.string().describe('原始文件名（含扩展名）'),
  content: z.string().describe('Base64 编码的文件内容'),
  type: z.string().optional().describe('MIME type'),
});

const WikiIngestInputSchema = z.object({
  source: z
    .string()
    .optional()
    .default('')
    .describe('要摄入的原始资料内容（文本/Markdown），与 urls/files 至少提供一个'),
  title: z.string().optional().describe('原始资料标题'),
  category: z.string().optional().describe('分类目录名'),
  urls: z
    .array(
      z
        .string()
        .url()
        .refine((value) => /^https?:\/\//i.test(value), '仅支持 http/https URL'),
    )
    .optional()
    .describe('要抓取的网页 URL 列表'),
  files: z
    .array(FileInputSchema)
    .optional()
    .describe('要上传的文件列表（Base64 编码），支持 HTML/TXT/MD/PDF'),
  idempotencyKey: z.string().min(1).max(200).optional().describe('客户端重试时复用的幂等键'),
});

type WikiIngestInput = z.infer<typeof WikiIngestInputSchema>;

interface WikiIngestOutput {
  jobId: string;
  status: 'queued';
  executionMode: 'async';
  fileCount: number;
  message: string;
}
/** 将资料受理为后台摄入任务，实际解析和编译由 Wiki 任务 worker 执行。 */
export class WikiIngestTool extends BaseTool<WikiIngestInput, WikiIngestOutput> {
  readonly name = 'wiki_ingest';
  readonly executionMode = 'async' as const;
  readonly executionTimeoutMs = 120000;
  readonly description = `将原始资料加入 Wiki 后台摄入任务。任务会在知识库模块中显示进度。返回字段：{ jobId, status, executionMode, fileCount, message }。`;
  readonly inputSchema = WikiIngestInputSchema;

  isReadOnly(): boolean {
    return false;
  }

  isIdempotent(): boolean {
    return false;
  }

  getMetadata(): ToolMetadata {
    return { ...super.getMetadata(), retrySafety: 'idempotency_key' };
  }

  validate(input: unknown): { valid: boolean; error?: string } {
    const baseValidation = super.validate(input);
    if (!baseValidation.valid || !input || typeof input !== 'object' || Array.isArray(input)) {
      return baseValidation;
    }
    const candidate = input as Partial<WikiIngestInput>;
    const hasSource = typeof candidate.source === 'string' && candidate.source.trim().length > 0;
    const hasUrls = Array.isArray(candidate.urls) && candidate.urls.length > 0;
    const hasFiles = Array.isArray(candidate.files) && candidate.files.length > 0;
    if (!hasSource && !hasUrls && !hasFiles) {
      return { valid: false, error: '请提供 source、urls 或 files' };
    }
    return { valid: true };
  }

  /** 返回工具开始执行时展示给用户的摘要。 */
  getCallSummary(input: WikiIngestInput): string {
    const sources = [
      input.source?.trim() ? '资料' : '',
      input.urls?.length ? `${input.urls.length} 个网页` : '',
      input.files?.length ? `${input.files.length} 个文件` : '',
    ].filter(Boolean);
    return sources.length > 0
      ? `正在加入 Wiki 摄入任务：${sources.join('、')}`
      : '正在加入 Wiki 摄入任务';
  }

  /** 返回异步任务受理摘要。 */
  getResultSummary(result: WikiIngestOutput): string {
    return `${result.message}：${result.fileCount} 个输入`;
  }

  async execute(input: WikiIngestInput, context: ToolContext): Promise<WikiIngestOutput> {
    const wikiPath = getWikiPath();
    if (!wikiPath) throw new Error('Wiki 路径未配置，请在设置中配置 wikiPath');
    const settings = settingsService.getAiSettings();
    if (!settings.apiUrl || !settings.apiKey) throw new Error('AI API 未配置');
    if (!input.source?.trim() && !input.urls?.length && !input.files?.length) {
      throw new Error('请提供 source（原始资料）、urls（网页链接）或 files（文件）');
    }
    return wikiIngestionJobService.startChat(input, context.conversationId);
  }
}
