import { beforeEach, describe, expect, it, vi } from 'vitest';
import { A2UIComposer } from '../../infrastructure/transports/a2ui/composer.js';
import { AgentRun } from '../agent-run.js';
import { getAdapter } from '../../infrastructure/ai/adapters/api-adapter.js';
import { AccumulatingSink } from '../../infrastructure/transports/sinks.js';
import { ToolRegistry } from '../../application/agent-runtime/tooling/tool-registry.js';
import type { AiSettings, StreamResult, ToolCall, ToolDefinition } from '../../types.js';
import type { ApiAdapter } from '../../infrastructure/ai/adapters/api-adapter.js';
import type { ToolRoundInput, ToolRoundResult } from '../tooling/tool-round-contracts.js';
import type { AgentRuntimePorts } from '../contracts.js';
import { executeReactRun, reactChat } from '../react-loop-core.js';
/** Runs a tool failure through the ReAct loop and records the follow-up model request. */
async function runToolFailure(
  outcomeUnknown: boolean,
): Promise<{ result: StreamResult; rounds: ToolRoundInput[]; toolExecutorCalls: number }> {
  const run = new AgentRun({ runId: `tool-failure-${String(outcomeUnknown)}` });
  run.publish({ type: 'run_started', state: 'running' });
  const toolDefinition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'side_effect',
      description: 'test tool',
      parameters: { type: 'object', properties: {} },
    },
  };
  const toolCall: ToolCall = {
    id: 'tool-failure-call',
    type: 'function',
    function: { name: 'side_effect', arguments: '{}' },
  };
  const rounds: ToolRoundInput[] = [];
  const toolExecutor = vi.fn(async (call: ToolCall) => ({
    assistantMsg: { role: 'assistant' as const, content: '', tool_calls: [call] },
    toolMsg: {
      role: 'tool' as const,
      tool_call_id: call.id,
      content: JSON.stringify({
        error: 'Tool failed',
        outcomeUnknown,
        diagnosticError: 'merge failed token=[REDACTED]',
      }),
    },
    succeeded: false,
    outcomeUnknown,
    diagnosticError: 'merge failed token=[REDACTED]',
  }));
  const adapter = {} as ApiAdapter;
  const ports: AgentRuntimePorts = {
    getAdapter: () => adapter,
    getToolDefinitions: async () => [toolDefinition],
    executeToolCallWithRetry: toolExecutor,
    getToolCallSummary: () => undefined,
    executeRound: async (input): Promise<ToolRoundResult> => {
      rounds.push(input);
      if (rounds.length === 1) return { content: '', reasoning: '', toolCalls: [toolCall] };
      return { content: 'The tool failed.', reasoning: '', toolCalls: null };
    },
    prepareContext: async (messages) => messages,
    estimateMessagesTokens: () => 1,
    contextTokenBudget: 100_000,
    outputTokenReserve: 4_096,
    createRun: () => run,
    registerRun: () => undefined,
    withRunContext: (_run, operation) => operation(),
    withRoundContext: (_run, _round, operation) => operation(),
    createComposer: () => new A2UIComposer(),
  };
  const settings = {
    apiUrl: 'https://provider.test',
    apiKey: 'test',
    apiType: 'openai-chat',
    reactMaxIterations: 3,
    toolMaxRetries: 0,
  } as AiSettings;

  const result = await executeReactRun(
    [{ role: 'user', content: 'run the tool' }],
    settings,
    run,
    ports,
  );
  return { result, rounds, toolExecutorCalls: toolExecutor.mock.calls.length };
}

describe('Agent Runtime ports', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('does not register providers or builtin tools when the core is imported', () => {
    expect(getAdapter('openai-chat')).toBeUndefined();
    expect(new ToolRegistry().getAllEnabled()).toEqual([]);
  });

  it('registers providers and builtin tools through the bootstrap exactly once', async () => {
    const { getAgentRuntimePorts, initializeAgentRuntime } =
      await import('../../bootstrap/agent-runtime.js');
    await Promise.all([initializeAgentRuntime(), initializeAgentRuntime()]);
    const agentRuntimePorts = await getAgentRuntimePorts();

    expect(getAdapter('openai-chat')).toBeDefined();
    expect(await agentRuntimePorts.getToolDefinitions()).toContainEqual(
      expect.objectContaining({ function: expect.objectContaining({ name: 'wiki_search' }) }),
    );
  });

  it('uses the injected adapter and run factory without loading production adapters', async () => {
    const run = new AgentRun({ runId: 'injected-run' });
    const getAdapter = vi.fn(() => undefined);
    const registerRun = vi.fn();
    const ports: AgentRuntimePorts = {
      getAdapter,
      getToolDefinitions: vi.fn(async () => []),
      executeRound: vi.fn(),
      executeToolCallWithRetry: vi.fn(),
      getToolCallSummary: vi.fn(() => undefined),
      prepareContext: vi.fn(async (messages) => messages),
      estimateMessagesTokens: vi.fn(() => 0),
      contextTokenBudget: 100_000,
      outputTokenReserve: 4_096,
      createRun: vi.fn(() => run),
      registerRun,
      withRunContext: (_run, operation) => operation(),
      withRoundContext: (_run, _round, operation) => operation(),
      createComposer: () => new A2UIComposer(),
    };
    const sink = new AccumulatingSink();

    const result = await reactChat(
      [],
      { apiUrl: 'https://provider.test', apiKey: 'test', apiType: 'openai-chat' } as AiSettings,
      sink,
      ports,
    );

    expect(getAdapter).toHaveBeenCalledWith('openai-chat');
    expect(registerRun).toHaveBeenCalledWith(run);
    expect(result).toMatchObject({ content: '', toolCalls: null, uiBlocks: [] });
    expect(sink.writableEnded).toBe(true);
  });

  it('continues a known no-side-effect tool failure with tools available', async () => {
    const { result, rounds, toolExecutorCalls } = await runToolFailure(false);

    expect(result.content).toBe('The tool failed.');
    expect(toolExecutorCalls).toBe(1);
    expect(rounds[1].tools).toHaveLength(1);
    expect(rounds[1].messages).toContainEqual(
      expect.objectContaining({
        role: 'tool',
        content: expect.stringContaining('merge failed token=[REDACTED]'),
      }),
    );
  });

  it('finalizes an unknown tool failure with no tools and includes its diagnostic context', async () => {
    const { result, rounds, toolExecutorCalls } = await runToolFailure(true);

    expect(result.content).toBe('The tool failed.');
    expect(toolExecutorCalls).toBe(1);
    expect(rounds[1].tools).toBeUndefined();
    expect(rounds[1].messages).toContainEqual(
      expect.objectContaining({
        role: 'tool',
        content: expect.stringContaining('merge failed token=[REDACTED]'),
      }),
    );
  });
});
