import * as path from 'path';

export interface FileParseInput {
  name: string;
  content: Buffer;
  size: number;
}

export interface ParseResult {
  text: string;
  format: 'html' | 'txt' | 'md' | 'pdf';
  originalName: string;
  pageCount?: number; // PDF only
}

// 支持的文件扩展名白名单（不区分大小写）
const SUPPORTED_EXTENSIONS = new Set(['.htm', '.html', '.txt', '.md', '.pdf']);

export function isSupportedFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

export function getFileFormat(name: string): ParseResult['format'] | null {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.htm' || ext === '.html') return 'html';
  if (ext === '.txt') return 'txt';
  if (ext === '.md') return 'md';
  if (ext === '.pdf') return 'pdf';
  return null;
}

export async function parseFile(input: FileParseInput): Promise<ParseResult> {
  const format = getFileFormat(input.name);
  if (!format) {
    throw new Error(`不支持的文件类型: ${path.extname(input.name)}，支持: HTML/TXT/MD/PDF`);
  }

  switch (format) {
    case 'html':
      return { text: parseHtml(input.content), format, originalName: input.name };
    case 'txt':
      return { text: parseTxt(input.content), format, originalName: input.name };
    case 'md':
      return { text: parseMd(input.content), format, originalName: input.name };
    case 'pdf':
      return parsePdf(input.content, input.name);
  }
}

// ─── TXT 解析 ──────────────────────────────────────────

function parseTxt(content: Buffer): string {
  return content.toString('utf-8').trim();
}

// ─── MD 解析 ───────────────────────────────────────────

function parseMd(content: Buffer): string {
  return content.toString('utf-8');
}

// ─── HTML 结构保留解析 ─────────────────────────────────

function parseHtml(content: Buffer): string {
  let html = content.toString('utf-8');

  // 移除 script/style/iframe
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  // 保留标题: h1~h6
  html = html.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  html = html.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  html = html.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  html = html.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  html = html.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
  html = html.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');

  // 保留链接: <a href="url">text</a> → [text](url)
  html = html.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  html = html.replace(/<a[^>]*href='([^']*)'[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // 保留强调
  html = html.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
  html = html.replace(/<b>(.*?)<\/b>/gi, '**$1**');
  html = html.replace(/<em>(.*?)<\/em>/gi, '*$1*');
  html = html.replace(/<i>(.*?)<\/i>/gi, '*$1*');

  // 保留段落
  html = html.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');

  // 保留表格（简化为 Markdown 风格）
  html = html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent: string) => {
    return convertTableToMarkdown(tableContent);
  });

  // 列表处理（ul/ol）
  html = html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, listContent: string) => {
    return listContent.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  });
  html = html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, listContent: string) => {
    let index = 1;
    return listContent.replace(/<li[^>]*>(.*?)<\/li>/gi, (__, liContent: string) => {
      const text = liContent.replace(/<[^>]+>/g, '');
      return `${index++}. ${text}\n`;
    });
  });

  // 移除剩余所有 HTML 标签
  html = html.replace(/<[^>]+>/g, '');

  // 解码 HTML 实体
  html = decodeHtmlEntities(html);

  // 合并空白行
  html = html.replace(/\n{3,}/g, '\n\n');

  // 截取过长内容
  if (html.length > 100000) {
    html = html.substring(0, 100000) + '\n\n...(内容已截断)';
  }

  return html.trim();
}

function convertTableToMarkdown(tableHtml: string): string {
  const rows: string[] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;

  while ((match = trRegex.exec(tableHtml)) !== null) {
    const trContent = match[1];
    const cells: string[] = [];
    const cellRegex = /<t[dh][^>]*>(.*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(trContent)) !== null) {
      cells.push(cellMatch[1].trim().replace(/<[^>]+>/g, ''));
    }
    if (cells.length > 0) {
      rows.push('| ' + cells.join(' | ') + ' |');
    }
  }

  if (rows.length === 0) return '';

  // 表头后加分隔行
  const headerRow = rows[0];
  const colCount = headerRow.split('|').length - 2; // 去掉首尾空
  const separator = '| ' + Array(colCount).fill('---').join(' | ') + ' |';

  rows.splice(1, 0, separator);

  return rows.join('\n') + '\n\n';
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

// ─── PDF 解析（pdfjs-dist） ──────────────────────────

const MAX_PDF_PAGES = 100;

async function parsePdf(content: Buffer, name: string): Promise<ParseResult> {
  // 动态导入 pdfjs-dist legacy build（Node.js 兼容，内置 DOMMatrix polyfill）
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const doc = await pdfjsLib.getDocument({ data: content.buffer as ArrayBuffer }).promise;
  const totalPages = doc.numPages;
  const pagesToExtract = Math.min(totalPages, MAX_PDF_PAGES);

  const textParts: string[] = [];
  for (let i = 1; i <= pagesToExtract; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: unknown) => (item as { str: string }).str || '')
      .join(' ');
    textParts.push(`--- 第 ${i} 页 ---\n${pageText}`);
  }

  let fullText = textParts.join('\n\n').trim();

  if (!fullText) {
    fullText = '（PDF 未包含可提取的文本内容，可能为扫描件）';
  }

  if (totalPages > MAX_PDF_PAGES) {
    fullText += `\n\n（PDF 共 ${totalPages} 页，仅提取前 ${MAX_PDF_PAGES} 页）`;
  }

  return {
    text: fullText,
    format: 'pdf',
    originalName: name,
    pageCount: totalPages,
  };
}
