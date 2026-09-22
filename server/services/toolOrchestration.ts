import type { ToolCall, ToolDefinition } from '../types.js';
import { mcpService } from './api/mcpService.js';
import * as agentRepo from '../repositories/agentRepository.js';
import {
  McpToolAdapter,
  toolRegistry as runtimeRegistry,
  toolExecutor,
  toolApprovalStore,
} from './tools/index.js';
import { getApprovalScopePath } from './tools/approvalStore.js';
import type { ApprovalResumeContext } from './tools/approvalStore.js';
import type { RuntimeContext } from './runtime/runtimeContext.js';

// 获取 Agent 可用的工具定义列表
export async function getAllToolDefinitions(agentId?: string): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];

  // 全局工具，所有 Agent 可用
  if (isLegacyMcpEnabled()) syncMcpTools();
  else syncLoadedMcpTools();
  const globalToolNames = [
    'http_fetch',
    'invoke_skill',
    'bash',
    'invoke_agent',
    'read_artifact',
    'write_file',
    'wiki_ingest',
    'wiki_lint',
    'wiki_search',
    'knowledge_graph',
    'discover_tools',
    'load_tool',
  ];
  for (const name of globalToolNames) {
    const def = getToolDefinitionSafe(name);
    if (def) tools.push(def);
  }

  // 默认只注入目录发现工具；旧行为必须显式开启兼容开关。
  if (!agentId || agentId === 'general') {
    return isLegacyMcpEnabled() ? appendMcpTools(tools) : appendLoadedMcpTools(tools);
  }

  // 自定义 Agent：根据 mcp_server_ids 加载其全部工具
  const agent = agentRepo.findById(agentId);
  if (!agent || !agent.available) return tools;

  // 加载 Agent 绑定的 MCP Server 的全部工具
  return isLegacyMcpEnabled()
    ? appendMcpTools(tools, agent.mcpServerIds || [])
    : appendLoadedMcpTools(tools, agent.mcpServerIds || []);
}

function isLegacyMcpEnabled(): boolean {
  return process.env.AI_CHAT_MCP_LEGACY_TOOLS === 'true';
}

/**
 * Appends connected MCP tools, optionally restricting them to server names.
 * @param tools Existing tool definitions to extend.
 * @param serverIds Optional MCP server name allowlist.
 * @returns The extended tool definitions.
 */
function syncLoadedMcpTools(): void {
  const getLoadedToolNames = (
    mcpService as typeof mcpService & {
      getLoadedToolNames?: () => string[];
    }
  ).getLoadedToolNames;
  const getToolRecord = (
    mcpService as typeof mcpService & {
      getToolRecord?: (name: string) => unknown;
    }
  ).getToolRecord;
  if (!getLoadedToolNames || !getToolRecord) return;
  for (const fullName of getLoadedToolNames.call(mcpService)) {
    const record = getToolRecord.call(mcpService, fullName) as
      ConstructorParameters<typeof McpToolAdapter>[0] | undefined;
    if (record && !runtimeRegistry.has(fullName))
      runtimeRegistry.register(new McpToolAdapter(record));
  }
}

function syncMcpTools(serverIds?: string[]): void {
  const getAllToolNames = (
    mcpService as typeof mcpService & {
      getAllToolNames?: (servers?: string[]) => string[];
    }
  ).getAllToolNames;
  const getToolRecord = (
    mcpService as typeof mcpService & {
      getToolRecord?: (name: string) => unknown;
    }
  ).getToolRecord;
  if (!getAllToolNames || !getToolRecord) return;
  for (const fullName of getAllToolNames.call(mcpService, serverIds)) {
    const record = getToolRecord.call(mcpService, fullName) as
      ConstructorParameters<typeof McpToolAdapter>[0] | undefined;
    if (record && !runtimeRegistry.has(fullName))
      runtimeRegistry.register(new McpToolAdapter(record));
  }
}

function appendMcpTools(tools: ToolDefinition[], serverIds?: string[]): ToolDefinition[] {
  const getAllToolNames = (
    mcpService as typeof mcpService & {
      getAllToolNames?: (servers?: string[]) => string[];
    }
  ).getAllToolNames;
  if (!getAllToolNames) return tools;
  for (const fullName of getAllToolNames.call(mcpService, serverIds)) {
    const definition = getToolDefinitionSafe(fullName);
    if (definition) tools.push(definition);
  }
  return tools;
}

function appendLoadedMcpTools(tools: ToolDefinition[], serverIds?: string[]): ToolDefinition[] {
  const getLoadedToolNames = (
    mcpService as typeof mcpService & {
      getLoadedToolNames?: () => string[];
    }
  ).getLoadedToolNames;
  if (!getLoadedToolNames) return tools;
  for (const fullName of getLoadedToolNames.call(mcpService)) {
    const serverName = fullName.split('__')[0];
    if (serverIds && !serverIds.includes(serverName)) continue;
    const definition = getToolDefinitionSafe(fullName);
    if (definition) tools.push(definition);
  }
  return tools;
}

// 根据 tool_call 分发执行对应的工具函数
export interface ExecuteToolOptions {
  approvalGranted?: boolean;
  approvalContext?: ApprovalResumeContext;
  runtimeContext?: RuntimeContext;
}

/**
 * 通过统一 Runtime 执行工具并保留结构化执行结果。
 * @param toolCall 原始工具调用
 * @param conversationId 会话 ID
 * @param options 执行授权选项
 * @returns Runtime 执行结果
 */
export async function executeToolDetailed(
  toolCall: ToolCall,
  conversationId = '',
  options: ExecuteToolOptions = {},
) {
  const { name } = toolCall.function;

  if (isLegacyMcpEnabled()) syncMcpTools();
  else syncLoadedMcpTools();

  // 1. 优先从新工具系统执行内置工具
  if (runtimeRegistry.has(name)) {
    const context = {
      conversationId,
      runtimeContext: options.runtimeContext,
      approvalGranted:
        options.approvalGranted === undefined
          ? toolApprovalStore.isGranted(conversationId, toolCall)
          : options.approvalGranted,
      requestApproval: ({ reason }: { reason: string }) =>
        toolApprovalStore.create({
          conversationId,
          toolCall,
          reason,
          resume: options.approvalContext,
          scopePath: getApprovalScopePath(toolCall),
        }),
    };
    return toolExecutor.executeFromToolCall(toolCall, context);
  }

  return { success: false, error: `未知工具: ${name}`, duration: 0 };
}

/**
 * 兼容旧调用方的工具执行 facade。
 * @param toolCall 原始工具调用
 * @param conversationId 会话 ID
 * @param options 执行授权选项
 * @returns 工具数据或结构化错误
 */
export async function executeTool(
  toolCall: ToolCall,
  conversationId = '',
  options: ExecuteToolOptions = {},
): Promise<unknown> {
  const result = await executeToolDetailed(toolCall, conversationId, options);
  if (result.success) return result.data;
  return {
    error: result.error,
    ...(result.approvalRequired ? { approvalRequired: result.approvalRequired } : {}),
  };
}

/**
 * 获取工具调用开始时展示给用户的摘要。
 * 参数解析或摘要生成失败时返回 undefined，不阻断工具执行。
 */
export function getToolCallSummary(toolCall: ToolCall): string | undefined {
  const toolName = toolCall.function.name;
  if (!runtimeRegistry.has(toolName)) return undefined;

  try {
    return runtimeRegistry.getCallSummary(toolName, JSON.parse(toolCall.function.arguments));
  } catch {
    return undefined;
  }
}

/**
 * 获取工具执行完成后展示给用户的结果摘要。
 * 摘要生成失败时返回 undefined，不影响工具结果处理。
 */
export function getToolResultSummary(toolCall: ToolCall, result: unknown): string | undefined {
  const toolName = toolCall.function.name;
  if (!runtimeRegistry.has(toolName)) return undefined;
  return runtimeRegistry.getResultSummary(toolName, result);
}

/**
 * 安全获取工具定义，工具未注册或未启用时返回 undefined
 */
function getToolDefinitionSafe(name: string): ToolDefinition | undefined {
  const tool = runtimeRegistry.get(name);
  if (!tool || !tool.isEnabled()) return undefined;
  return tool.getDefinition();
}
