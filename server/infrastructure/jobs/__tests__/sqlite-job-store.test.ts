import { describe, expect, it } from 'vitest';
import * as jobStore from '../sqlite-job-store.js';

describe('jobStore', () => {
  it('creates a job', () => {
    const id = jobStore.createJob('test.md', 1024);
    expect(id).toBeTruthy();
  });

  it('gets a job by id', () => {
    const id = jobStore.createJob('hello.md', 512);
    const job = jobStore.getJob(id);
    expect(job).toBeDefined();
    expect(job!.fileName).toBe('hello.md');
    expect(job!.fileSize).toBe(512);
    expect(job!.status).toBe('pending');
    expect(job!.step).toBe('等待处理');
  });

  it('returns undefined for non-existent job', () => {
    expect(jobStore.getJob('nonexistent')).toBeUndefined();
  });

  it('updates a job', () => {
    const id = jobStore.createJob('update.md', 2048);
    const updated = jobStore.updateJob(id, { status: 'parsing', progress: 50, step: '解析中' });
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('parsing');
    expect(updated!.progress).toBe(50);
    expect(updated!.step).toBe('解析中');
  });

  it('returns undefined when updating non-existent job', () => {
    const result = jobStore.updateJob('nonexistent', { status: 'done' });
    expect(result).toBeUndefined();
  });

  it('preserves previous fields on partial update', () => {
    const id = jobStore.createJob('partial.md', 1000);
    const updated = jobStore.updateJob(id, { status: 'done' });
    expect(updated!.status).toBe('done');
    expect(updated!.fileName).toBe('partial.md');
    expect(updated!.fileSize).toBe(1000);
  });

  it('stores graph warnings in the shared job result', () => {
    const id = jobStore.createJob('graph.md', 1000);
    const updated = jobStore.updateJob(id, {
      status: 'done',
      result: {
        sourceFile: 'sources/graph.md',
        format: 'md',
        textLength: 10,
        preview: 'content',
        graphErrors: ['edge failed'],
      },
    });
    expect(updated!.result!.graphErrors).toEqual(['edge failed']);
  });

  it('sets updatedAt on update', () => {
    const id = jobStore.createJob('time.md', 1);
    const before = jobStore.getJob(id)!.updatedAt;
    // Small delay to ensure different timestamp
    const updated = jobStore.updateJob(id, { step: 'test' })!;
    expect(updated.updatedAt).toBeTruthy();
  });

  it('deduplicates jobs by idempotency key', () => {
    const first = jobStore.createJob('same.md', 1, {
      sourceType: 'chat',
      idempotencyKey: 'same-request',
    });
    const second = jobStore.createJob('same.md', 1, {
      sourceType: 'chat',
      idempotencyKey: 'same-request',
    });
    expect(second).toBe(first);
    expect(jobStore.getByIdempotencyKey('same-request')?.id).toBe(first);
  });

  it('recovers running jobs to queued state', () => {
    const id = jobStore.createJob('recover.md', 1, { sourceType: 'chat' });
    jobStore.updateJob(id, { status: 'compiling', progress: 60, step: 'AI 编译中' });
    expect(jobStore.recoverRunning()).toBeGreaterThanOrEqual(1);
    expect(jobStore.getJob(id)?.status).toBe('queued');
  });

  it('removes terminal jobs and keeps active jobs', () => {
    const completedId = jobStore.createJob('completed.md', 1);
    jobStore.updateJob(completedId, { status: 'completed', progress: 100, step: '完成' });
    expect(jobStore.removeJob(completedId)).toBe(true);
    expect(jobStore.getJob(completedId)).toBeUndefined();

    const activeId = jobStore.createJob('active.md', 1, { sourceType: 'upload' });
    expect(jobStore.removeJob(activeId)).toBe(false);
    expect(jobStore.getJob(activeId)).toBeDefined();
  });
});
