export interface WikiCitationMarker {
  refId: string;
  start: number;
  end: number;
  raw: string;
}

const incompleteCitationPattern = /\[(?:[CR]\d*|citation\s*:\s*\d*)\s*$/gi;

/** 判断裸数字标记是否为 Markdown 风格的有序步骤，而不是正文引用。 */
function isOrderedListMarker(value: string, marker: WikiCitationMarker): boolean {
  const lineStart = value.lastIndexOf('\n', marker.start - 1) + 1;
  const prefix = value.slice(lineStart, marker.start);
  return prefix.trim().length === 0 && /^\s+\S/.test(value.slice(marker.end));
}

/** 查找模型输出中可无歧义归一化为本轮 `C#` 的引用标记。 */
export function findWikiCitationMarkers(value: string): WikiCitationMarker[] {
  const markers: WikiCitationMarker[] = [];
  for (const match of value.matchAll(/\[(?:[CR](\d+)|citation\s*:\s*(\d+)|(\d+))\]/gi)) {
    const numericRefId = match[1] || match[2] || match[3];
    if (!numericRefId || match.index === undefined) continue;
    const marker: WikiCitationMarker = {
      refId: `C${numericRefId}`,
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
    };
    if (match[3] && isOrderedListMarker(value, marker)) continue;
    markers.push(marker);
  }
  return markers;
}

/** 将已验证的引用标记替换为规范展示文本，并移除未知引用标记。 */
export function normalizeWikiCitationMarkers(
  value: string,
  resolve: (refId: string) => string | undefined,
): string {
  const markers = findWikiCitationMarkers(value);
  let cursor = 0;
  let normalized = '';
  for (const marker of markers) {
    normalized += value.slice(cursor, marker.start);
    normalized += resolve(marker.refId) || '';
    cursor = marker.end;
  }
  normalized += value.slice(cursor);
  return normalized.replace(incompleteCitationPattern, '');
}
