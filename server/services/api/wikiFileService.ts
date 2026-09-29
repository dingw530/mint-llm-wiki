import * as fs from 'fs';
import * as path from 'path';
import type { AiSettings } from '../../types.js';
import { isSupportedFile } from '../utils/fileParseService.js';
import { isPathSafe } from '../utils/pathSecurity.js';
import type { WikiSourceSegment, WikiUploadInput } from './wikiIngestionTypes.js';

export class WikiUploadValidationError extends Error {
  readonly status = 400;
}

const WIKI_INGESTION_STAGING_DIR = 'ingestion-pending';

/**
 * 校验上传文件的格式和业务大小限制。
 */
export function validateWikiUpload(
  settings: Pick<AiSettings, 'wikiMaxFileSize'>,
  input: WikiUploadInput,
): void {
  if (!isSupportedFile(input.name)) {
    throw new WikiUploadValidationError(`不支持的文件类型: ${input.name}，支持: HTML/TXT/MD/PDF`);
  }

  const maxSize = settings.wikiMaxFileSize;
  if (maxSize > 0 && input.size > maxSize) {
    const sizeMB = (input.size / 1048576).toFixed(1);
    const limitMB = (maxSize / 1048576).toFixed(1);
    throw new WikiUploadValidationError(`文件大小 ${sizeMB}MB 超过限制 ${limitMB}MB`);
  }
}

/**
 * 暂存上传文件，并返回相对于 Wiki 根目录的规范化路径。
 *
 * 正式摄入成功前，上传文件只能进入暂存目录，避免失败任务污染 sources/。
 */
export function archiveWikiUpload(
  wikiPath: string,
  settings: Pick<AiSettings, 'wikiMaxFileSize'>,
  input: WikiUploadInput,
): string {
  validateWikiUpload(settings, input);
  return stageWikiRawFile(wikiPath, input.name, input.buffer);
}

/**
 * 读取已归档的 Wiki 原始文件，拒绝 Wiki 根目录之外的路径。
 */
export function readArchivedWikiFile(wikiPath: string, relativePath: string): Buffer {
  if (!isPathSafe(wikiPath, relativePath)) {
    throw new Error('归档文件路径不安全');
  }
  return fs.readFileSync(path.resolve(wikiPath, relativePath));
}

/**
 * 将多个来源片段拼装为统一的 source 文本。
 */
export function buildWikiSourceText(baseText: string, segments: WikiSourceSegment[] = []): string {
  let combinedSource = baseText || '';
  for (const segment of segments) {
    const heading = segment.kind === 'url' ? '来源' : '文件';
    combinedSource += `\n\n---\n## ${heading}：${segment.name}\n\n${segment.content}`;
  }
  return combinedSource;
}

/**
 * 统一原始文件归档逻辑，确保所有入口遵循相同命名与防覆盖策略。
 */
export function archiveWikiRawFile(wikiPath: string, fileName: string, buffer: Buffer): string {
  return writeWikiRawFile(wikiPath, 'sources', fileName, buffer);
}

/**
 * 将原始文件写入 Wiki 摄入暂存目录。
 *
 * @param wikiPath Wiki 根目录
 * @param fileName 原始文件名
 * @param buffer 文件内容
 * @returns 暂存文件相对于 Wiki 根目录的路径
 */
export function stageWikiRawFile(wikiPath: string, fileName: string, buffer: Buffer): string {
  return writeWikiRawFile(wikiPath, WIKI_INGESTION_STAGING_DIR, fileName, buffer);
}

/**
 * 将暂存文件原子移动到正式 sources/ 目录。
 *
 * @param wikiPath Wiki 根目录
 * @param relativePath 暂存或旧版正式文件路径
 * @returns 正式文件相对于 Wiki 根目录的路径
 */
export function finalizeWikiSourceFile(wikiPath: string, relativePath: string): string {
  return finalizeWikiSourceFileTo(wikiPath, relativePath);
}

/**
 * Finalize a staged source at a stable target, optionally retaining the input for job recovery.
 */
export function finalizeWikiSourceFileTo(
  wikiPath: string,
  relativePath: string,
  targetRelativePath?: string,
  retainStagedFile = false,
): string {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!isStagedWikiFile(normalized)) return normalized;

  const stagedPath = resolveWikiRelativePath(wikiPath, normalized);
  const sourcesDir = path.join(wikiPath, 'sources');
  ensureDir(sourcesDir);
  const targetRelative =
    targetRelativePath?.replace(/\\/g, '/') ||
    path
      .relative(wikiPath, ensureUniqueFilePath(path.join(sourcesDir, path.basename(stagedPath))))
      .replace(/\\/g, '/');
  if (!targetRelative.startsWith('sources/')) throw new Error('正式 Source 路径无效');
  const targetPath = resolveWikiRelativePath(wikiPath, targetRelative);

  if (fs.existsSync(targetPath)) {
    if (
      !fs.existsSync(stagedPath) ||
      !fs.readFileSync(targetPath).equals(fs.readFileSync(stagedPath))
    ) {
      throw new Error(`正式 Source 路径已存在且内容不匹配: ${targetRelative}`);
    }
    return targetRelative;
  }
  if (!fs.existsSync(stagedPath)) throw new Error(`摄入暂存文件不存在: ${normalized}`);

  if (retainStagedFile) {
    copyFileAtomically(stagedPath, targetPath);
  } else {
    fs.renameSync(stagedPath, targetPath);
  }
  return targetRelative;
}

function copyFileAtomically(sourcePath: string, targetPath: string): void {
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  try {
    fs.copyFileSync(sourcePath, temporaryPath);
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

/**
 * 删除摄入暂存文件；传入正式 sources/ 路径时不会删除任何文件。
 *
 * @param wikiPath Wiki 根目录
 * @param relativePath 暂存或正式文件路径
 */
export function discardWikiStagedFile(wikiPath: string, relativePath: string): void {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!isStagedWikiFile(normalized)) return;
  const stagedPath = resolveWikiRelativePath(wikiPath, normalized);
  if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath);
}

/**
 * 回滚当前摄入刚提交的 source 文件。
 *
 * @param wikiPath Wiki 根目录
 * @param relativePath 已提交的 source 相对路径
 */
export function rollbackWikiSourceFile(wikiPath: string, relativePath: string): void {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized.startsWith('sources/') || !isPathSafe(wikiPath, normalized)) return;
  const sourcePath = path.resolve(wikiPath, normalized);
  if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
}

/**
 * 将规范化后的 source 文本保存到摄入暂存目录。
 *
 * @param wikiPath Wiki 根目录
 * @param sourceText 规范化后的原文
 * @param title source 标题
 * @param filenameHint 文件名提示
 * @returns 暂存文件相对于 Wiki 根目录的路径
 */
export function stageWikiSourceText(
  wikiPath: string,
  sourceText: string,
  title: string,
  filenameHint?: string,
): string {
  return writeWikiSourceText(wikiPath, WIKI_INGESTION_STAGING_DIR, sourceText, title, filenameHint);
}

function writeWikiRawFile(
  wikiPath: string,
  directory: string,
  fileName: string,
  buffer: Buffer,
): string {
  const targetDir = path.join(wikiPath, directory);
  ensureDir(targetDir);
  const date = new Date().toISOString().slice(0, 10);
  const ext = path.extname(fileName).toLowerCase();
  const baseName = slugifyFileName(stripDatePrefixes(path.basename(fileName, ext)));
  const resolvedPath = ensureUniqueFilePath(path.join(targetDir, `${date}-${baseName}${ext}`));
  fs.writeFileSync(resolvedPath, buffer);
  return path.relative(wikiPath, resolvedPath).replace(/\\/g, '/');
}

/**
 * 将规范化后的 source 文本保存为不可变编译输入。
 */
export function saveWikiSourceText(
  wikiPath: string,
  sourceText: string,
  title: string,
  filenameHint?: string,
): string {
  return writeWikiSourceText(wikiPath, 'sources', sourceText, title, filenameHint);
}

function writeWikiSourceText(
  wikiPath: string,
  directory: string,
  sourceText: string,
  title: string,
  filenameHint?: string,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const hintBase = filenameHint
    ? stripDatePrefixes(path.basename(filenameHint, path.extname(filenameHint)))
    : title;
  const sourceContent = `# ${title || '未命名资料'}\n\n> 原始资料，不可变。摄入日期：${date}\n\n${sourceText}\n`;
  return writeWikiRawFile(
    wikiPath,
    directory,
    `${hintBase}.md`,
    Buffer.from(sourceContent, 'utf-8'),
  );
}

export function isStagedWikiFile(relativePath: string): boolean {
  return relativePath.startsWith(`${WIKI_INGESTION_STAGING_DIR}/`);
}

function resolveWikiRelativePath(wikiPath: string, relativePath: string): string {
  if (!isPathSafe(wikiPath, relativePath)) throw new Error('归档文件路径不安全');
  return path.resolve(wikiPath, relativePath);
}

function slugifyFileName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9一-龥]+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  );
}

function stripDatePrefixes(name: string): string {
  let normalized = name;
  while (/^\d{4}-\d{2}-\d{2}-/.test(normalized)) {
    normalized = normalized.slice(11);
  }
  return normalized;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureUniqueFilePath(filePath: string): string {
  if (!fs.existsSync(filePath)) return filePath;

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  let counter = 2;
  let nextPath = path.join(dir, `${base}-${counter}${ext}`);
  while (fs.existsSync(nextPath)) {
    counter += 1;
    nextPath = path.join(dir, `${base}-${counter}${ext}`);
  }
  return nextPath;
}
