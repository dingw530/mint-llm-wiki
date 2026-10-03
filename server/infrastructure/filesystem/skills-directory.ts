import { readdir, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** Resolve the existing environment override or per-user Skills directory. */
export function getSkillsDir(): string {
  return process.env.AI_CHAT_SKILLS_DIR || join(homedir(), '.mint', 'skills');
}
export { existsSync, readdir, readFile };

/** Resolve a standalone Markdown skill or a directory's SKILL.md without changing scan order. */
export async function resolveSkillFile(
  dir: string,
  entry: string,
): Promise<{ filePath: string; skillName: string } | null> {
  const entryPath = join(dir, entry);
  const entryStat = await stat(entryPath);
  if (entryStat.isFile() && entry.endsWith('.md'))
    return { filePath: entryPath, skillName: entry.replace(/\.md$/, '') };
  if (entryStat.isDirectory()) {
    const filePath = join(entryPath, 'SKILL.md');
    if (existsSync(filePath)) return { filePath, skillName: entry };
  }
  return null;
}
