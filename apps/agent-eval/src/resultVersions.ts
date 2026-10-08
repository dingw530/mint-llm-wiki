import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { EvalReport } from './index.js';

const INDEX_FILE = 'index.json';
const SCHEMA_VERSION = 1;
const VERSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** 为未指定名称的评测运行生成可读且不会覆盖历史结果的版本 ID。 */
export function createAutomaticVersionId(dataset: string, generatedAt = new Date(), suffix = randomBytes(4).toString('hex')): string {
  const safeDataset = dataset.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'eval';
  const timestamp = generatedAt.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return `${safeDataset}-${timestamp}-${suffix}`;
}

export interface EvalVersionRecord {
  id: string;
  dataset: string;
  datasetVersion: string;
  generatedAt: string;
  reportFile: string;
  totalRuns: number;
  passAt1: number;
  queryPassAt1: number;
  answerPassAt1: number;
  langfuseUploadedAt?: string;
  langfuseScoreCount?: number;
}

export interface EvalVersionIndex {
  schemaVersion: number;
  versions: EvalVersionRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVersionRecord(value: unknown): value is EvalVersionRecord {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.dataset === 'string'
    && typeof value.datasetVersion === 'string'
    && typeof value.generatedAt === 'string'
    && typeof value.reportFile === 'string'
    && isNumber(value.totalRuns)
    && isNumber(value.passAt1)
    && isNumber(value.queryPassAt1)
    && isNumber(value.answerPassAt1)
    && (value.langfuseUploadedAt === undefined || typeof value.langfuseUploadedAt === 'string')
    && (value.langfuseScoreCount === undefined || isNumber(value.langfuseScoreCount));
}

function isLegacyVersionRecord(value: unknown): value is Pick<EvalVersionRecord, 'id' | 'dataset' | 'datasetVersion' | 'reportFile'> {
  return isRecord(value) && typeof value.id === 'string' && typeof value.dataset === 'string'
    && typeof value.datasetVersion === 'string' && typeof value.reportFile === 'string';
}

function parseIndex(value: unknown, indexPath: string): { schemaVersion: number; versions: unknown[] } {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.versions)) {
    throw new Error(`Invalid eval version index: ${indexPath}`);
  }
  return { schemaVersion: SCHEMA_VERSION, versions: value.versions };
}

function isEvalReport(value: unknown): value is EvalReport {
  if (!isRecord(value) || typeof value.dataset !== 'string' || typeof value.version !== 'string' || typeof value.generatedAt !== 'string' || !Array.isArray(value.results) || !isRecord(value.summary)) return false;
  const summary = value.summary;
  return isNumber(summary.totalRuns) && isNumber(summary.passAt1) && isNumber(summary.queryPassAt1) && isNumber(summary.answerPassAt1);
}

function validateVersionId(versionId: string): void {
  if (!VERSION_ID_PATTERN.test(versionId) || versionId.includes('..')) {
    throw new Error(`Invalid eval result version id: ${versionId}`);
  }
}

function reportPathFor(directory: string, versionId: string): string {
  validateVersionId(versionId);
  const root = path.resolve(directory);
  const reportPath = path.resolve(root, `${versionId}.json`);
  if (!reportPath.startsWith(`${root}${path.sep}`)) throw new Error(`Eval result version path escapes directory: ${versionId}`);
  return reportPath;
}

async function readIndex(directory: string): Promise<EvalVersionIndex> {
  const indexPath = path.join(path.resolve(directory), INDEX_FILE);
  try {
    const parsed = parseIndex(JSON.parse(await fs.readFile(indexPath, 'utf8')), indexPath);
    const versions: EvalVersionRecord[] = [];
    for (const value of parsed.versions) {
      if (isVersionRecord(value)) {
        versions.push(value);
        continue;
      }
      if (!isLegacyVersionRecord(value)) throw new Error(`Invalid eval version index: ${indexPath}`);
      const legacyReportPath = path.resolve(path.resolve(directory), value.reportFile);
      if (!legacyReportPath.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error(`Invalid eval version index: ${indexPath}`);
      let report: unknown;
      try {
        report = JSON.parse(await fs.readFile(legacyReportPath, 'utf8'));
      } catch {
        throw new Error(`Invalid eval version index: ${indexPath}`);
      }
      if (!isEvalReport(report)) throw new Error(`Invalid eval version index: ${indexPath}`);
      versions.push(createVersionRecord(report, value.id));
    }
    return { schemaVersion: SCHEMA_VERSION, versions };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { schemaVersion: SCHEMA_VERSION, versions: [] };
    throw error;
  }
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

function createVersionRecord(report: EvalReport, versionId: string): EvalVersionRecord {
  return {
    id: versionId,
    dataset: report.dataset,
    datasetVersion: report.version,
    generatedAt: report.generatedAt,
    reportFile: `${versionId}.json`,
    totalRuns: report.summary.totalRuns,
    passAt1: report.summary.passAt1,
    queryPassAt1: report.summary.queryPassAt1,
    answerPassAt1: report.summary.answerPassAt1,
  };
}

/** 将完整评测报告保存为不可覆盖的结果版本。 */
export async function saveResultVersion(report: EvalReport, versionId: string, directory: string): Promise<EvalVersionRecord> {
  validateVersionId(versionId);
  const root = path.resolve(directory);
  const reportPath = reportPathFor(root, versionId);
  const indexPath = path.join(root, INDEX_FILE);
  await fs.mkdir(root, { recursive: true });
  let index: EvalVersionIndex;
  try {
    index = await readIndex(root);
  } catch (error) {
    const recoveryDirectory = path.join(root, 'recovery');
    await fs.mkdir(recoveryDirectory, { recursive: true });
    const recoveryPath = reportPathFor(recoveryDirectory, versionId);
    await writeJsonAtomically(recoveryPath, report);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}; report preserved at ${recoveryPath}`);
  }
  if (index.versions.some(version => version.id === versionId)) throw new Error(`Eval result version already exists: ${versionId}`);
  try {
    await fs.access(reportPath);
    throw new Error(`Eval result version already exists: ${versionId}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Eval result version already exists:')) throw error;
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const record = createVersionRecord(report, versionId);
  const nextIndex = { schemaVersion: SCHEMA_VERSION, versions: [...index.versions, record] };
  await writeJsonAtomically(reportPath, report);
  try {
    await writeJsonAtomically(indexPath, nextIndex);
  } catch (error) {
    const pendingPath = path.join(root, 'pending-index.json');
    await writeJsonAtomically(pendingPath, nextIndex).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Eval result report saved at ${reportPath}, but version index update failed: ${message}`);
  }
  return record;
}

/** 预检并规范化版本索引，兼容旧版 report.json 别名。 */
export async function repairResultVersionIndex(directory: string): Promise<EvalVersionIndex> {
  const root = path.resolve(directory);
  await fs.mkdir(root, { recursive: true });
  const index = await readIndex(root);
  await writeJsonAtomically(path.join(root, INDEX_FILE), index);
  return index;
}

/** 列出版本库中的结果摘要，并按生成时间倒序排列。 */
export async function listResultVersions(directory: string, dataset?: string): Promise<EvalVersionRecord[]> {
  const index = await readIndex(directory);
  return index.versions
    .filter(version => !dataset || version.dataset === dataset)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt) || right.id.localeCompare(left.id));
}

/** 记录结果版本已成功上传到 Langfuse，保留报告文件本身不可变。 */
export async function markResultVersionLangfuseUploaded(
  directory: string,
  versionId: string,
  uploadedAt: string,
  scoreCount: number,
): Promise<EvalVersionRecord> {
  validateVersionId(versionId);
  const root = path.resolve(directory);
  const indexPath = path.join(root, INDEX_FILE);
  const index = await readIndex(root);
  const versionIndex = index.versions.findIndex(version => version.id === versionId);
  if (versionIndex < 0) throw new Error(`Eval result version not found: ${versionId}`);
  const updated: EvalVersionRecord = {
    ...index.versions[versionIndex],
    langfuseUploadedAt: uploadedAt,
    langfuseScoreCount: scoreCount,
  };
  const versions = [...index.versions];
  versions[versionIndex] = updated;
  await writeJsonAtomically(indexPath, { ...index, versions });
  return updated;
}

/** 从版本库读取一个完整评测报告。 */
export async function readResultVersion(versionId: string, directory: string): Promise<EvalReport> {
  const reportPath = reportPathFor(directory, versionId);
  const index = await readIndex(directory);
  if (!index.versions.some(version => version.id === versionId)) throw new Error(`Eval result version not found: ${versionId}`);
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw new Error(`Eval result version report is missing: ${versionId}`);
    throw error;
  }
  if (!isEvalReport(value)) throw new Error(`Invalid eval result report: ${versionId}`);
  return value;
}
