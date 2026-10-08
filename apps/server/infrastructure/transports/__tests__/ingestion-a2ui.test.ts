import { describe, expect, it } from 'vitest';
import {
  createSurface,
  toIngestionTaskCardModel,
  updateComponents,
  updateDataModel,
} from '../ingestion-a2ui.js';
import type { WikiJob } from '../../../domains/wiki/index.js';

const job: WikiJob = {
  id: 'job-1',
  status: 'compiling',
  fileName: 'notes.md',
  fileSize: 10,
  progress: 60,
  step: 'AI 编译中',
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:01.000Z',
  fileCount: 1,
};

describe('ingestion A2UI v0.9 messages', () => {
  it('emits official versioned surface and catalog messages', () => {
    expect(createSurface(job)).toEqual({
      version: 'v0.9',
      createSurface: { surfaceId: 'ingestion-task-job-1', catalogId: 'mint' },
    });
    expect(updateComponents(job)).toEqual({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'ingestion-task-job-1',
        components: [{ id: 'root', component: 'IngestionTaskCard', data: { path: '/job' } }],
      },
    });
  });

  it('binds only the display model at /job', () => {
    expect(updateDataModel(job)).toEqual({
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 'ingestion-task-job-1',
        path: '/job',
        value: toIngestionTaskCardModel(job),
      },
    });
  });
});
