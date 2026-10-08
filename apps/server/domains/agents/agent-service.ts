import * as agentRepo from '../../infrastructure/persistence/agent-repository.js';
import type { Agent } from '../../types.js';

// 编排 Agent 的默认系统提示词后缀
const ORCHESTRATOR_INSTRUCTION = `
你是一个编排助手（Orchestrator）。你的职责是：
1. 分析用户的问题，判断是否可以拆分为多个子任务。
2. 如果可以拆分，使用 invoke_agent 工具将子任务委派给最合适的专业 Agent。
3. 收集所有子任务的结果后进行汇总和整合，给出最终的完整回答。
4. 如果问题简单不需要拆分，直接使用你的通用知识回答。

注意：invoke_agent 是同步操作，等待返回结果后再继续。
一次可以并行调用多个 invoke_agent 来加速处理。`;

export function list(): Agent[] {
  return agentRepo.findAll();
}

export function findById(id: string): Agent | null {
  const agent = agentRepo.findById(id);
  if (!agent) return null;

  // 编排 Agent 自动追加编排指令
  if (agent.type === 'orchestrator') {
    const basePrompt = agent.systemPrompt || '';
    if (!basePrompt.includes(ORCHESTRATOR_INSTRUCTION.trim().slice(0, 20))) {
      return { ...agent, systemPrompt: basePrompt + '\n' + ORCHESTRATOR_INSTRUCTION };
    }
  }
  return agent;
}

export function create(data: {
  id: string;
  name: string;
  description?: string;
  type?: string;
  systemPrompt?: string | null;
  mcpServerIds?: string[];
  available?: boolean;
  triggerKeywords?: string[];
}): Agent {
  return agentRepo.create(data);
}

export function update(
  id: string,
  fields: Partial<{
    name: string;
    description: string;
    type: string;
    systemPrompt: string | null;
    mcpServerIds: string[];
    available: boolean;
    errorMessage: string | null;
    triggerKeywords: string[];
  }>,
): Agent | null {
  return agentRepo.update(id, fields);
}

export function remove(id: string): { changes: number } {
  return agentRepo.deleteById(id);
}
