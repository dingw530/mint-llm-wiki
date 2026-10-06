import * as path from 'node:path';

export const MINT_WIKI_PROTOCOL = 'mint-wiki:';
export const MINT_WIKI_ACTION = 'open';

export interface WikiLinkTarget {
  path: string;
  fragment?: string;
}

/**
 * 将 Wiki 相对路径规范化，并拒绝绝对路径和路径穿越片段。
 *
 * @param candidate Wiki 根目录下的候选路径
 * @returns 安全的 Wiki 相对路径；不安全时返回 null
 */
export function normalizeWikiRelativePath(candidate: string): string | null {
  const normalized = candidate.trim().replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:([/\\]|$)/.test(normalized))
    return null;

  const parts = normalized.split('/').filter((part) => part && part !== '.');
  if (parts.length === 0 || parts.some((part) => part === '..')) return null;
  return parts.join('/');
}

/**
 * 按 Wiki 写入规则规范化页面文件名。
 *
 * @param pagePath Wiki 根目录下的页面路径
 * @returns 文件名空格替换为连字符后的路径
 */
export function sanitizeWikiFilenamePath(pagePath: string): string {
  const parts = pagePath.split('/');
  if (parts.length > 2) {
    const filename = parts.pop()!;
    parts.push(filename.replace(/[\s]+/g, '-'));
  }
  return parts.join('/');
}

/**
 * 返回 lint 校验页面存在性时应尝试的路径候选。
 *
 * @param targetPath Wiki 根目录下的目标路径
 * @returns 原始路径和按写入规则清洗后的去重路径
 */
export function getWikiPathCandidates(targetPath: string): string[] {
  const sanitizedPath = sanitizeWikiFilenamePath(targetPath);
  return sanitizedPath === targetPath ? [targetPath] : [targetPath, sanitizedPath];
}

/**
 * 解码协议参数，兼容 Markdown 链路中的二次 URL 编码。
 *
 * @param value 待解码值
 * @returns 解码后的值；格式非法时返回 null
 */
function decodeWikiValue(value: string): string | null {
  let decoded = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      return null;
    }
  }
  return decoded;
}

/**
 * 解析 mint-wiki 协议链接。
 *
 * @param href Markdown href
 * @returns 协议目标；协议不匹配或路径不安全时返回 null
 */
export function parseMintWikiLink(href: string): WikiLinkTarget | null {
  if (!href.trim().startsWith(MINT_WIKI_PROTOCOL)) return null;

  try {
    const url = new URL(href.trim());
    if (url.protocol !== MINT_WIKI_PROTOCOL || url.hostname !== MINT_WIKI_ACTION) return null;

    const rawPath = url.searchParams.get('path');
    if (!rawPath) return null;
    const decodedPath = decodeWikiValue(rawPath);
    if (!decodedPath) return null;

    const targetPath = normalizeWikiRelativePath(decodedPath);
    if (!targetPath) return null;

    const fragmentValue = url.hash ? decodeWikiValue(url.hash.slice(1)) : null;
    return fragmentValue ? { path: targetPath, fragment: fragmentValue } : { path: targetPath };
  } catch {
    return null;
  }
}

/**
 * 生成规范的 mint-wiki 协议链接。
 *
 * @param targetPath Wiki 根目录下的目标路径
 * @param fragment 可选 Markdown 标题锚点
 * @returns 协议链接；路径不安全时返回 null
 */
export function createMintWikiLink(targetPath: string, fragment?: string): string | null {
  const normalizedPath = normalizeWikiRelativePath(targetPath);
  if (!normalizedPath) return null;

  const encodedPath = encodeURIComponent(normalizedPath);
  const encodedFragment = fragment ? `#${encodeURIComponent(fragment)}` : '';
  return `${MINT_WIKI_PROTOCOL}//${MINT_WIKI_ACTION}?path=${encodedPath}${encodedFragment}`;
}

/**
 * 解析协议链接和历史普通 Markdown 链接，统一返回 Wiki 根目录相对路径。
 *
 * @param sourcePath 当前页面路径
 * @param href Markdown href
 * @returns 规范化目标；非 Wiki 链接或不安全路径时返回 null
 */
export function resolveWikiMarkdownLink(sourcePath: string, href: string): WikiLinkTarget | null {
  const trimmedHref = href.trim();
  const protocolTarget = parseMintWikiLink(trimmedHref);
  if (protocolTarget) return protocolTarget;
  if (
    !trimmedHref ||
    /^(https?:|mailto:|tel:|\/\/)/i.test(trimmedHref) ||
    trimmedHref.startsWith('#')
  )
    return null;

  const [rawPath, rawFragment] = trimmedHref.split('#', 2);
  const decodedPath = decodeWikiValue(rawPath);
  if (!decodedPath) return null;

  const rootRelative =
    decodedPath.startsWith('/') ||
    decodedPath.startsWith('pages/') ||
    decodedPath.startsWith('sources/') ||
    decodedPath.startsWith('_');
  const baseParts = rootRelative ? [] : path.posix.dirname(sourcePath).split('/');
  const targetParts = rootRelative
    ? decodedPath.replace(/^\/+/, '').split('/')
    : decodedPath.split('/');
  const resolvedParts = [...baseParts];

  for (const part of targetParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (resolvedParts.length === 0) return null;
      resolvedParts.pop();
      continue;
    }
    resolvedParts.push(part);
  }

  const targetPath = normalizeWikiRelativePath(resolvedParts.join('/'));
  if (!targetPath) return null;
  const normalizedTarget = /\.[^./]+$/.test(path.posix.basename(targetPath))
    ? targetPath
    : `${targetPath}.md`;
  const fragment = rawFragment ? decodeWikiValue(rawFragment) : null;
  return fragment ? { path: normalizedTarget, fragment } : { path: normalizedTarget };
}
