import type { WikiJob } from '../../domains/wiki/index.js';

export interface IngestionTaskCardModel {
  jobId: string;
  title: string;
  status: string;
  statusLabel: string;
  progress: number;
  step: string;
  fileCount: number;
  canRetry?: boolean;
  result: { sourceFile?: string; error?: string; pageCount?: number; hasWarnings?: boolean } | null;
}

export type A2uiEnvelope =
  | { version: 'v0.9'; createSurface: { surfaceId: string; catalogId: string } }
  | {
      version: 'v0.9';
      updateComponents: {
        surfaceId: string;
        components: Array<{ id: string; component: string; data: { path: string } }>;
      };
    }
  | {
      version: 'v0.9';
      updateDataModel: { surfaceId: string; path: string; value: IngestionTaskCardModel };
    }
  | { version: 'v0.9'; deleteSurface: { surfaceId: string } };

export function surfaceIdForJob(jobId: string): string {
  return `ingestion-task-${jobId}`;
}

/** 将内部任务转换为 A2UI 卡片允许展示的最小数据模型。 */
export function toIngestionTaskCardModel(job: WikiJob): IngestionTaskCardModel {
  return {
    jobId: job.id,
    title: job.fileName,
    status: job.status,
    statusLabel: job.statusLabel || '处理中',
    progress: job.progress,
    step: job.step,
    fileCount: job.fileCount || 1,
    canRetry: job.canRetry,
    result: job.error
      ? { error: job.error }
      : job.result
        ? {
            sourceFile: job.result.sourceFile,
            pageCount: job.result.pages?.length || 0,
            hasWarnings: Boolean(job.result.graphErrors?.length || job.result.failedItems?.length),
          }
        : null,
  };
}

export function createSurface(job: WikiJob): A2uiEnvelope {
  return {
    version: 'v0.9',
    createSurface: { surfaceId: surfaceIdForJob(job.id), catalogId: 'mint' },
  };
}

export function updateComponents(job: WikiJob): A2uiEnvelope {
  return {
    version: 'v0.9',
    updateComponents: {
      surfaceId: surfaceIdForJob(job.id),
      components: [{ id: 'root', component: 'IngestionTaskCard', data: { path: '/job' } }],
    },
  };
}

export function updateDataModel(job: WikiJob): A2uiEnvelope {
  return {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: surfaceIdForJob(job.id),
      path: '/job',
      value: toIngestionTaskCardModel(job),
    },
  };
}
