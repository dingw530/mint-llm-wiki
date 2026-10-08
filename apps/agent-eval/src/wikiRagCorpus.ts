import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WikiIngestionRequest, WikiIngestionResult } from 'mint-server/eval';

export interface PreparedSource {
  sourceFile: string;
  format: string;
  pageFile: string;
  title: string;
  bytes: number;
  contentHash: string;
}

export interface PreparedCorpusReport {
  rawDir: string;
  outputDir: string;
  preparedAt: string;
  sources: PreparedSource[];
}

export interface IngestedCorpusReport {
  rawDir: string;
  outputDir: string;
  ingestedAt: string;
  sources: Array<PreparedSource & { result: WikiIngestionResult }>;
}

export interface IngestionProgressUpdate {
  phase: 'source_started' | 'source_completed';
  completedSources: number;
  totalSources: number;
  sourceFile: string;
  pageCount?: number;
}

interface SourceText {
  text: string;
  title: string;
}

const SUPPORTED_FORMATS = new Set(['.md', '.txt', '.html', '.htm', '.pdf']);

const WIKI_SCHEMA = {
  version: 1,
  description: 'Mint agent-eval isolated Wiki fixture',
  sourcesDir: 'sources',
  pagesDir: 'pages',
  categories: [{ name: 'eval', description: 'Evaluation corpus', include: [], exclude: [] }],
  tags: [],
  pageTemplate: { required_frontmatter: ['title', 'created', 'source'] },
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function parseHtml(value: string): string {
  return decodeHtmlEntities(value
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, heading: string) => `${'#'.repeat(Number(level))} ${heading}\n\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    .replace(/<br\s*\/?>(?=.)/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim());
}

function isPageMarker(value: string): boolean {
  return /^(?:#+\s*)?(?:=+\s*)?第\s*\d+\s*页(?:\s*=+)?$/.test(value.trim());
}

function titleFromText(text: string, fallback: string): string {
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading && !isPageMarker(heading)) return heading;
  const firstUsefulLine = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !isPageMarker(line) && !/^[-_=]+$/.test(line));
  return firstUsefulLine || fallback;
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ').trim();
    if (text) pages.push(`## 第 ${pageNumber} 页\n\n${text}`);
  }
  return pages.join('\n\n') || '（PDF 未包含可提取的文本内容）';
}

async function readSource(filePath: string): Promise<SourceText> {
  const extension = path.extname(filePath).toLowerCase();
  const buffer = await fs.readFile(filePath);
  const rawText = extension === '.pdf'
    ? await parsePdf(buffer)
    : buffer.toString('utf8');
  const text = extension === '.html' || extension === '.htm' ? parseHtml(rawText) : rawText.trim();
  const htmlTitle = extension === '.html' || extension === '.htm'
    ? rawText.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    : undefined;
  const inferredTitle = htmlTitle ? decodeHtmlEntities(htmlTitle).trim() : titleFromText(text, path.basename(filePath, extension));
  return { text, title: inferredTitle.length <= 120 ? inferredTitle : path.basename(filePath, extension) };
}

function safePageName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'source';
}

function pageContent(source: string, title: string, text: string): string {
  const escapedTitle = title.replaceAll('"', '\\"');
  return `---\ntitle: "${escapedTitle}"\ncreated: "eval"\nsource: "${source.replaceAll('"', '\\"')}"\n---\n\n${text}\n`;
}

async function prepareSource(rawDir: string, outputDir: string, fileName: string): Promise<PreparedSource> {
  const sourcePath = path.join(rawDir, fileName);
  const buffer = await fs.readFile(sourcePath);
  const parsed = await readSource(sourcePath);
  const pageFile = `pages/eval/${safePageName(fileName)}.md`;
  const pagePath = path.join(outputDir, pageFile);
  await fs.mkdir(path.dirname(pagePath), { recursive: true });
  await fs.mkdir(path.join(outputDir, 'sources'), { recursive: true });
  await fs.copyFile(sourcePath, path.join(outputDir, 'sources', fileName));
  await fs.writeFile(pagePath, pageContent(fileName, parsed.title, parsed.text), 'utf8');
  return {
    sourceFile: fileName,
    format: path.extname(fileName).slice(1).toLowerCase(),
    pageFile,
    title: parsed.title,
    bytes: buffer.byteLength,
    contentHash: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

async function listSourceFiles(rawDir: string): Promise<string[]> {
  const entries = await fs.readdir(rawDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && SUPPORTED_FORMATS.has(path.extname(entry.name).toLowerCase()))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

async function initializeWikiFixture(outputDir: string): Promise<void> {
  await fs.mkdir(path.join(outputDir, 'sources'), { recursive: true });
  await fs.mkdir(path.join(outputDir, 'pages'), { recursive: true });
  await fs.writeFile(path.join(outputDir, '_schema.json'), `${JSON.stringify(WIKI_SCHEMA, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, '_index.md'), '# Wiki 首页\n\n## 评测语料\n', 'utf8');
  await fs.writeFile(path.join(outputDir, '_manifest.json'), `${JSON.stringify({ version: 1, entries: [] }, null, 2)}\n`, 'utf8');
}

async function assertEmptyIngestionDirectory(outputDir: string): Promise<void> {
  try {
    const entries = await fs.readdir(outputDir);
    if (entries.length > 0) throw new Error(`Ingestion output must be empty: ${outputDir}`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('Ingestion output must be empty:')) throw error;
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
}

/** 清空隔离 Wiki 摄入目录，拒绝清理根目录、工作区和临时目录本身。 */
export async function clearIngestionDirectory(outputDir: string): Promise<void> {
  const resolvedOutputDir = path.resolve(outputDir);
  const forbiddenPaths = new Set([path.parse(resolvedOutputDir).root, process.cwd(), os.tmpdir()]);
  if (forbiddenPaths.has(resolvedOutputDir)) {
    throw new Error(`Refusing to clear unsafe ingestion output: ${resolvedOutputDir}`);
  }
  await fs.rm(resolvedOutputDir, { recursive: true, force: true });
}

async function writePreparedMetadata(outputDir: string, sources: PreparedSource[]): Promise<void> {
  const index = ['# Wiki 首页', '', '## 评测语料', ...sources.map(source => `- [${source.title}](${source.pageFile})`), ''].join('\n');
  const entries = sources.map((source, index) => ({
    id: `eval-${String(index + 1).padStart(2, '0')}`,
    sourceFile: `sources/${source.sourceFile}`,
    archivedFiles: [`sources/${source.sourceFile}`],
    pageFiles: [source.pageFile],
    summary: 'Prepared evaluation source',
    createdAt: 'eval',
  }));
  await fs.writeFile(path.join(outputDir, '_index.md'), `${index}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, '_manifest.json'), `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, 'utf8');
}

/** 将固定原始语料准备成可供 Mint Wiki 搜索使用的隔离 fixture。 */
export async function prepareWikiRagCorpus(rawDir: string, outputDir: string): Promise<PreparedCorpusReport> {
  const files = await listSourceFiles(rawDir);
  await fs.mkdir(outputDir, { recursive: true });
  await initializeWikiFixture(outputDir);
  await fs.mkdir(path.join(outputDir, 'pages'), { recursive: true });
  const sources: PreparedSource[] = [];
  for (const fileName of files) sources.push(await prepareSource(rawDir, outputDir, fileName));
  await writePreparedMetadata(outputDir, sources);
  const report: PreparedCorpusReport = { rawDir, outputDir, preparedAt: new Date().toISOString(), sources };
  await fs.writeFile(path.join(outputDir, 'prepared-manifest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

/** 按 Mint 正式摄入服务处理固定语料，并保留原始文件名以支持来源追溯。 */
export async function ingestWikiRagCorpus<TSettings>(
  rawDir: string,
  outputDir: string,
  settings: TSettings,
  ingestSource: (settings: TSettings, wikiPath: string, request: WikiIngestionRequest) => Promise<WikiIngestionResult>,
  options: { clean?: boolean; onProgress?: (update: IngestionProgressUpdate) => void } = {},
): Promise<IngestedCorpusReport> {
  const files = await listSourceFiles(rawDir);
  if (options.clean) await clearIngestionDirectory(outputDir);
  await assertEmptyIngestionDirectory(outputDir);
  await fs.mkdir(outputDir, { recursive: true });
  await initializeWikiFixture(outputDir);
  const sources: Array<PreparedSource & { result: WikiIngestionResult }> = [];
  for (const [index, fileName] of files.entries()) {
    options.onProgress?.({ phase: 'source_started', completedSources: index, totalSources: files.length, sourceFile: fileName });
    const sourcePath = path.join(rawDir, fileName);
    const buffer = await fs.readFile(sourcePath);
    const parsed = await readSource(sourcePath);
    const relativeSourcePath = `sources/${fileName}`;
    await fs.writeFile(path.join(outputDir, relativeSourcePath), buffer);
    const result = await ingestSource(settings, outputDir, {
      sourceText: parsed.text,
      sourceTitle: parsed.title,
      sourceFilenameHint: fileName,
      archivedFiles: [{ name: fileName, existingRelativePath: relativeSourcePath }],
    });
    sources.push({
      sourceFile: fileName,
      format: path.extname(fileName).slice(1).toLowerCase(),
      pageFile: result.pages[0]?.filename || '',
      title: parsed.title,
      bytes: buffer.byteLength,
      contentHash: crypto.createHash('sha256').update(buffer).digest('hex'),
      result,
    });
    options.onProgress?.({ phase: 'source_completed', completedSources: index + 1, totalSources: files.length, sourceFile: fileName, pageCount: result.pages.length });
  }
  const report: IngestedCorpusReport = { rawDir, outputDir, ingestedAt: new Date().toISOString(), sources };
  await fs.writeFile(path.join(outputDir, 'ingested-manifest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}
