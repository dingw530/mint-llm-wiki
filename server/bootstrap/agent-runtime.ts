import type { AgentRuntimePorts } from '../agent-runtime/contracts.js';
import { reactChat } from '../agent-runtime/react-loop-core.js';
import type { ReactExecutionPolicy } from '../agent-runtime/react-loop-core.js';
import type { AgentRun } from '../agent-runtime/agent-run.js';
import type { Sink } from '../agent-runtime/output-sink.js';
import type { RuntimeContext } from '../services/runtime/runtimeContext.js';
import type { AiSettings, HistoryMessage, StreamResult } from '../types.js';

let initialization: Promise<void> | undefined;
let portsPromise: Promise<AgentRuntimePorts> | undefined;

/** Initialize provider and builtin-tool registries once for the process. */
export function initializeAgentRuntime(): Promise<void> {
  if (!initialization) {
    initialization = Promise.all([
      import('../services/adapters/register-built-in-adapters.js'),
      import('../services/tools/index.js'),
    ])
      .then(async ([adapters, tools]) => {
        await adapters.registerBuiltInAdapters();
        tools.initializeTools();
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
    orchestration,
    runs,
    runFactory,
    observation,
  ] = await Promise.all([
    import('../services/adapters/apiAdapter.js'),
    import('../services/a2ui/composer.js'),
    import('../services/utils/contextWindow.js'),
    import('../services/utils/tokenEstimator.js'),
    import('../services/toolRoundEngine.js'),
    import('../services/toolOrchestration.js'),
    import('../agent-runtime/agent-run.js'),
    import('./agent-run-factory.js'),
    import('../services/observability/langfuse.js'),
  ]);
  const toolLoopEngine = toolRound.toolLoopEngine;
  return {
    getAdapter: adapters.getAdapter,
    getToolDefinitions: orchestration.getAllToolDefinitions,
    executeRound: (input, sink) => toolLoopEngine.executeRound(input, sink),
    executeToolCallWithRetry: (...args) => toolLoopEngine.executeToolCallWithRetry(...args),
    getToolCallSummary: orchestration.getToolCallSummary,
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
