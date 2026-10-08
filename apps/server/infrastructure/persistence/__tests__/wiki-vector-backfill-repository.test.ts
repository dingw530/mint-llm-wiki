import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../db.js';
import * as repository from '../wiki-vector-backfill-repository.js';

const jobIds: string[] = [];

describe('wikiVectorBackfillRepository', () => {
  afterEach(() => {
    const db = getDb();
    for (const id of jobIds.splice(0))
      db.prepare('DELETE FROM wiki_vector_backfill_jobs WHERE id = ?').run(id);
  });

  it('persists scope, progress counters and retryable status', () => {
    const job = repository.createJob('selected', null, ['pages/a.md']);
    jobIds.push(job.id);
    expect(job).toMatchObject({ scope: 'selected', paths: ['pages/a.md'], status: 'queued' });

    const updated = repository.updateJob(job.id, {
      status: 'partial_failed',
      total: 3,
      processed: 3,
      indexed: 2,
      skipped: 0,
      failed: 1,
      currentPath: null,
      error: '部分文档向量化失败',
      attempts: 1,
    });
    expect(updated).toMatchObject({
      total: 3,
      processed: 3,
      indexed: 2,
      failed: 1,
      status: 'partial_failed',
    });
    expect(repository.getRequiredJob(job.id).error).toContain('部分文档');
  });
});
