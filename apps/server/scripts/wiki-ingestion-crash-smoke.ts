import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompiledPage } from '../infrastructure/filesystem/wiki-content.js';
import type { WikiCompiledClaim } from '../domains/wiki/index.js';
import type { AiSettings } from '../types.js';

const scriptPath = fileURLToPath(import.meta.url);
const crashExitCode = 86;

async function runWorker(mode: string, commitId: string): Promise<void> {
  const { resumeWikiIngestionCommit } = await import('../domains/wiki/index.js');
  if (mode === 'recover-worker') {
    const [{ createWikiIngestionJobService }, jobStore] = await Promise.all([
      import('../application/wiki/wiki-ingestion-job-service.js'),
      import('../infrastructure/jobs/job-store.js'),
    ]);
    let worker: ((jobId: string) => Promise<void>) | undefined;
    let resolveWorker: (() => void) | undefined;
    const completion = new Promise<void>((resolve) => {
      resolveWorker = resolve;
    });
    const queue = {
      start: (handler: (jobId: string) => Promise<void>) => {
        worker = handler;
      },
      enqueue: (jobId: string) => {
        if (jobId !== 'startup' || !worker) return;
        setImmediate(() => {
          void worker?.(jobId).then(
            () => resolveWorker?.(),
            (error: unknown) => {
              process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
              process.exitCode = 1;
              resolveWorker?.();
            },
          );
        });
      },
      stop: async () => undefined,
    };
    const settings = {
      wikiPath: process.env.WIKI_SMOKE_PATH,
      wikiSearchMode: 'keyword',
      wikiMaxFileSize: 1_000_000,
    } as AiSettings;
    const service = createWikiIngestionJobService({
      queue,
      store: jobStore.sqliteJobStore,
      getAiSettings: () => settings,
      readArchivedWikiFile: (wikiPath, relativePath) =>
        fs.readFileSync(path.join(wikiPath, relativePath)),
      parseFile: async ({ name, content }) => ({
        text: content.toString('utf8'),
        format: 'md',
        originalName: name,
      }),
    });
    service.startWorker();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      completion,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('启动恢复 worker 超时')), 10_000);
        timeout.unref();
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    const job = service.getStatus(commitId);
    if (job?.status !== 'completed') {
      throw new Error(`恢复 worker 未完成作业: ${job?.status || 'missing'} ${job?.error || ''}`);
    }
    await service.shutdownWorker();
    return;
  }
  await resumeWikiIngestionCommit(process.env.WIKI_SMOKE_PATH || '', commitId, {
    onCheckpoint: (checkpoint) => {
      if (mode === 'crash' && checkpoint === 'after-lifecycle-register-before-checkpoint') {
        process.exit(crashExitCode);
      }
    },
  });
  if (mode === 'commit-only-exit') process.exit(87);
}

function runChild(mode: string, commitId: string): { status: number; output: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', scriptPath, mode, commitId], {
    env: process.env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`恢复子进程被信号终止: ${result.signal}`);
  if (result.status === null) throw new Error('恢复子进程没有退出码');
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

async function runSmoke(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-ingestion-crash-'));
  const dbPath = path.join(root, 'mint.db');
  const wikiPath = path.join(root, 'wiki');
  fs.mkdirSync(path.join(wikiPath, 'ingestion-pending'), { recursive: true });
  fs.mkdirSync(path.join(wikiPath, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(wikiPath, 'sources'), { recursive: true });
  const items = [
    { key: 'chat-item-0', name: 'first.md', text: 'First evidence excerpt.' },
    { key: 'chat-item-1', name: 'second.md', text: 'Second evidence excerpt.' },
  ].map((item, index) => ({
    ...item,
    stagedPath: `ingestion-pending/${index + 1}-${item.name}`,
    sourcePath: `sources/${index + 1}-${item.name}`,
    page: {
      filename: `pages/p0/${index + 1}-${item.name}`,
      title: `Crash Recovery ${index + 1}`,
      tags: ['p0'],
      content: `# Crash Recovery ${index + 1}\n\n${item.text}`,
    } satisfies CompiledPage,
    claim: {
      pageTitle: `Crash Recovery ${index + 1}`,
      text: item.text,
      normalizedKey: item.text.toLowerCase(),
      confidence: 0.9,
      importance: 0.8,
      evidence: item.text,
    } satisfies WikiCompiledClaim,
  }));
  items.forEach((item) => fs.writeFileSync(path.join(wikiPath, item.stagedPath), `${item.text}\n`));
  process.env.AI_CHAT_DB_PATH = dbPath;
  process.env.WIKI_SMOKE_PATH = wikiPath;

  const [{ closeDb, getDb }, commitRepository, jobStore] = await Promise.all([
    import('../db.js'),
    import('../infrastructure/persistence/wiki-ingestion-commit-repository.js'),
    import('../infrastructure/jobs/sqlite-job-store.js'),
  ]);

  const jobId = jobStore.createJob('P0 Chat crash recovery', 48, {
    sourceType: 'chat',
    fileCount: items.length,
    payload: {
      files: items.map((item) => ({ name: item.name, existingRelativePath: item.stagedPath })),
    },
  });
  const commits = items.map((item) =>
    commitRepository.createOrGetWikiIngestionCommit({
      jobId,
      itemKey: item.key,
      wikiPath,
      stagedSourcePath: item.stagedPath,
      sourcePath: item.sourcePath,
    }),
  );
  commits.forEach((commit, index) => {
    const item = items[index];
    const pageSummary = {
      filename: item.page.filename,
      title: item.page.title,
      size: Buffer.byteLength(item.page.content),
      summary: item.text,
    };
    commitRepository.saveWikiIngestionSnapshot(commit.commitId, {
      sourceText: item.text,
      sourceFile: item.stagedPath,
      archivedFiles: [item.stagedPath],
      stagedFiles: [item.stagedPath],
      compileResult: {
        pages: [pageSummary],
        compiledPages: [item.page],
        relationships: [],
        claims: [item.claim],
        summary: `P0 crash recovery item ${index + 1}`,
      },
    });
  });
  jobStore.updateJob(jobId, { status: 'committing', progress: 90, step: '模拟进程崩溃' });
  closeDb();

  const crash = runChild('crash', commits[0].commitId);
  if (crash.status !== crashExitCode) {
    throw new Error(`预期子进程退出码 ${crashExitCode}，实际为 ${crash.status}: ${crash.output}`);
  }
  const committedBeforeJobExit = runChild('commit-only-exit', commits[0].commitId);
  if (committedBeforeJobExit.status !== 87) {
    throw new Error(
      `预期提交后进程退出码 87，实际为 ${committedBeforeJobExit.status}: ${committedBeforeJobExit.output}`,
    );
  }
  if (!fs.existsSync(path.join(wikiPath, items[0].stagedPath))) {
    throw new Error('父作业完成前错误清理了已提交 Chat item 的暂存输入');
  }

  const resume = runChild('recover-worker', jobId);
  if (resume.status !== 0)
    throw new Error(`恢复子进程退出码异常: ${resume.status}: ${resume.output}`);
  const db = getDb();
  const pagePaths = items.map((item) => item.page.filename);
  const sourcePaths = items.map((item) => item.sourcePath);
  const claimTexts = items.map((item) => item.claim.text);
  const placeholders = items.map(() => '?').join(', ');
  const manifest = JSON.parse(fs.readFileSync(path.join(wikiPath, '_manifest.json'), 'utf8'));
  const commitIds = commits.map((commit) => commit.commitId);
  const readCounts = () => ({
    sources: (
      db
        .prepare(`SELECT COUNT(*) AS count FROM wiki_sources WHERE path IN (${placeholders})`)
        .get(...sourcePaths) as {
        count: number;
      }
    ).count,
    pages: (
      db
        .prepare(`SELECT COUNT(*) AS count FROM wiki_pages WHERE path IN (${placeholders})`)
        .get(...pagePaths) as { count: number }
    ).count,
    claims: (
      db
        .prepare(`SELECT COUNT(*) AS count FROM wiki_claims WHERE claim_text IN (${placeholders})`)
        .get(...claimTexts) as {
        count: number;
      }
    ).count,
    minClaimSupport: (
      db
        .prepare(
          `SELECT MIN(support_count) AS count FROM wiki_claims WHERE claim_text IN (${placeholders})`,
        )
        .get(...claimTexts) as {
        count: number;
      }
    ).count,
    events: (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM wiki_knowledge_events WHERE source_page IN (${placeholders})`,
        )
        .get(...pagePaths) as { count: number }
    ).count,
    searchDocuments: (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM wiki_search_documents WHERE source_path IN (${placeholders})`,
        )
        .get(...pagePaths) as { count: number }
    ).count,
    manifestEntries: manifest.entries.filter((entry: { id: string }) =>
      commitIds.includes(entry.id),
    ).length,
    stagedFiles: fs.readdirSync(path.join(wikiPath, 'ingestion-pending')).length,
  });
  const beforeReplayCounts = readCounts();
  for (const commit of commits) {
    const replay = runChild('resume', commit.commitId);
    if (replay.status !== 0)
      throw new Error(`重复恢复子进程退出码异常: ${replay.status}: ${replay.output}`);
  }
  const counts = readCounts();
  const storedCommits = commits.map((commit) =>
    commitRepository.getWikiIngestionCommitById(commit.commitId),
  );
  const expectedPagesExist = items.every((item) =>
    fs.existsSync(path.join(wikiPath, item.page.filename)),
  );
  const expectedSourcesExist = items.every((item) =>
    fs.existsSync(path.join(wikiPath, item.sourcePath)),
  );
  if (
    storedCommits.some((commit) => commit?.phase !== 'committed') ||
    !expectedPagesExist ||
    !expectedSourcesExist ||
    counts.sources !== items.length ||
    counts.pages !== items.length ||
    counts.claims !== items.length ||
    counts.minClaimSupport !== 1 ||
    counts.events < items.length ||
    counts.searchDocuments < items.length ||
    counts.manifestEntries !== items.length ||
    counts.stagedFiles !== 0 ||
    JSON.stringify(counts) !== JSON.stringify(beforeReplayCounts)
  ) {
    throw new Error(
      `崩溃恢复不变量失败: ${JSON.stringify({ phases: storedCommits.map((commit) => commit?.phase), counts })}`,
    );
  }

  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      evidenceLevel: 'process-smoke',
      crashExitCode: crash.status,
      resumedInNewProcess: true,
      replayedInNewProcess: true,
      compileSnapshotReused: true,
      recoveredChatItems: items.length,
      counts,
    }),
  );
}

const [mode, commitId] = process.argv.slice(2);
if (
  mode === 'crash' ||
  mode === 'resume' ||
  mode === 'recover-worker' ||
  mode === 'commit-only-exit'
) {
  await runWorker(mode, commitId);
  const { closeDb } = await import('../db.js');
  closeDb();
} else {
  await runSmoke();
}
