import { describe, expect, it } from 'vitest';
import * as commitRepository from '../wikiIngestionCommitRepository.js';
import * as jobStore from '../../services/jobs/adapters/sqliteJobStore.js';

describe('wikiIngestionCommitRepository', () => {
  it('keeps one stable commit identity for a job item', () => {
    const jobId = jobStore.createJob('source.md', 10, {
      sourceType: 'upload',
      payload: { sourceFile: 'ingestion-pending/source.md' },
    });
    const input = {
      jobId,
      itemKey: 'upload',
      wikiPath: '/tmp/wiki',
      stagedSourcePath: 'ingestion-pending/source.md',
      sourcePath: 'sources/source.md',
    };

    const first = commitRepository.createOrGetWikiIngestionCommit(input);
    const second = commitRepository.createOrGetWikiIngestionCommit(input);

    expect(second.commitId).toBe(first.commitId);
    expect(second.phase).toBe('compiling');
  });

  it('persists the compiler snapshot once and advances checkpoints monotonically', () => {
    const jobId = jobStore.createJob('snapshot.md', 10, {
      sourceType: 'upload',
      payload: { sourceFile: 'ingestion-pending/snapshot.md' },
    });
    const commit = commitRepository.createOrGetWikiIngestionCommit({
      jobId,
      itemKey: 'upload',
      wikiPath: '/tmp/wiki',
      stagedSourcePath: 'ingestion-pending/snapshot.md',
      sourcePath: 'sources/snapshot.md',
    });

    commitRepository.saveWikiIngestionSnapshot(commit.commitId, { pages: ['first'] });
    commitRepository.saveWikiIngestionSnapshot(commit.commitId, { pages: ['replacement'] });
    const committed = commitRepository.advanceWikiIngestionCommit(
      commit.commitId,
      'pages_written',
      { result: { pageCount: 1 } },
    );
    const stale = commitRepository.advanceWikiIngestionCommit(commit.commitId, 'prepared');

    expect(committed.snapshot).toEqual({ pages: ['first'] });
    expect(stale.phase).toBe('pages_written');
    expect(stale.result).toEqual({ pageCount: 1 });
  });

  it('rejects reuse when a job item is presented with different staged input', () => {
    const jobId = jobStore.createJob('mismatch.md', 10, {
      sourceType: 'upload',
      payload: { sourceFile: 'ingestion-pending/mismatch.md' },
    });
    commitRepository.createOrGetWikiIngestionCommit({
      jobId,
      itemKey: 'upload',
      wikiPath: '/tmp/wiki',
      stagedSourcePath: 'ingestion-pending/mismatch.md',
      sourcePath: 'sources/mismatch.md',
    });

    expect(() =>
      commitRepository.createOrGetWikiIngestionCommit({
        jobId,
        itemKey: 'upload',
        wikiPath: '/tmp/wiki',
        stagedSourcePath: 'ingestion-pending/other.md',
        sourcePath: 'sources/mismatch.md',
      }),
    ).toThrow('Wiki 摄入提交记录与当前作业输入不匹配');
  });
});
