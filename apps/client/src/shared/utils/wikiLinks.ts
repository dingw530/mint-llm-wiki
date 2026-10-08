const WIKI_LINK_PROTOCOL = 'mint-wiki:';
const WIKI_LINK_ACTION = 'open';

/**
 * 规范化 Wiki 协议路径并拒绝路径穿越。
 *
 * @param candidate Wiki 根目录下的候选路径
 * @returns 安全的 Wiki 相对路径；不安全时返回 null
 */
export function normalizeMintWikiPath(candidate: string): string | null {
  const normalized = candidate.trim().replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:([/\\]|$)/.test(normalized)) return null;
  const parts = normalized.split('/').filter((part) => part && part !== '.');
  if (parts.length === 0 || parts.some((part) => part === '..')) return null;
  return parts.join('/');
}

function decodeMintWikiValue(value: string): string | null {
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
 * 解析 Chat 中的 Mint Wiki 协议链接。
 *
 * @param href Markdown 链接地址
 * @returns Wiki 根目录下的相对路径；协议不匹配或路径不安全时返回 null
 */
export function parseMintWikiLink(href: string): string | null {
  if (!href.startsWith(WIKI_LINK_PROTOCOL)) return null;

  try {
    const url = new URL(href);
    const filePath = url.searchParams.get('path');
    if (url.protocol !== WIKI_LINK_PROTOCOL || url.hostname !== WIKI_LINK_ACTION || !filePath) return null;
    const decodedPath = decodeMintWikiValue(filePath);
    return decodedPath ? normalizeMintWikiPath(decodedPath) : null;
  } catch {
    return null;
  }
}

/**
 * 生成规范的 Mint Wiki 协议链接。
 *
 * @param filePath Wiki 根目录下的目标路径
 * @returns 协议链接；路径不安全时返回 null
 */
export function createMintWikiLink(filePath: string): string | null {
  const normalizedPath = normalizeMintWikiPath(filePath);
  return normalizedPath
    ? `${WIKI_LINK_PROTOCOL}//${WIKI_LINK_ACTION}?path=${encodeURIComponent(normalizedPath)}`
    : null;
}
