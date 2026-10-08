import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { EvalCaseResult } from './index.js';

const RUN_SCHEMA_VERSION = 1;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface EvalRunManifest {
  schemaVersion: number;
  runId: string;
  dataset: string;
  datasetVersion: string;
  runsPerCase: number;
  totalRuns: number;
  createdAt: string;
  updatedAt: string;
}

export interface EvalRunCheckpoint extends EvalRunManifest {
  results: EvalCaseResult[];
}

export interface EvalRunMetadata {
  runId: string;
  dataset: string;
  datasetVersion: string;
  runsPerCase: number;
  totalRuns: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId) || runId.includes('..')) throw new Error(`Invalid eval run id: ${runId}`);
}

function checkpointPath(directory: string): string {
  return path.join(path.resolve(directory), 'checkpoint.json');
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function validateCheckpoint(value: unknown, directory: string): asserts value is EvalRunCheckpoint {
  if (!isRecord(value) || value.schemaVersion !== RUN_SCHEMA_VERSION || typeof value.runId !== 'string'
    || typeof value.dataset !== 'string' || typeof value.datasetVersion !== 'string'
    || !Number.isInteger(value.runsPerCase) || !Number.isInteger(value.totalRuns)
    || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string'
    || !Array.isArray(value.results)) {
    throw new Error(`Invalid eval run checkpoint: ${directory}`);
  }
  validateRunId(value.runId);
}

/** 为一次可恢复的评测创建稳定目录和初始检查点。 */
export async function createEvalRun(directory: string, metadata: EvalRunMetadata, now = new Date()): Promise<EvalRunCheckpoint> {
  validateRunId(metadata.runId);
  if (!Number.isInteger(metadata.runsPerCase) || metadata.runsPerCase < 1) throw new Error('runsPerCase must be a positive integer');
  if (!Number.isInteger(metadata.totalRuns) || metadata.totalRuns < 1) throw new Error('totalRuns must be a positive integer');
  const root = path.resolve(directory);
  await fs.mkdir(root, { recursive: true });
  try {
    await fs.access(checkpointPath(root));
    throw new Error(`Eval run already exists: ${root}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Eval run already exists:')) throw error;
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const timestamp = now.toISOString();
  const checkpoint: EvalRunCheckpoint = { schemaVersion: RUN_SCHEMA_VERSION, ...metadata, createdAt: timestamp, updatedAt: timestamp, results: [] };
  await writeJsonAtomically(checkpointPath(root), checkpoint);
  return checkpoint;
}

/** 读取评测检查点，并在恢复前校验其结构。 */
export async function readEvalRun(directory: string): Promise<EvalRunCheckpoint> {
  const root = path.resolve(directory);
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(checkpointPath(root), 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw new Error(`Eval run checkpoint not found: ${root}`);
    throw error;
  }
  validateCheckpoint(value, root);
  return value;
}

/** 将单个已完成 run 原子追加到检查点，保证中断后可从最近一次完成处恢复。 */
export async function appendEvalRunResult(directory: string, result: EvalCaseResult, now = new Date()): Promise<EvalRunCheckpoint> {
  const root = path.resolve(directory);
  const checkpoint = await readEvalRun(root);
  if (checkpoint.results.some(item => item.caseId === result.caseId && item.runIndex === result.runIndex)) {
    throw new Error(`Eval run result already exists: ${result.caseId} run ${result.runIndex}`);
  }
  const next: EvalRunCheckpoint = { ...checkpoint, updatedAt: now.toISOString(), results: [...checkpoint.results, result] };
  await writeJsonAtomically(checkpointPath(root), next);
  return next;
}

/** 生成默认的可恢复评测 ID。 */
export function createEvalRunId(dataset: string, now = new Date()): string {
  const safeDataset = dataset.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'eval';
  const timestamp = now.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return `${safeDataset}-${timestamp}-${randomBytes(4).toString('hex')}`;
}
