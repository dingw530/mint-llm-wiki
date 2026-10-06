import { z } from 'zod';
import { BaseTool } from '../../../agent-runtime/tooling/base-tool.js';
import type { ToolContext } from '../../../agent-runtime/tooling/tool-contracts.js';
import { getSkill } from '../../../domains/skills/index.js';

// ── 输入 Schema ──

const SkillInputSchema = z.object({
  name: z.string().describe('技能名称，如 translate、writing'),
  args: z.string().optional().describe('传递给技能的参数，可选'),
});

type SkillInput = z.infer<typeof SkillInputSchema>;

// ── 输出类型 ──

interface SkillOutput {
  name: string;
  instruction: string;
}

// ── Skill 工具 ──

export class SkillTool extends BaseTool<SkillInput, SkillOutput> {
  readonly name = 'invoke_skill';
  readonly description =
    '加载并应用指定技能（skill），技能提供了特定任务的专业指导和上下文。调用后请严格按照技能的指令来响应用户';
  readonly inputSchema = SkillInputSchema;

  isReadOnly(): boolean {
    return true;
  }

  isIdempotent(): boolean {
    return true;
  }

  async execute(input: SkillInput, _context: ToolContext): Promise<SkillOutput> {
    const skill = await getSkill(input.name);
    if (!skill) {
      throw new Error(`技能不存在: ${input.name}`);
    }

    let instruction = skill.content;
    if (input.args) {
      instruction = `${instruction}\n\n用户参数: ${input.args}`;
    }

    return {
      name: skill.name,
      instruction,
    };
  }
}
