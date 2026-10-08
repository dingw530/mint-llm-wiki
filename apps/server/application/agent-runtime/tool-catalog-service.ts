import type { ToolHandler } from '../../agent-runtime/tooling/tool-contracts.js';
import type { McpToolRecord } from '../../agent-runtime/tooling/tool-contracts.js';
import type { ToolCall, ToolDefinition } from '../../types.js';

export interface McpToolCatalogPort {
  getLoadedToolNames?: () => string[];
  getToolRecord?: (name: string) => McpToolRecord | undefined;
  getAllToolNames?: (serverIds?: string[]) => string[];
}

export interface ToolCatalogRegistryPort {
  get(name: string): ToolHandler<unknown, unknown> | undefined;
  has(name: string): boolean;
  register(tool: ToolHandler<unknown, unknown>): void;
}

export interface AgentToolScope {
  available: boolean;
  mcpServerIds?: string[];
}

export interface ToolCatalogDependencies {
  registry: ToolCatalogRegistryPort;
  mcpCatalog: McpToolCatalogPort;
  findAgent(agentId: string): AgentToolScope | null | undefined;
  createMcpTool(record: McpToolRecord): ToolHandler<unknown, unknown>;
  isLegacyMcpEnabled(): boolean;
}

const GLOBAL_TOOL_NAMES = [
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

/** Builds the Agent-scoped tool schema from registered handlers and the MCP catalog. */
export class ToolCatalogService {
  constructor(private readonly dependencies: ToolCatalogDependencies) {}

  /** Registers MCP adapters with the same catalog mode used to build the visible schema. */
  syncToolHandlers(): void {
    if (this.dependencies.isLegacyMcpEnabled()) this.syncMcpTools();
    else this.syncLoadedMcpTools();
  }

  /** Returns the enabled schemas visible to one Agent. */
  async getAllToolDefinitions(agentId?: string): Promise<ToolDefinition[]> {
    const tools: ToolDefinition[] = [];
    const legacyMcpEnabled = this.dependencies.isLegacyMcpEnabled();
    this.syncToolHandlers();

    for (const name of GLOBAL_TOOL_NAMES) {
      const definition = this.getToolDefinitionSafe(name);
      if (definition) tools.push(definition);
    }

    if (!agentId || agentId === 'general') {
      return legacyMcpEnabled ? this.appendMcpTools(tools) : this.appendLoadedMcpTools(tools);
    }

    const agent = this.dependencies.findAgent(agentId);
    if (!agent?.available) return tools;

    return legacyMcpEnabled
      ? this.appendMcpTools(tools, agent.mcpServerIds || [])
      : this.appendLoadedMcpTools(tools, agent.mcpServerIds || []);
  }

  /** Returns the user-facing summary for a call without blocking execution. */
  getToolCallSummary(toolCall: ToolCall): string | undefined {
    const tool = this.dependencies.registry.get(toolCall.function.name);
    if (!tool) return undefined;

    try {
      return tool.getCallSummary(JSON.parse(toolCall.function.arguments));
    } catch {
      return undefined;
    }
  }

  /** Returns the user-facing summary for a completed tool result. */
  getToolResultSummary(toolCall: ToolCall, result: unknown): string | undefined {
    return this.dependencies.registry.get(toolCall.function.name)?.getResultSummary(result);
  }

  private syncLoadedMcpTools(): void {
    const mcpCatalog = this.dependencies.mcpCatalog;
    if (!mcpCatalog.getLoadedToolNames || !mcpCatalog.getToolRecord) return;

    for (const fullName of mcpCatalog.getLoadedToolNames()) {
      this.registerMcpTool(fullName);
    }
  }

  private syncMcpTools(serverIds?: string[]): void {
    const mcpCatalog = this.dependencies.mcpCatalog;
    if (!mcpCatalog.getAllToolNames || !mcpCatalog.getToolRecord) return;

    for (const fullName of mcpCatalog.getAllToolNames(serverIds)) {
      this.registerMcpTool(fullName);
    }
  }

  private registerMcpTool(fullName: string): void {
    const record = this.dependencies.mcpCatalog.getToolRecord?.(fullName);
    if (record && !this.dependencies.registry.has(fullName)) {
      this.dependencies.registry.register(this.dependencies.createMcpTool(record));
    }
  }

  private appendMcpTools(tools: ToolDefinition[], serverIds?: string[]): ToolDefinition[] {
    const { mcpCatalog } = this.dependencies;
    if (!mcpCatalog.getAllToolNames) return tools;

    for (const fullName of mcpCatalog.getAllToolNames(serverIds)) {
      const definition = this.getToolDefinitionSafe(fullName);
      if (definition) tools.push(definition);
    }
    return tools;
  }

  private appendLoadedMcpTools(tools: ToolDefinition[], serverIds?: string[]): ToolDefinition[] {
    const { mcpCatalog } = this.dependencies;
    if (!mcpCatalog.getLoadedToolNames) return tools;

    for (const fullName of mcpCatalog.getLoadedToolNames()) {
      const serverName = fullName.split('__')[0];
      if (serverIds && !serverIds.includes(serverName)) continue;
      const definition = this.getToolDefinitionSafe(fullName);
      if (definition) tools.push(definition);
    }
    return tools;
  }

  private getToolDefinitionSafe(name: string): ToolDefinition | undefined {
    const tool = this.dependencies.registry.get(name);
    return tool?.isEnabled() ? tool.getDefinition() : undefined;
  }
}
