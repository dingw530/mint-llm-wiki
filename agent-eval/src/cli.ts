import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import './loadEnv.js';
import {
  compareReports,
  datasetPath,
  loadDataset,
  runEvaluation,
  runJudgeOnly,
  writeReport,
} from './index.js';
import type { AgentEvalExecutor, EvalProgressUpdate, EvalReport } from './index.js';
import {
  createAutomaticVersionId,
  listResultVersions,
  markResultVersionLangfuseUploaded,
  readResultVersion,
  repairResultVersionIndex,
  saveResultVersion,
} from './resultVersions.js';
import { ingestWikiRagCorpus, prepareWikiRagCorpus } from './wikiRagCorpus.js';
import { resolveRuns } from './runOptions.js';
import {
  appendEvalRunResult,
  createEvalRun,
  createEvalRunId,
  readEvalRun,
  type EvalRunCheckpoint,
} from './runPersistence.js';
import {
  buildCalibrationTemplate,
  compareCalibration,
  type CalibrationLabel,
} from './calibration.js';
import { createOpenAiJudge, createOpenAiPairwiseJudge } from './judge.js';
import { calculateElo, runPairwiseComparison, type PairwiseReport } from './pairwise.js';
import { readEvalReport, uploadEvalReport } from './langfuseUpload.js';
import { resolveFeatureConfig } from './featureConfig.js';

const [, , command = 'list', ...args] = process.argv;
const evalDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasetsDirectory = path.join(evalDirectory, 'datasets');
const defaultVersionDirectory = path.join(evalDirectory, 'viewer/versions');
const defaultRunDirectory = path.join(evalDirectory, 'viewer/runs');
const smokeExecutor: AgentEvalExecutor = async (evalCase) => ({
  content: evalCase.id === 'qa-001' ? '思考、行动、观察' : '',
  events: [{ type: 'run_completed' }],
});
const DATASET_NAMES = ['smoke', 'wiki-rag'];

const dryRunExecutor: AgentEvalExecutor = async (evalCase) => {
  const expected = evalCase.expected;
  const claims = [
    ...(expected.mustContain || []),
    ...(expected.mustContainAny || []).map((group) => group[0]),
    ...(expected.mustAbstain ? [expected.abstainMarkers?.[0] || '没有足够信息'] : []),
  ].filter((value): value is string => Boolean(value));
  const toolEvents = (expected.mustUseTools || []).map((toolName) => ({
    type: 'tool_call_start',
    toolName,
    round: 1,
  }));
  const citations = (expected.requiredSourceFiles || []).map((file) => ({
    file,
    refId: `dry-${file}`,
  }));
  const completionEvent = expected.mustRequireApproval
    ? {
        type: 'approval_required',
        toolName: expected.approvalTool || expected.mustUseTools?.[0],
        round: 1,
      }
    : { type: 'run_completed' };
  return {
    content: claims.join('；'),
    events: [...toolEvents, completionEvent],
    citations,
  };
};

function optionValue(args: string[], name: string): string | undefined {
  const index = args.lastIndexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function envPath(name: string, fallback: string): string {
  const value = process.env[name];
  return value ? path.resolve(evalDirectory, value) : fallback;
}

function requiredOption(args: string[], name: string): string {
  const value = optionValue(args, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function versionDirectory(args: string[]): string {
  return path.resolve(optionValue(args, '--version-dir') || defaultVersionDirectory);
}

function resolveRunDirectory(
  args: string[],
  dataset: string,
): { directory: string; runId: string; resume: boolean } {
  const runsDirectory = path.resolve(optionValue(args, '--runs-dir') || defaultRunDirectory);
  const resumeValue = optionValue(args, '--resume');
  if (resumeValue) {
    const directory =
      path.isAbsolute(resumeValue) || resumeValue.includes(path.sep)
        ? path.resolve(resumeValue)
        : path.join(runsDirectory, resumeValue);
    return { directory, runId: path.basename(directory), resume: true };
  }
  const runId = optionValue(args, '--run-id') || createEvalRunId(dataset);
  const directory = path.resolve(optionValue(args, '--run-dir') || path.join(runsDirectory, runId));
  return { directory, runId, resume: false };
}

function validateRunCheckpoint(
  checkpoint: EvalRunCheckpoint,
  dataset: string,
  datasetVersion: string,
  runsPerCase: number,
  totalRuns: number,
): void {
  if (
    checkpoint.dataset !== dataset ||
    checkpoint.datasetVersion !== datasetVersion ||
    checkpoint.runsPerCase !== runsPerCase ||
    checkpoint.totalRuns !== totalRuns
  ) {
    throw new Error(
      `Eval run checkpoint does not match dataset ${dataset}@${datasetVersion} runs=${runsPerCase}`,
    );
  }
}

async function assertOutputWritable(outputPath: string): Promise<void> {
  const directory = path.dirname(path.resolve(outputPath));
  await fs.mkdir(directory, { recursive: true });
  const probePath = path.join(directory, `.eval-write-probe-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(probePath, '');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Eval report output is not writable: ${outputPath}; ${message}`);
  } finally {
    await fs.unlink(probePath).catch(() => undefined);
  }
}

function judgeConfig(args: string[]): { apiUrl: string; apiKey: string; modelId: string } {
  const apiUrl = optionValue(args, '--judge-api-url') || process.env.MINT_EVAL_JUDGE_API_URL;
  const apiKey = optionValue(args, '--judge-api-key') || process.env.MINT_EVAL_JUDGE_API_KEY;
  const modelId = optionValue(args, '--judge-model') || process.env.MINT_EVAL_JUDGE_MODEL_ID;
  if (!apiUrl || !apiKey || !modelId)
    throw new Error(
      '--judge requires MINT_EVAL_JUDGE_API_URL, MINT_EVAL_JUDGE_API_KEY and MINT_EVAL_JUDGE_MODEL_ID (or matching --judge-* options)',
    );
  return { apiUrl, apiKey, modelId };
}

function applyDatabaseOverride(args: string[]): string | undefined {
  const cliPath = optionValue(args, '--db');
  const dbPath = cliPath ? path.resolve(cliPath) : envPath('MINT_EVAL_DB_PATH', '');
  if (dbPath) process.env.AI_CHAT_DB_PATH = dbPath;
  return dbPath || undefined;
}

interface EvalSearchConfig {
  wikiSearchMode: 'keyword' | 'hybrid';
  embeddingApiUrl: string;
  embeddingModel: string;
  embeddingDimensions: number;
}

function parseEmbeddingDimensions(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const dimensions = Number(value);
  if (!Number.isInteger(dimensions) || dimensions !== 1024) {
    throw new Error(
      '--embedding-dimensions must be 1024 because sqlite-vec is configured for 1024 dimensions',
    );
  }
  return dimensions;
}

function resolveEvalSearchConfig(
  args: string[],
  existing?: Partial<EvalSearchConfig>,
): EvalSearchConfig {
  const mode =
    optionValue(args, '--wiki-search-mode') || process.env.MINT_EVAL_WIKI_SEARCH_MODE || 'hybrid';
  if (mode !== 'keyword' && mode !== 'hybrid')
    throw new Error('--wiki-search-mode must be keyword or hybrid');
  const embeddingDimensions =
    parseEmbeddingDimensions(
      optionValue(args, '--embedding-dimensions') || process.env.MINT_EVAL_EMBEDDING_DIMENSIONS,
    ) ||
    existing?.embeddingDimensions ||
    1024;
  if (embeddingDimensions !== 1024)
    throw new Error(
      'Embedding dimensions must be 1024 because sqlite-vec is configured for 1024 dimensions',
    );
  return {
    wikiSearchMode: mode,
    embeddingApiUrl:
      optionValue(args, '--embedding-api-url') ||
      process.env.MINT_EVAL_EMBEDDING_API_URL ||
      existing?.embeddingApiUrl ||
      'http://127.0.0.1:11434/v1',
    embeddingModel:
      optionValue(args, '--embedding-model') ||
      process.env.MINT_EVAL_EMBEDDING_MODEL ||
      existing?.embeddingModel ||
      'bge-m3',
    embeddingDimensions,
  };
}

function assertHybridVectorHealth(
  health: { documentCount: number; vectorizedCount: number; coverage: number; failedCount: number },
  phase: string,
): void {
  if (health.documentCount > 0 && health.coverage === 1 && health.failedCount === 0) return;
  throw new Error(
    `${phase} hybrid vector index is incomplete: documents=${health.documentCount}, ` +
      `vectorized=${health.vectorizedCount}, coverage=${health.coverage}, failed=${health.failedCount}. ` +
      'Check MINT_EVAL_EMBEDDING_API_URL/MINT_EVAL_EMBEDDING_MODEL and rerun ingest.',
  );
}

/** 输出不含提示词、回答或密钥的评测执行进度；`--quiet` 可关闭。 */
function logEvaluationProgress(update: EvalProgressUpdate): void {
  const currentRun =
    update.phase === 'run_started' ? update.completedRuns + 1 : update.completedRuns;
  const position = `${currentRun}/${update.totalRuns}`;
  if (update.phase === 'run_started') {
    console.log(`[eval] ${position} start ${update.caseId} run ${update.runIndex}`);
  } else if (update.phase === 'judge_started') {
    console.log(`[eval] ${position} judge ${update.caseId} run ${update.runIndex}`);
  } else {
    console.log(
      `[eval] ${position} done ${update.caseId} run ${update.runIndex} ${update.passed ? 'PASS' : 'FAIL'} ${update.latencyMs}ms`,
    );
  }
}

/** 执行评估 CLI 命令。 */
async function main(): Promise<void> {
  if (command === 'list') {
    console.log(DATASET_NAMES.join('\n'));
    return;
  }
  if (command === 'versions:list') {
    const versions = await listResultVersions(
      versionDirectory(args),
      optionValue(args, '--dataset'),
    );
    console.log(JSON.stringify(versions, null, 2));
    return;
  }
  if (command === 'versions:repair') {
    const index = await repairResultVersionIndex(versionDirectory(args));
    console.log(JSON.stringify(index, null, 2));
    return;
  }
  if (command === 'langfuse:upload') {
    const reportOption = optionValue(args, '--report');
    const versionOption = optionValue(args, '--version');
    if (reportOption && versionOption)
      throw new Error('langfuse:upload accepts either --report or --version, not both');
    if (!reportOption && !versionOption)
      throw new Error('langfuse:upload requires --report or --version');
    const reportPath = reportOption
      ? path.resolve(reportOption)
      : path.join(
          versionDirectory(args),
          `${versionOption === 'report' ? 'report' : versionOption}.json`,
        );
    const report = await readEvalReport(reportPath);
    const baseUrl =
      optionValue(args, '--langfuse-base-url') ||
      process.env.LANGFUSE_BASE_URL ||
      'https://cloud.langfuse.com';
    const publicKey = optionValue(args, '--langfuse-public-key') || process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = optionValue(args, '--langfuse-secret-key') || process.env.LANGFUSE_SECRET_KEY;
    if (!publicKey || !secretKey)
      throw new Error(
        'Langfuse upload requires LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY (or matching --langfuse-* options)',
      );
    const result = await uploadEvalReport(report, { baseUrl, publicKey, secretKey });
    const reportVersionId =
      versionOption ||
      (path.basename(reportPath) === 'report.json' ? 'report' : result.reportVersion);
    const version = await markResultVersionLangfuseUploaded(
      versionDirectory(args),
      reportVersionId,
      new Date().toISOString(),
      result.scoreCount,
    );
    console.log(
      JSON.stringify(
        {
          ...result,
          baseUrl,
          contentUploaded: false,
          langfuseUploadedAt: version.langfuseUploadedAt,
          viewerMarked: true,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'versions:compare') {
    const baselineId = requiredOption(args, '--baseline');
    const currentId = requiredOption(args, '--current');
    const baseline = await readResultVersion(baselineId, versionDirectory(args));
    const current = await readResultVersion(currentId, versionDirectory(args));
    const comparison = compareReports(current, baseline);
    const output = path.resolve(
      optionValue(args, '--output') || path.join(evalDirectory, 'viewer/comparison.json'),
    );
    await writeReport(comparison, output);
    console.log(
      JSON.stringify(
        { output, baseline: baselineId, current: currentId, comparison: comparison.comparison },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'calibration:export') {
    const report = JSON.parse(
      await fs.readFile(path.resolve(requiredOption(args, '--report')), 'utf8'),
    ) as EvalReport;
    const output = path.resolve(
      optionValue(args, '--output') || path.join(evalDirectory, 'viewer/calibration-template.json'),
    );
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(
      output,
      `${JSON.stringify(buildCalibrationTemplate(report), null, 2)}\n`,
      'utf8',
    );
    console.log(output);
    return;
  }
  if (command === 'calibration:compare') {
    const report = JSON.parse(
      await fs.readFile(path.resolve(requiredOption(args, '--report')), 'utf8'),
    ) as EvalReport;
    const payload = JSON.parse(
      await fs.readFile(path.resolve(requiredOption(args, '--labels')), 'utf8'),
    ) as { labels?: CalibrationLabel[] } | CalibrationLabel[];
    const labels = Array.isArray(payload) ? payload : payload.labels;
    if (!Array.isArray(labels))
      throw new Error('Calibration labels must be an array or an object with labels');
    const comparison = compareCalibration(report, labels);
    const output = optionValue(args, '--output');
    if (output) {
      const outputPath = path.resolve(output);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(comparison, null, 2));
    if (args.includes('--require-calibrated') && !comparison.calibrated) {
      process.exitCode = 2;
      console.error(
        'Judge calibration is below the P0 threshold; collect more representative human labels before using this Judge for regression decisions.',
      );
    }
    return;
  }
  if (command === 'pairwise') {
    const dataset = await loadDataset(
      datasetPath(datasetsDirectory, requiredOption(args, '--dataset')),
    );
    const reportA = JSON.parse(
      await fs.readFile(path.resolve(requiredOption(args, '--report-a')), 'utf8'),
    ) as EvalReport;
    const reportB = JSON.parse(
      await fs.readFile(path.resolve(requiredOption(args, '--report-b')), 'utf8'),
    ) as EvalReport;
    const comparison = await runPairwiseComparison(
      dataset,
      reportA,
      reportB,
      optionValue(args, '--label-a') || 'A',
      optionValue(args, '--label-b') || 'B',
      createOpenAiPairwiseJudge(judgeConfig(args)),
    );
    const output = path.resolve(
      optionValue(args, '--output') || path.join(evalDirectory, 'viewer/pairwise-report.json'),
    );
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');
    console.log(
      JSON.stringify(
        {
          total: comparison.total,
          winsA: comparison.winsA,
          winsB: comparison.winsB,
          ties: comparison.ties,
          positionDisagreements: comparison.positionDisagreements,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'pairwise:elo') {
    const report = JSON.parse(
      await fs.readFile(path.resolve(requiredOption(args, '--input')), 'utf8'),
    ) as PairwiseReport;
    console.log(JSON.stringify(calculateElo(report), null, 2));
    return;
  }
  if (command === 'prepare') {
    const rawDir =
      optionValue(args, '--raw') ||
      envPath('MINT_EVAL_RAW_DIR', path.join(datasetsDirectory, 'wiki-rag/raw'));
    const outputDir =
      optionValue(args, '--output') ||
      envPath('MINT_EVAL_FIXTURE_PATH', path.join(datasetsDirectory, 'wiki-rag/fixture'));
    const report = await prepareWikiRagCorpus(rawDir, outputDir);
    console.log(
      JSON.stringify(
        {
          outputDir: report.outputDir,
          sourceCount: report.sources.length,
          pageCount: report.sources.length,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'ingest') {
    const rawDir =
      optionValue(args, '--raw') ||
      envPath('MINT_EVAL_RAW_DIR', path.join(datasetsDirectory, 'wiki-rag/raw'));
    const outputDir =
      optionValue(args, '--output') ||
      envPath('MINT_EVAL_WIKI_PATH', path.join(os.tmpdir(), 'mint-wiki-rag-ingested'));
    const cliDbPath = optionValue(args, '--db');
    const dbPath = cliDbPath
      ? path.resolve(cliDbPath)
      : envPath('MINT_EVAL_DB_PATH', path.join(os.tmpdir(), 'mint-wiki-rag-agent-eval.db'));
    process.env.AI_CHAT_DB_PATH = dbPath;
    const server = await import('mint-server/eval');
    const existing = server.getAiSettings();
    const apiUrl =
      optionValue(args, '--api-url') || process.env.MINT_EVAL_API_URL || existing.apiUrl;
    const apiKey =
      optionValue(args, '--api-key') || process.env.MINT_EVAL_API_KEY || existing.apiKey;
    const modelId =
      optionValue(args, '--model') || process.env.MINT_EVAL_MODEL_ID || existing.modelId;
    if (!apiUrl || !apiKey || !modelId) {
      throw new Error(
        'Wiki ingestion requires --api-url, --api-key and --model (or MINT_EVAL_API_* environment variables)',
      );
    }
    const searchConfig = resolveEvalSearchConfig(args, existing);
    const settings = server.configureEvalSettings({
      apiUrl,
      apiKey,
      modelId,
      wikiPath: path.resolve(outputDir),
      ...searchConfig,
      features: await resolveFeatureConfig(args, evalDirectory),
    });
    const report = await ingestWikiRagCorpus(rawDir, outputDir, settings, server.ingestWikiSource, {
      clean: args.includes('--clean'),
      onProgress: (update) => {
        const position = `${update.phase === 'source_started' ? update.completedSources + 1 : update.completedSources}/${update.totalSources}`;
        if (update.phase === 'source_started')
          console.log(`[ingest] ${position} start ${update.sourceFile}`);
        else
          console.log(`[ingest] ${position} done ${update.sourceFile} pages=${update.pageCount}`);
      },
    });
    const vectorHealth = await server.getEvalVectorHealth(settings);
    if (settings.wikiSearchMode === 'hybrid') assertHybridVectorHealth(vectorHealth, 'ingest');
    const pageCount = report.sources.reduce((sum, source) => sum + source.result.pages.length, 0);
    console.log(
      JSON.stringify(
        {
          outputDir: report.outputDir,
          dbPath: path.resolve(dbPath),
          sourceCount: report.sources.length,
          pageCount,
          wikiSearchMode: settings.wikiSearchMode,
          vectorHealth,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'judge-only') {
    const datasetName = optionValue(args, '--dataset') || 'wiki-rag';
    const dataset = await loadDataset(datasetPath(datasetsDirectory, datasetName));
    const resumeValue = requiredOption(args, '--resume');
    const runLocation = resolveRunDirectory(
      [
        '--resume',
        resumeValue,
        '--runs-dir',
        optionValue(args, '--runs-dir') || defaultRunDirectory,
      ],
      datasetName,
    );
    const checkpoint = await readEvalRun(runLocation.directory);
    const runs = resolveRuns(optionValue(args, '--runs') || String(checkpoint.runsPerCase), false);
    validateRunCheckpoint(
      checkpoint,
      dataset.name,
      dataset.version,
      runs,
      dataset.cases.length * runs,
    );
    const output = path.resolve(
      optionValue(args, '--output') || path.join(evalDirectory, 'viewer/judge-report.json'),
    );
    await repairResultVersionIndex(versionDirectory(args));
    await assertOutputWritable(output);
    const report = await runJudgeOnly(
      dataset,
      checkpoint.results,
      createOpenAiJudge(judgeConfig(args)),
      args.includes('--quiet') ? undefined : logEvaluationProgress,
      runs,
    );
    const resultVersion =
      optionValue(args, '--version') ||
      createAutomaticVersionId(`${datasetName}-judge`, new Date(report.generatedAt));
    const versionedReport = { ...report, resultVersion };
    await writeReport(versionedReport, output);
    await saveResultVersion(versionedReport, resultVersion, versionDirectory(args));
    console.log(JSON.stringify(versionedReport.summary, null, 2));
    return;
  }
  if (command !== 'run') throw new Error(`Unknown eval command: ${command}`);
  const datasetName = optionValue(args, '--dataset');
  const runsValue = optionValue(args, '--runs');
  const outputPath = optionValue(args, '--output');
  const baselinePath = optionValue(args, '--baseline');
  const versionId = optionValue(args, '--version');
  const live = args.includes('--live');
  const name = datasetName || 'smoke';
  const runs = resolveRuns(runsValue, live);
  const output = outputPath || path.join(evalDirectory, 'viewer/report.json');
  const dbPath = applyDatabaseOverride(args);
  const dataset = await loadDataset(datasetPath(datasetsDirectory, name));
  await repairResultVersionIndex(versionDirectory(args));
  await assertOutputWritable(output);
  const totalRuns = dataset.cases.length * runs;
  const runLocation = resolveRunDirectory(args, name);
  const checkpoint = runLocation.resume
    ? await readEvalRun(runLocation.directory)
    : await createEvalRun(runLocation.directory, {
        runId: runLocation.runId,
        dataset: dataset.name,
        datasetVersion: dataset.version,
        runsPerCase: runs,
        totalRuns,
      });
  validateRunCheckpoint(checkpoint, dataset.name, dataset.version, runs, totalRuns);
  const needsExecution = checkpoint.results.length < totalRuns;
  let executor = smokeExecutor;
  if (args.includes('--dry-run')) executor = dryRunExecutor;
  if (needsExecution && live) {
    const server = await import('mint-server/eval');
    const wikiPath = optionValue(args, '--wiki') || envPath('MINT_EVAL_WIKI_PATH', '');
    if (wikiPath && !dbPath)
      throw new Error(
        '--wiki requires --db or MINT_EVAL_DB_PATH so the Wiki path remains isolated from production settings',
      );
    const existing = server.getAiSettings();
    const features = await resolveFeatureConfig(args, evalDirectory);
    const runtime = wikiPath
      ? server.configureEvalRuntime({
          apiUrl: existing.apiUrl,
          apiKey: existing.apiKey,
          modelId: existing.modelId,
          wikiPath: path.resolve(wikiPath),
          ...resolveEvalSearchConfig(args, existing),
          features,
        })
      : { settings: existing, runtimeContext: server.createEvalRuntimeContext(features) };
    const settings = runtime.settings;
    if (!settings.wikiPath)
      throw new Error(
        'Live Wiki-RAG evaluation requires --wiki <isolated-wiki-path> or a configured wikiPath',
      );
    if (settings.wikiSearchMode === 'hybrid') {
      const vectorHealth = await server.getEvalVectorHealth(settings);
      assertHybridVectorHealth(vectorHealth, 'live evaluation');
    }
    executor = server.createReactExecutor(settings, runtime.runtimeContext);
  }
  const judge =
    needsExecution && args.includes('--judge') ? createOpenAiJudge(judgeConfig(args)) : undefined;
  const report = await runEvaluation(
    dataset,
    executor,
    runs,
    judge,
    args.includes('--quiet') ? undefined : logEvaluationProgress,
    {
      initialResults: checkpoint.results,
      onResult: async (result) => {
        await appendEvalRunResult(runLocation.directory, result);
      },
    },
  );
  const resultVersion = versionId || createAutomaticVersionId(name, new Date(report.generatedAt));
  const versionedReport = { ...report, resultVersion };
  await writeReport(versionedReport, output);
  await saveResultVersion(versionedReport, resultVersion, versionDirectory(args));
  const finalReport = baselinePath
    ? compareReports(
        versionedReport,
        JSON.parse(await fs.readFile(path.resolve(baselinePath), 'utf8')) as EvalReport,
      )
    : versionedReport;
  if (baselinePath) await writeReport(finalReport, output);
  console.log(JSON.stringify(finalReport.summary, null, 2));
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
