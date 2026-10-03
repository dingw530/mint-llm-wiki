import type { ParseResult } from '../../services/utils/fileParseService.js';

export type WikiJobStatus =
  | 'pending'
  | 'queued'
  | 'parsing'
  | 'compiling'
  | 'committing'
  | 'done'
  | 'completed'
  | 'partial_failed'
  | 'error'
  | 'failed'
  | 'cancelled';

export type IngestionSourceType = 'upload' | 'chat';

export type WikiCompileStage = 'prepare' | 'evidence' | 'pages';

export interface WikiUploadInput {
  name: string;
  size: number;
  buffer: Buffer;
  idempotencyKey?: string | null;
}

export interface WikiSourceSegment {
  kind: 'url' | 'file';
  name: string;
  content: string;
}

export interface WikiPageSummary {
  filename: string;
  title: string;
  size: number;
  summary?: string;
}

export interface WikiJobResult {
  sourceFile: string;
  format: ParseResult['format'] | 'mixed';
  textLength: number;
  pageCount?: number;
  preview: string;
  pages?: WikiPageSummary[];
  sourceUrls?: string[];
  sourcePreviewKind?: 'text' | 'markdown' | 'html' | 'unsupported';
  graphErrors?: string[];
  failedItems?: Array<{ name: string; error: string }>;
}

export interface WikiJob {
  id: string;
  status: WikiJobStatus;
  fileName: string;
  fileSize: number;
  progress: number;
  step: string;
  result?: WikiJobResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
  sourceType?: IngestionSourceType;
  conversationId?: string | null;
  fileCount?: number;
  attempts?: number;
  idempotencyKey?: string | null;
  statusLabel?: string;
  phase?: 'active' | 'success' | 'error' | 'cancelled';
  isTerminal?: boolean;
  isSuccessful?: boolean;
  canCancel?: boolean;
  canRetry?: boolean;
}

/** 将真实编译阶段转换为易理解的任务状态文案。 */
export function getWikiCompileStageLabel(stage: WikiCompileStage): string {
  const labels: Record<WikiCompileStage, string> = {
    prepare: '正在整理资料',
    evidence: '正在核对原文',
    pages: '正在生成知识页面',
  };
  return labels[stage];
}

export type WikiJobUpdate = Partial<Omit<WikiJob, 'id' | 'createdAt'>>;

export interface WikiJobCreateOptions {
  sourceType?: IngestionSourceType;
  conversationId?: string | null;
  fileCount?: number;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
}

export interface WikiJobListFilter {
  status?: WikiJobStatus;
  limit?: number;
}

export interface WikiJobStartResult {
  jobId: string;
  status: 'queued';
  executionMode: 'async';
  fileCount: number;
  message: string;
}

export interface WikiChatFileInput {
  name: string;
  content: string;
  type?: string;
}

export interface WikiChatIngestionInput {
  source?: string;
  title?: string;
  category?: string;
  urls?: string[];
  files?: WikiChatFileInput[];
  idempotencyKey?: string | null;
}

export interface WikiUploadStartResult {
  jobId: string;
  sourceFile: string;
  fileName: string;
  fileSize: number;
}
