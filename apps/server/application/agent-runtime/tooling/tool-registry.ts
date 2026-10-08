/**
 * 工具注册表 - 管理所有工具的注册和查找
 * 参考 Claude Code 的工具注册系统设计
 */

import type { ToolHandler } from '../../../agent-runtime/tooling/tool-contracts.js';
import type { ToolDefinition } from '../../../types.js';
import { ToolRuntimeRegistry } from '@mint/tool-runtime';
import type { ToolRuntimeRegistrationOptions } from '@mint/tool-runtime';
import { createLogger } from '../../../infrastructure/observability/logger.js';

const log = createLogger('tool-registry');

// ── 工具注册表 ──

export class ToolRegistry extends ToolRuntimeRegistry<ToolHandler<unknown, unknown>> {
  private toolsByCategory = new Map<string, ToolHandler<unknown, unknown>[]>();

  /**
   * 注册工具
   */
  override register(
    tool: ToolHandler<unknown, unknown>,
    options: ToolRuntimeRegistrationOptions = { replace: true },
  ): void {
    if (this.has(tool.name) && options.replace) {
      log.warn(`Tool ${tool.name} already registered, overwriting`);
    }
    super.register(tool, options);
    log.debug(`Registered tool: ${tool.name}`);
  }

  override registerAll(tools: ToolHandler<unknown, unknown>[]): void {
    for (const tool of tools) this.register(tool);
  }

  /**
   * 按类别注册工具
   */
  registerByCategory(category: string, tools: ToolHandler<unknown, unknown>[]): void {
    this.toolsByCategory.set(category, tools);
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 获取所有已启用的工具
   */
  getAllEnabled(): ToolHandler<unknown, unknown>[] {
    return this.list().filter((tool) => tool.isEnabled());
  }

  /**
   * 获取所有工具定义（OpenAI function calling 格式）
   */
  getAllDefinitions(): ToolDefinition[] {
    return this.getAllEnabled().map((tool) => tool.getDefinition());
  }

  /**
   * 按类别获取工具定义
   */
  getDefinitionsByCategory(category: string): ToolDefinition[] {
    const tools = this.toolsByCategory.get(category) || [];
    return tools.filter((tool) => tool.isEnabled()).map((tool) => tool.getDefinition());
  }

  /**
   * 获取工具调用开始时展示给用户的摘要。
   * 摘要生成失败时返回 undefined，不影响工具执行。
   */
  getCallSummary(name: string, input: unknown): string | undefined {
    const tool = this.get(name);
    if (!tool) return undefined;

    try {
      return tool.getCallSummary(input);
    } catch (err) {
      log.warn(`Tool call summary failed: ${name}`, { error: String(err) });
      return undefined;
    }
  }

  /**
   * 获取工具执行完成后展示给用户的结果摘要。
   * 摘要生成失败时返回 undefined，不影响工具结果处理。
   */
  getResultSummary(name: string, result: unknown): string | undefined {
    const tool = this.get(name);
    if (!tool) return undefined;

    try {
      return tool.getResultSummary(result);
    } catch (err) {
      log.warn(`Tool result summary failed: ${name}`, { error: String(err) });
      return undefined;
    }
  }

  /**
   * 获取工具统计信息
   */
  getStats(): {
    total: number;
    enabled: number;
    byCategory: Record<string, number>;
  } {
    const allTools = this.list();
    const enabledTools = allTools.filter((tool) => tool.isEnabled());

    const byCategory: Record<string, number> = {};
    for (const [category, tools] of this.toolsByCategory) {
      byCategory[category] = tools.filter((tool) => tool.isEnabled()).length;
    }

    return {
      total: allTools.length,
      enabled: enabledTools.length,
      byCategory,
    };
  }
}

// 单例
export const toolRegistry = new ToolRegistry();
