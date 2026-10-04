/**
 * 工具系统 - 导出所有工具和基础设施
 */

// 基础设施
export { BaseTool } from './BaseTool.js';
export type {
  ToolContext,
  ToolAuditEvent,
  ValidationResult,
  PermissionResult,
  ToolResult,
  ToolExecutionMode,
} from './BaseTool.js';
export { ToolRegistry, toolRegistry } from './ToolRegistry.js';
export { ToolExecutor, toolExecutor } from './ToolExecutor.js';
export type { ExecutionOptions, ExecutionResult } from './ToolExecutor.js';
export { ToolApprovalStore, toolApprovalStore } from './approvalStore.js';
export { getApprovalScopePath } from './approvalStore.js';
export type {
  ApprovalAction,
  ApprovalResumeContext,
  PendingToolApproval,
} from './approvalStore.js';
export { McpToolAdapter } from './McpToolAdapter.js';
export { DiscoverToolsTool, LoadToolTool } from './McpDiscoveryTools.js';

// 具体工具
export { HttpFetchTool } from './HttpFetchTool.js';
export { SkillTool } from './SkillTool.js';
export { BashTool } from './BashTool.js';
export { InvokeAgentTool } from './InvokeAgentTool.js';
export { ReadArtifactTool } from './ReadArtifactTool.js';
export { WriteFileTool } from './WriteFileTool.js';
export { WikiIngestTool } from './WikiIngestTool.js';
export { WikiLintTool } from './WikiLintTool.js';
export { WikiSearchTool } from './WikiSearchTool.js';
export { KnowledgeGraphTool } from './KnowledgeGraphTool.js';

// 工具实例（用于注册）
import { HttpFetchTool } from './HttpFetchTool.js';
import { SkillTool } from './SkillTool.js';
import { BashTool } from './BashTool.js';
import { InvokeAgentTool } from './InvokeAgentTool.js';
import { ReadFileTool } from './ReadFileTool.js';
import { ReadArtifactTool } from './ReadArtifactTool.js';
import { WriteFileTool } from './WriteFileTool.js';
import { WikiIngestTool } from './WikiIngestTool.js';
import { WikiLintTool } from './WikiLintTool.js';
import { WikiSearchTool } from './WikiSearchTool.js';
import { KnowledgeGraphTool } from './KnowledgeGraphTool.js';
import { toolRegistry } from './ToolRegistry.js';
import { DiscoverToolsTool, LoadToolTool } from './McpDiscoveryTools.js';

// 内置工具列表
export const builtinTools = [
  new HttpFetchTool(),
  new SkillTool(),
  new BashTool(),
  new InvokeAgentTool(),
  new ReadFileTool(),
  new ReadArtifactTool(),
  new WriteFileTool(),
  new WikiIngestTool(),
  new WikiLintTool(),
  new WikiSearchTool(),
  new KnowledgeGraphTool(),
  new DiscoverToolsTool(),
  new LoadToolTool(),
];

/**
 * 初始化工具系统
 * 注册所有内置工具
 */
export function initializeTools(): void {
  if (toolsInitialized) return;
  toolRegistry.registerAll(builtinTools);
  toolsInitialized = true;
  console.log(`[Tools] Initialized ${builtinTools.length} builtin tools`);
}

let toolsInitialized = false;
