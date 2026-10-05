import {
  existsSync,
  readdir,
  readFile,
  getSkillsDir,
  resolveSkillFile,
} from '../../infrastructure/filesystem/skills-directory.js';
import { createLogger } from '../../infrastructure/observability/logger.js';

const log = createLogger('skill-service');

// ── 类型定义 ──

export interface Skill {
  name: string;
  description: string;
  content: string;
  filePath: string;
}

// ── 配置 ──

// ── 简易 Frontmatter 解析 ──
// 只解析 --- 包裹的 YAML 块，提取 name 和 description

function parseFrontmatter(content: string): { name: string; description: string; body: string } {
  const lines = content.split('\n');
  if (lines.length < 2 || lines[0].trim() !== '---') {
    return { name: '', description: '', body: content };
  }

  let endIdx = -1;
  const frontLines: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
    frontLines.push(lines[i]);
  }

  if (endIdx === -1) {
    return { name: '', description: '', body: content };
  }

  const body = lines
    .slice(endIdx + 1)
    .join('\n')
    .trim();
  const frontText = frontLines.join('\n');

  return {
    name: extractField(frontText, 'name'),
    description: extractField(frontText, 'description'),
    body,
  };
}

function extractField(frontmatter: string, key: string): string {
  const regex = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm');
  const match = frontmatter.match(regex);
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

// ── 扫描加载 Skill ──

let cachedSkills: Skill[] | null = null;

/** Load one skill while preserving separate stat/read error handling. */
async function loadSkill(dir: string, entry: string): Promise<Skill | null> {
  const source = await resolveSkillFile(dir, entry).catch(() => null);
  if (!source) return null;
  try {
    const { filePath, skillName } = source;
    const content = await readFile(filePath, 'utf-8');
    const { name, description, body } = parseFrontmatter(content);
    const resolvedName = name || skillName;

    const skill: Skill = {
      name: resolvedName,
      description: description || `${resolvedName} skill`,
      content: body,
      filePath,
    };

    log.debug(`Loaded skill: ${resolvedName}`);
    return skill;
  } catch (err) {
    log.error(`Failed to load skill file: ${source.filePath}`, { error: String(err) });
  }
  return null;
}

export async function listSkills(): Promise<Skill[]> {
  if (cachedSkills) return cachedSkills;

  const dir = getSkillsDir();
  if (!existsSync(dir)) {
    log.debug(`Skills directory not found: ${dir}`);
    cachedSkills = [];
    return cachedSkills;
  }

  const skills: Skill[] = [];
  let entries: string[];

  try {
    entries = await readdir(dir);
  } catch (err) {
    log.error(`Failed to read skills directory: ${dir}`, { error: String(err) });
    cachedSkills = [];
    return cachedSkills;
  }

  for (const entry of entries) {
    const skill = await loadSkill(dir, entry);
    if (skill) skills.push(skill);
  }

  cachedSkills = skills;
  log.info(`Loaded ${skills.length} skills from ${dir}`);
  for (const s of skills) {
    console.log(`[skill] ${s.name} - ${s.description} (${s.filePath})`);
  }
  return skills;
}

export async function getSkill(name: string): Promise<Skill | undefined> {
  const skills = await listSkills();
  return skills.find((s) => s.name === name);
}

export function clearSkillCache(): void {
  cachedSkills = null;
}
