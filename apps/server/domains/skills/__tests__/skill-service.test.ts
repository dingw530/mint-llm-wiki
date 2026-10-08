import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockFiles: Record<string, string> = {};
const mockExists: Record<string, boolean> = {};
const skillsDir = '/tmp/mint-test-skills';

vi.mock('fs/promises', () => ({
  readdir: vi.fn(async (dir: string) => {
    const keys = Object.keys(mockFiles)
      .map((k) => k.replace(/^.*[\\/]/, ''))
      .filter((k) => k !== '.gitkeep');
    return keys;
  }),
  readFile: vi.fn(async (path: string) => mockFiles[path] || ''),
  stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false })),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn((path: string) => {
    if (path in mockExists) return mockExists[path];
    return true;
  }),
}));

import * as skillService from '../skill-service.js';

describe('skillService', () => {
  beforeEach(() => {
    process.env.AI_CHAT_SKILLS_DIR = skillsDir;
    vi.clearAllMocks();
    Object.keys(mockFiles).forEach((k) => delete mockFiles[k]);
    Object.keys(mockExists).forEach((k) => delete mockExists[k]);
    skillService.clearSkillCache();
  });

  afterEach(() => {
    delete process.env.AI_CHAT_SKILLS_DIR;
  });

  describe('listSkills', () => {
    it('returns empty when skills dir not exists', async () => {
      mockExists[skillsDir] = false;
      const skills = await skillService.listSkills();
      expect(skills).toEqual([]);
    });

    it('returns skills with frontmatter', async () => {
      mockFiles[`${skillsDir}/translate.md`] = `---
name: 翻译
description: 翻译技能
---
# 翻译助手
你是一个专业翻译。`;
      mockExists[skillsDir] = true;

      const skills = await skillService.listSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('翻译');
      expect(skills[0].description).toBe('翻译技能');
      expect(skills[0].content).toContain('翻译助手');
    });

    it('handles skills without frontmatter', async () => {
      mockFiles[`${skillsDir}/hello.md`] = '# Hello World';
      mockExists[skillsDir] = true;

      const skills = await skillService.listSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('hello');
      expect(skills[0].content).toBe('# Hello World');
    });

    it('handles skill with incomplete frontmatter', async () => {
      mockFiles[`${skillsDir}/test.md`] = '---\nname: Test\n---\nContent body';
      mockExists[skillsDir] = true;

      const skills = await skillService.listSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('Test');
      expect(skills[0].description).toBe('Test skill'); // fallback to name-based default
      expect(skills[0].content).toBe('Content body');
    });
  });

  describe('getSkill', () => {
    it('returns a skill by name', async () => {
      mockFiles[`${skillsDir}/code-review.md`] = `---
name: code-review
description: Code review skill
---
Review the code`;
      mockExists[skillsDir] = true;

      const skill = await skillService.getSkill('code-review');
      expect(skill).toBeDefined();
      expect(skill!.description).toBe('Code review skill');
    });

    it('returns undefined for non-existent skill', async () => {
      mockExists[skillsDir] = false;
      const skill = await skillService.getSkill('nonexistent');
      expect(skill).toBeUndefined();
    });
  });

  describe('clearSkillCache', () => {
    it('forces reload on next list call', async () => {
      mockExists[skillsDir] = false;
      skillService.clearSkillCache();
      const skills = await skillService.listSkills();
      expect(skills).toEqual([]);
    });
  });
});
