import type { AgentRuntimePorts } from '../agent-runtime/contracts.js';
import { reactChat } from '../agent-runtime/react-loop-core.js';
import type { ReactExecutionPolicy } from '../agent-runtime/react-loop-core.js';
import type { AgentRun } from '../agent-runtime/agent-run.js';
import type { Sink } from '../agent-runtime/output-sink.js';
import type { RuntimeContext } from '../agent-runtime/tooling/runtime-context.js';
import type { AiSettings, HistoryMessage, StreamResult, ToolDefinition } from '../types.js';

let initialization: Promise<void> | undefined;
let portsPromise: Promise<AgentRuntimePorts> | undefined;

/** Initialize provider and builtin-tool registries once for the process. */
export function initializeAgentRuntime(): Promise<void> {
  if (!initialization) {
    initialization = Promise.all([
      import('../infrastructure/ai/adapters/register-built-in-adapters.js'),
      import('./tool-registry.js'),
      import('../infrastructure/persistence/tool-invocation-repository.js'),
    ])
      .then(async ([adapters, toolRegistry, invocations]) => {
        await adapters.registerBuiltInAdapters();
        toolRegistry.initializeToolRegistry();
        invocations.toolInvocationRepository.markInterruptedUnknown();
      })
      .catch((error: unknown) => {
        initialization = undefined;
        portsPromise = undefined;
        throw error;
      });
  }
  return initialization;
}

/** Lazily compose concrete providers and runtime resources after explicit initialization. */
export async function getAgentRuntimePorts(): Promise<AgentRuntimePorts> {
  await initializeAgentRuntime();
  portsPromise ??= composeAgentRuntimePorts();
  return portsPromise;
}

/** Provides the current request-scoped tool catalog to service-layer adapters. */
export async function getToolDefinitions(agentId?: string): Promise<ToolDefinition[]> {
  const ports = await getAgentRuntimePorts();
  return ports.getToolDefinitions(agentId);
}

/** Runs one production ReAct request through the explicitly composed Runtime ports. */
export async function runAgentChat(
  messages: HistoryMessage[],
  settings: AiSettings,
  sink: Sink,
  agent?: string,
  signal?: AbortSignal,
  conversationId?: string,
  executionPolicy?: ReactExecutionPolicy,
  existingRun?: AgentRun,
  runtimeContext?: RuntimeContext,
): Promise<StreamResult> {
  const ports = await getAgentRuntimePorts();
  return reactChat(
    messages,
    settings,
    sink,
    ports,
    agent,
    signal,
    conversationId,
    executionPolicy,
    existingRun,
    runtimeContext,
  );
}

async function composeAgentRuntimePorts(): Promise<AgentRuntimePorts> {
  const [
    adapters,
    composers,
    contextWindow,
    tokenEstimator,
    toolRound,
    catalogModule,
    executionModule,
    registryModule,
    mcpClient,
    mcpAdapter,
    agentService,
    runs,
    runFactory,
    observation,
  ] = await Promise.all([
    import('../infrastructure/ai/adapters/api-adapter.js'),
    import('../infrastructure/transports/a2ui/composer.js'),
    import('../agent-runtime/context-window.js'),
    import('../utils/token-estimator.js'),
    import('../application/agent-runtime/tool-round-engine.js'),
    import('../application/agent-runtime/tool-catalog-service.js'),
    import('../application/agent-runtime/tool-execution-service.js'),
    import('../application/agent-runtime/tooling/tool-registry.js'),
    import('./mcp-client.js'),
    import('../infrastructure/mcp/mcp-tool-adapter.js'),
    import('../domains/agents/index.js'),
    import('../agent-runtime/agent-run.js'),
    import('./agent-run-factory.js'),
    import('../infrastructure/observability/langfuse.js'),
  ]);
  const toolLoopEngine = toolRound.toolLoopEngine;
  const catalog = new catalogModule.ToolCatalogService({
    registry: registryModule.toolRegistry,
    mcpCatalog: mcpClient.mcpService,
    findAgent: agentService.findById,
    createMcpTool: (record) =>
      new mcpAdapter.McpToolAdapter(record, (serverName, toolName, args) =>
        mcpClient.mcpService.callTool(serverName, toolName, args),
      ),
    isLegacyMcpEnabled: () => process.env.AI_CHAT_MCP_LEGACY_TOOLS === 'true',
  });
  executionModule.toolExecutionService.setMcpHandlerSync(() => catalog.syncToolHandlers());
  return {
    getAdapter: adapters.getAdapter,
    getToolDefinitions: (agentId) => catalog.getAllToolDefinitions(agentId),
    executeRound: (input, sink) => toolLoopEngine.executeRound(input, sink),
    executeToolCallWithRetry: (...args) => toolLoopEngine.executeToolCallWithRetry(...args),
    getToolCallSummary: (toolCall) => catalog.getToolCallSummary(toolCall),
    prepareContext: contextWindow.prepareContext,
    estimateMessagesTokens: tokenEstimator.estimateMessagesTokens,
    contextTokenBudget: contextWindow.DEFAULT_CONTEXT_TOKEN_BUDGET,
    outputTokenReserve: contextWindow.DEFAULT_OUTPUT_TOKEN_RESERVE,
    createRun: runFactory.createDurableAgentRun,
    registerRun: (run) => runs.agentRunRegistry.register(run),
    withRunContext: observation.withLangfuseAgentContext,
    withRoundContext: observation.withLangfuseRoundContext,
    createComposer: () => new composers.A2UIComposer(),
  };
}
