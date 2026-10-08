import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { EvalFeatureConfig } from './featureConfig.js';

export interface EvalRunProvenance {
  schemaVersion: 1;
  status: 'bound' | 'unavailable';
  capturedAt: string;
  fingerprint: string;
  source: {
    commit: string | null;
    branch: string | null;
    dirty: boolean | null;
    snapshotSha256: string;
  };
  dataset: {
    name: string;
    version: string;
    datasetSha256: string;
    corpusSha256: string;
  };
  runtime: {
    nodeVersion: string;
    platform: string;
    architecture: string;
  };
  featuresSha256: string;
  agent: {
    provider: string | null;
    model: string | null;
    apiEndpointSha256: string | null;
  };
  judge: {
    enabled: boolean;
    provider: string | null;
    model: string | null;
    apiEndpointSha256: string | null;
  };
}

export interface EvalReportProvenance {
  agentExecution: EvalRunProvenance | null;
  reportGeneration: EvalRunProvenance;
}

export interface EvalProvenanceOptions {
  repositoryRoot: string;
  datasetName: string;
  datasetVersion: string;
  datasetPath: string;
  corpusDirectory: string;
  features?: EvalFeatureConfig;
  agentModel?: string;
  agentApiUrl?: string;
  judgeApiUrl?: string;
  judgeEnabled: boolean;
  judgeProvider?: string;
  judgeModel?: string;
}

const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.json', '.mjs', '.ts', '.tsx']);
const SOURCE_DIRECTORIES = ['apps/agent-eval/src', 'server'];
const PACKAGE_FILES = [
  'package.json',
  'package-lock.json',
  'apps/agent-eval/package.json',
  'apps/server/package.json',
];
const RUN_PROVENANCE_FILE = 'run-provenance.json';

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0] || '';
  }
}

function hostnameFromUrl(value?: string): string | null {
  if (!value) return null;
  try {
    return new URL(sanitizeUrl(value)).hostname || null;
  } catch {
    return null;
  }
}

function sanitizeConfig(value: unknown, key = ''): unknown {
  if (/(?:api.?key|access.?token|secret|password|credential|authorization)/i.test(key)) {
    return '[redacted]';
  }
  if (typeof value === 'string') {
    return /url|endpoint/i.test(key) ? sanitizeUrl(value) : value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeConfig(item));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeConfig(childValue, childKey),
      ]),
    );
  }
  return value;
}

async function walkFiles(directory: string, extensions?: Set<string>): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(entryPath, extensions)));
    else if (
      entry.isFile() &&
      (!extensions || extensions.has(path.extname(entry.name).toLowerCase()))
    ) {
      files.push(entryPath);
    }
  }
  return files;
}

async function hashFiles(root: string, files: string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    const relativePath = path.relative(root, file).split(path.sep).join('/');
    hash.update(relativePath);
    hash.update('\0');
    hash.update(await fs.readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function gitOutput(repositoryRoot: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', repositoryRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

async function sourceSnapshot(repositoryRoot: string): Promise<{
  commit: string | null;
  branch: string | null;
  dirty: boolean | null;
  snapshotSha256: string;
  available: boolean;
}> {
  const directories = await Promise.all(
    SOURCE_DIRECTORIES.map((directory) =>
      walkFiles(path.join(repositoryRoot, directory), SOURCE_EXTENSIONS),
    ),
  );
  const packageFiles = PACKAGE_FILES.map((file) => path.join(repositoryRoot, file));
  const existingPackages = await Promise.all(
    packageFiles.map(async (file) => {
      try {
        await fs.access(file);
        return file;
      } catch {
        return null;
      }
    }),
  );
  const snapshotSha256 = await hashFiles(repositoryRoot, [
    ...directories.flat(),
    ...existingPackages.filter((file): file is string => file !== null),
  ]);
  const commit = gitOutput(repositoryRoot, ['rev-parse', 'HEAD']);
  const branch = gitOutput(repositoryRoot, ['branch', '--show-current']);
  const status = gitOutput(repositoryRoot, [
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--',
    ...SOURCE_DIRECTORIES,
    ...PACKAGE_FILES,
  ]);
  return {
    commit,
    branch: branch || null,
    dirty: status === null ? null : status.length > 0,
    snapshotSha256,
    available: commit !== null,
  };
}

/** Capture source, dataset, feature, model, and runtime identity for one evaluation stage. */
export async function captureEvalRunProvenance(
  options: EvalProvenanceOptions,
): Promise<EvalRunProvenance> {
  const source = await sourceSnapshot(path.resolve(options.repositoryRoot));
  const datasetSha256 = sha256(await fs.readFile(options.datasetPath));
  const corpusFiles = await walkFiles(options.corpusDirectory);
  const corpusSha256 = await hashFiles(options.corpusDirectory, corpusFiles);
  const featuresSha256 = sha256(canonicalJson(sanitizeConfig(options.features ?? null)));
  const agentProvider = hostnameFromUrl(options.agentApiUrl);
  const agentApiEndpointSha256 = options.agentApiUrl
    ? sha256(sanitizeUrl(options.agentApiUrl))
    : null;
  const judgeApiEndpointSha256 =
    options.judgeEnabled && options.judgeApiUrl ? sha256(sanitizeUrl(options.judgeApiUrl)) : null;
  const payload = {
    source: source.snapshotSha256,
    dataset: datasetSha256,
    corpus: corpusSha256,
    features: featuresSha256,
    agentModel: options.agentModel ?? null,
    agentApiEndpointSha256,
    judgeEnabled: options.judgeEnabled,
    judgeProvider: options.judgeProvider ?? null,
    judgeModel: options.judgeModel ?? null,
    judgeApiEndpointSha256,
  };

  return {
    schemaVersion: 1,
    status: source.available ? 'bound' : 'unavailable',
    capturedAt: new Date().toISOString(),
    fingerprint: sha256(canonicalJson(payload)),
    source: {
      commit: source.commit,
      branch: source.branch,
      dirty: source.dirty,
      snapshotSha256: source.snapshotSha256,
    },
    dataset: {
      name: options.datasetName,
      version: options.datasetVersion,
      datasetSha256,
      corpusSha256,
    },
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    featuresSha256,
    agent: {
      provider: agentProvider,
      model: options.agentModel ?? null,
      apiEndpointSha256: agentApiEndpointSha256,
    },
    judge: {
      enabled: options.judgeEnabled,
      provider: options.judgeEnabled ? (options.judgeProvider ?? null) : null,
      model: options.judgeEnabled ? (options.judgeModel ?? null) : null,
      apiEndpointSha256: judgeApiEndpointSha256,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEvalRunProvenance(value: unknown): value is EvalRunProvenance {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (value.status !== 'bound' && value.status !== 'unavailable') return false;
  if (typeof value.capturedAt !== 'string' || typeof value.fingerprint !== 'string') return false;
  if (
    !isRecord(value.source) ||
    typeof value.source.snapshotSha256 !== 'string' ||
    !(typeof value.source.commit === 'string' || value.source.commit === null) ||
    !(typeof value.source.branch === 'string' || value.source.branch === null) ||
    !(typeof value.source.dirty === 'boolean' || value.source.dirty === null)
  ) {
    return false;
  }
  if (
    !isRecord(value.dataset) ||
    typeof value.dataset.name !== 'string' ||
    typeof value.dataset.version !== 'string' ||
    typeof value.dataset.datasetSha256 !== 'string' ||
    typeof value.dataset.corpusSha256 !== 'string'
  ) {
    return false;
  }
  if (
    !isRecord(value.runtime) ||
    typeof value.runtime.nodeVersion !== 'string' ||
    typeof value.runtime.platform !== 'string' ||
    typeof value.runtime.architecture !== 'string' ||
    typeof value.featuresSha256 !== 'string' ||
    !isRecord(value.agent) ||
    !isRecord(value.judge) ||
    typeof value.judge.enabled !== 'boolean'
  ) {
    return false;
  }
  return true;
}

/** Persist the execution provenance beside its checkpoint for later Judge-only reports. */
export async function writeEvalRunProvenance(
  runDirectory: string,
  provenance: EvalRunProvenance,
): Promise<void> {
  const directory = path.resolve(runDirectory);
  const filePath = path.join(directory, RUN_PROVENANCE_FILE);
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/** Read persisted execution provenance; old checkpoints remain explicitly unbound. */
export async function readEvalRunProvenance(
  runDirectory: string,
): Promise<EvalRunProvenance | null> {
  const filePath = path.join(path.resolve(runDirectory), RUN_PROVENANCE_FILE);
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (!isEvalRunProvenance(value)) {
    throw new Error(`Invalid eval run provenance: ${filePath}`);
  }
  return value;
}
