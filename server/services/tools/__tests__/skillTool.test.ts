import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ──

const mockSkills: Record<string, string> = {};

vi.mock('../../../domains/skills/index.js', () => ({
  getSkill: vi.fn(async (name: string) => {
    if (mockSkills[name]) return { name, content: mockSkills[name] };
    return undefined;
  }),
}));

import { getSkill } from '../../../domains/skills/index.js';
import { SkillTool } from '../SkillTool.js';

const ctx = { conversationId: 'test-conv' };

describe('SkillTool', () => {
  const tool = new SkillTool();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockSkills).forEach((k) => delete mockSkills[k]);
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('invoke_skill');
    expect(tool.isReadOnly()).toBe(true);
    expect(tool.isIdempotent()).toBe(true);
    expect(tool.isConcurrencySafe()).toBe(true);
  });

  it('should load a skill by name', async () => {
    mockSkills['translate'] = '## Translate Skill\n\nTranslate text to Chinese.';

    const result = await tool.execute({ name: 'translate' }, ctx);
    expect(result.name).toBe('translate');
    expect(result.instruction).toBe('## Translate Skill\n\nTranslate text to Chinese.');
  });

  it('should append args to skill instruction', async () => {
    mockSkills['writing'] = '## Writing Skill\n\nImprove writing.';

    const result = await tool.execute({ name: 'writing', args: 'formal tone, concise' }, ctx);
    expect(result.instruction).toContain('Improve writing.');
    expect(result.instruction).toContain('用户参数: formal tone, concise');
  });

  it('should throw when skill not found', async () => {
    await expect(tool.execute({ name: 'no-exist' }, ctx)).rejects.toThrow('技能不存在: no-exist');
  });

  it('should validate input schema', () => {
    expect(tool.validate({ name: 'translate' }).valid).toBe(true);
    expect(tool.validate({}).valid).toBe(false);
  });
});
