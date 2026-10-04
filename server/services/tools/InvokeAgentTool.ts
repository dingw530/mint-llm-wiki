/**
 * InvokeAgentTool — 将子任务委派给专业 Agent 执行
 *
 * 作为一等 BaseTool 注册到 ToolRegistry，替代 orchestratorService.ts 中的硬编码 invoke_agent。
 * 子 agent 内部调用 reactChat() 走完整 ReAct 循环，返回结构化结果。
 */

import { z } from 'zod';
import { BaseTool } from './BaseTool.js';
import type { ToolContext } from './BaseTool.js';
import { runAgentChat } from '../../bootstrap/agent-runtime.js';
import * as agentService from '../../domains/agents/index.js';
import * as settingsService from '../../application/settings/settings-service.js';
import { AccumulatingSink } from '../../infrastructure/transports/sinks.js';

// ── 输入 Schema ──

const InvokeAgentInputSchema = z.object({
  agent_id: z.string().min(1, 'agent_id is required').describe('目标 Agent ID'),
  task: z.string().min(1, 'task is required').describe('要委派给该 Agent 的子任务描述'),
  timeout_ms: z.coerce
    .number()
    .int()
    .min(5000)
    .max(120000)
    .optional()
    .default(60000)
    .describe('超时时间（毫秒），默认 60000'),
  inherit_context: z.coerce
    .boolean()
    .optional()
    .default(false)
    .describe('是否继承父对话的上下文历史，默认 false'),
});

type InvokeAgentInput = z.infer<typeof InvokeAgentInputSchema>;

// ── 输出类型 ──

interface AgentResult {
  success: boolean;
  content: string;
  agentId: string;
  task: string;
  error?: string;
  duration: number;
  toolCalls: number;
  iterations: number;
}

// ── InvokeAgentTool ──

export class InvokeAgentTool extends BaseTool<InvokeAgentInput, AgentResult> {
  readonly name = 'invoke_agent';

  get description(): string {
    const agents = agentService
      .list()
      .filter((a) => a.available !== false && a.id !== 'orchestrator' && a.id !== 'general')
      .map((a) => `- ${a.id}: ${a.description || a.name}`)
      .join('\n');

    return `将子任务委派给指定的专业 Agent 执行，等待结果返回。
当需要其他 Agent 的专业能力时调用此工具。
支持并行调用多个子 Agent 来加速处理。

可用 Worker Agent：
${agents || '(暂无可用 Worker)'}
`;
  }

  readonly inputSchema = InvokeAgentInputSchema;

  /**
   * 并发安全：支持一次并行调用多个子 Agent
   */
  isConcurrencySafe(): boolean {
    return true;
  }

  async execute(input: InvokeAgentInput, context: ToolContext): Promise<AgentResult> {
    const startTime = Date.now();
    const { agent_id: agentId, task, timeout_ms: timeoutMs } = input;

    // 1. 校验 Agent 可用性
    const agent = agentService.findById(agentId);
    if (!agent) {
      return {
        success: false,
        content: '',
        agentId,
        task,
        error: `Agent "${agentId}" not found`,
        duration: Date.now() - startTime,
        toolCalls: 0,
        iterations: 0,
      };
    }
    if (agent.available === false) {
      return {
        success: false,
        content: '',
        agentId,
        task,
        error: `Agent "${agentId}" is not available`,
        duration: Date.now() - startTime,
        toolCalls: 0,
        iterations: 0,
      };
    }

    // 2. 获取 AI 设置
    const settings = settingsService.getAiSettings();
    if (!settings.apiUrl || !settings.apiKey) {
      return {
        success: false,
        content: '',
        agentId,
        task,
        error: 'AI API not configured',
        duration: Date.now() - startTime,
        toolCalls: 0,
        iterations: 0,
      };
    }

    // 4. 构造消息
    const messages = [];
    if (agent.systemPrompt) {
      messages.push({ role: 'system', content: agent.systemPrompt });
    }
    messages.push({ role: 'user', content: task });

    // 5. 设置超时信号
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = controller.signal;

    // 6. 走完整 ReAct 循环（或无工具直连路径）
    const sink = new AccumulatingSink();

    try {
      const result = await runAgentChat(
        messages,
        settings,
        sink,
        agentId,
        signal,
        context.conversationId,
      );

      return {
        success: true,
        content: result.content || '',
        agentId,
        task,
        duration: Date.now() - startTime,
        toolCalls: result.toolCalls?.length || 0,
        iterations: settings.reactMaxIterations || 5,
      };
    } catch (err) {
      return {
        success: false,
        content: '',
        agentId,
        task,
        error: `Agent execution failed: ${(err as Error).message}`,
        duration: Date.now() - startTime,
        toolCalls: 0,
        iterations: 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
