import path from 'node:path';
import { normalizeWikiCategories, readFileSync } from './wiki-files.js';

/** Preserve Wiki schema classification and the established folder fallback. */
export function inferWikiGraphNodeType(filename: string, wikiPath?: string): string {
  const parts = filename.split('/');
  const category = parts.length >= 2 ? parts[1] : '';
  if (!wikiPath) return category || '未分类';
  try {
    const schemaPath = path.join(wikiPath, '_schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as { categories?: unknown };
    const categories = normalizeWikiCategories(schema.categories);
    if (categories.some((item) => item.name === category)) return category;
  } catch {
    // An unavailable schema keeps the existing folder-derived node type.
  }
  return category || '未分类';
}
