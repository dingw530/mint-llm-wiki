import { beforeEach, describe, expect, it, vi } from 'vitest';
import { A2UIComposer } from '../../services/a2ui/composer.js';
import { AgentRun } from '../agent-run.js';
import { getAdapter } from '../../services/adapters/apiAdapter.js';
import { AccumulatingSink } from '../../infrastructure/transports/sinks.js';
import { ToolRegistry } from '../../services/tools/ToolRegistry.js';
import type { AiSettings } from '../../types.js';
import type { AgentRuntimePorts } from '../contracts.js';
import { reactChat } from '../react-loop-core.js';

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
});
