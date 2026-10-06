import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

/** 超过此大小的工具结果会转为 artifact 摘要。 */
export const TOOL_RESULT_ARTIFACT_THRESHOLD = 12_000;
export const ARTIFACT_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
export const ARTIFACT_HARD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ARTIFACT_ACTIVE_GRACE_MS = 2 * 60 * 60 * 1000;
export const ARTIFACT_MAX_BYTES = 1024 * 1024 * 1024;
export const ARTIFACT_CLEANUP_THRESHOLD_BYTES = Math.floor(ARTIFACT_MAX_BYTES * 0.8);
export const ARTIFACT_CLEANUP_TARGET_BYTES = Math.floor(ARTIFACT_MAX_BYTES * 0.7);
const TOOL_RESULT_PREVIEW_LIMIT = 2_000;

export type ArtifactCleanupMode = 'startup' | 'before_write';

export interface ArtifactCleanupOptions {
  mode: ArtifactCleanupMode;
  additionalBytes?: number;
  now?: number;
}

export interface ArtifactCleanupReport {
  scannedFiles: number;
  deletedFiles: number;
  reclaimedBytes: number;
  totalBytes: number;
}

interface ArtifactFile {
  path: string;
  bytes: number;
  createdAt: number;
  lastAccessAt: number;
}

let artifactOperationQueue: Promise<void> = Promise.resolve();

export interface ToolResultMessageOptions {
  summary?: string;
  conversationId?: string;
  /** 是否保持结果原样返回，不保存为 artifact。 */
  skipArtifact?: boolean;
}

/**
 * 解包工具可能返回的双重 JSON 字符串，避免 artifact 保存时重复转义。
 * @param result 工具原始结果
 * @returns 适合持久化的结果值
 */
function normalizeArtifactResult(result: unknown): unknown {
  if (typeof result !== 'string') return result;

  try {
    const parsed = JSON.parse(result) as unknown;
    return parsed === result ? result : parsed;
  } catch {
    return result;
  }
}

/**
 * 获取 Mint 持久化数据根目录下的 artifact 目录。
 * @returns artifact 根目录
 */
export function getArtifactRoot(): string {
  if (process.env.AI_CHAT_CONTEXT_ARTIFACT_DIR) {
    return process.env.AI_CHAT_CONTEXT_ARTIFACT_DIR;
  }
  if (process.env.AI_CHAT_DB_PATH) {
    return join(dirname(process.env.AI_CHAT_DB_PATH), 'context-artifacts');
  }
  return join(homedir(), '.mint', 'context-artifacts');
}

/**
 * 清理过期或容量压力下可回收的 context artifact。
 * @param options 清理模式、预计新增字节数和可注入的当前时间
 * @returns 清理统计
 */
export function cleanupArtifacts(options: ArtifactCleanupOptions): Promise<ArtifactCleanupReport> {
  return enqueueArtifactOperation(() => cleanupArtifactsUnlocked(options));
}

/**
 * 在写入大结果前检查容量并按需清理；低于阈值时不扫描删除。
 * @param additionalBytes 即将写入的序列化结果字节数
 * @returns 清理统计；空间不足时抛出错误
 */
export async function prepareArtifactWrite(
  additionalBytes: number,
): Promise<ArtifactCleanupReport> {
  return enqueueArtifactOperation(() => prepareArtifactWriteUnlocked(additionalBytes));
}

/**
 * 将一次 Artifact 操作排队，避免并发写入同时根据同一个目录快照做清理决策。
 * @param operation 要执行的文件操作
 * @returns 操作结果
 */
function enqueueArtifactOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = artifactOperationQueue.then(operation);
  artifactOperationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function prepareArtifactWriteUnlocked(
  additionalBytes: number,
): Promise<ArtifactCleanupReport> {
  const limits = getArtifactLimits();
  const totalBytes = await getArtifactTotalBytes();
  const projectedBytes = totalBytes + additionalBytes;
  if (projectedBytes < limits.cleanupThresholdBytes && projectedBytes <= limits.maxBytes) {
    return { scannedFiles: 0, deletedFiles: 0, reclaimedBytes: 0, totalBytes };
  }

  const report = await cleanupArtifactsUnlocked({
    mode: 'before_write',
    additionalBytes,
  });
  if (report.totalBytes + additionalBytes > limits.maxBytes) {
    throw new Error(
      `Artifact storage limit reached: ${report.totalBytes + additionalBytes} bytes projected`,
    );
  }
  return report;
}

async function writeArtifactFile(
  path: string,
  serialized: string,
  byteLength: number,
): Promise<void> {
  await enqueueArtifactOperation(async () => {
    await prepareArtifactWriteUnlocked(byteLength);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${path}.tmp`;
    try {
      await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, path);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  });
}

async function cleanupArtifactsUnlocked(
  options: ArtifactCleanupOptions,
): Promise<ArtifactCleanupReport> {
  const now = options.now ?? Date.now();
  const limits = getArtifactLimits();
  const files = await listArtifactFiles();
  const expired = files.filter((file) => isExpiredArtifact(file, now));
  const deleted = await deleteArtifactFiles(expired);
  const remaining = files.filter((file) => !deleted.has(file.path));
  let totalBytes = sumArtifactBytes(remaining);

  if (
    options.mode === 'before_write' &&
    totalBytes + (options.additionalBytes || 0) >= limits.cleanupTargetBytes
  ) {
    const candidates = remaining
      .filter((file) => now - file.lastAccessAt >= ARTIFACT_ACTIVE_GRACE_MS)
      .sort((left, right) => left.lastAccessAt - right.lastAccessAt);
    for (const file of candidates) {
      if (totalBytes + (options.additionalBytes || 0) < limits.cleanupTargetBytes) break;
      if (await deleteArtifactFile(file)) {
        deleted.add(file.path);
        totalBytes -= file.bytes;
      }
    }
  }

  await removeEmptyArtifactDirectories();

  return {
    scannedFiles: files.length,
    deletedFiles: deleted.size,
    reclaimedBytes: files
      .filter((file) => deleted.has(file.path))
      .reduce((sum, file) => sum + file.bytes, 0),
    totalBytes,
  };
}

/**
 * 删除 Artifact 根目录下已经没有任何内容的会话目录。
 * @returns 完成后的 Promise
 */
async function removeEmptyArtifactDirectories(): Promise<void> {
  const root = resolve(getArtifactRoot());
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    const children = await readdir(directory).catch(() => undefined);
    if (children?.length !== 0) continue;
    await rmdir(directory).catch(() => undefined);
  }
}

interface ArtifactLimits {
  maxBytes: number;
  cleanupThresholdBytes: number;
  cleanupTargetBytes: number;
}

function getArtifactLimits(): ArtifactLimits {
  const configuredMax = Number(process.env.AI_CHAT_CONTEXT_ARTIFACT_MAX_BYTES);
  const maxBytes =
    Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : ARTIFACT_MAX_BYTES;
  return {
    maxBytes,
    cleanupThresholdBytes: Math.floor(maxBytes * 0.8),
    cleanupTargetBytes: Math.floor(maxBytes * 0.7),
  };
}

async function listArtifactFiles(): Promise<ArtifactFile[]> {
  const root = resolve(getArtifactRoot());
  const files: ArtifactFile[] = [];
  const conversations = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const conversation of conversations) {
    if (!conversation.isDirectory()) continue;
    const directory = join(root, conversation.name);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const path = join(directory, entry.name);
      const metadata = await stat(path).catch(() => undefined);
      if (!metadata) continue;
      files.push({
        path,
        bytes: metadata.size,
        createdAt: parseArtifactCreatedAt(entry.name, metadata.birthtimeMs),
        lastAccessAt: metadata.mtimeMs,
      });
    }
  }
  return files;
}

function parseArtifactCreatedAt(fileName: string, fallback: number): number {
  const timestamp = Number.parseInt(basename(fileName).split('-')[0], 10);
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function isExpiredArtifact(file: ArtifactFile, now: number): boolean {
  return (
    now - file.lastAccessAt >= ARTIFACT_IDLE_TTL_MS || now - file.createdAt >= ARTIFACT_HARD_TTL_MS
  );
}

async function deleteArtifactFiles(files: ArtifactFile[]): Promise<Set<string>> {
  const deleted = new Set<string>();
  for (const file of files) {
    if (await deleteArtifactFile(file)) deleted.add(file.path);
  }
  return deleted;
}

async function deleteArtifactFile(file: ArtifactFile): Promise<boolean> {
  try {
    await unlink(file.path);
    return true;
  } catch {
    return false;
  }
}

function sumArtifactBytes(files: ArtifactFile[]): number {
  return files.reduce((sum, file) => sum + file.bytes, 0);
}

async function getArtifactTotalBytes(): Promise<number> {
  const files = await listArtifactFiles();
  return sumArtifactBytes(files);
}

/**
 * 将工具结果转换为发送给模型的消息内容。
 * 小结果保持原始 JSON；大结果写入临时 artifact，仅返回摘要、预览和 hash。
 * @param result 工具原始结果
 * @param options 摘要、会话和 artifact 配置
 * @returns 可直接作为 tool message content 的 JSON 字符串
 */
export async function serializeToolResultForContext(
  result: unknown,
  options: ToolResultMessageOptions = {},
): Promise<string> {
  const normalizedResult = normalizeArtifactResult(result);
  const serialized = JSON.stringify(normalizedResult) ?? String(normalizedResult);
  const byteLength = Buffer.byteLength(serialized, 'utf8');

  if (byteLength <= TOOL_RESULT_ARTIFACT_THRESHOLD || options.skipArtifact) {
    return serialized;
  }

  const conversationKey = (options.conversationId || 'unknown')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);
  const artifactDirectory = join(getArtifactRoot(), conversationKey);
  const artifactPath = join(artifactDirectory, `${Date.now()}-${randomUUID()}.json`);
  await writeArtifactFile(artifactPath, serialized, byteLength);

  const sha256 = createHash('sha256').update(serialized).digest('hex');
  return JSON.stringify({
    status: 'success',
    summary: options.summary || '工具结果过大，完整结果已保存为 artifact。',
    preview: serialized.slice(0, TOOL_RESULT_PREVIEW_LIMIT),
    artifact: {
      path: artifactPath,
      bytes: byteLength,
      sha256,
    },
  });
}
