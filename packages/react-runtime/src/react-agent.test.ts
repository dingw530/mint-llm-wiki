import { describe, expect, it, vi } from 'vitest';
import { createReactAgent } from './react-agent.js';

describe('createReactAgent', () => {
  it('executes ordered ReAct turns and correlates tool messages by call ID', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        assistantMessage: { role: 'assistant', content: null },
        toolCalls: [
          { id: 'call-1', name: 'first', input: {} },
          { id: 'call-2', name: 'second', input: {} },
        ],
        usage: { totalTokens: 2 },
      })
      .mockResolvedValueOnce({
        assistantMessage: { role: 'assistant', content: 'done' },
        toolCalls: [],
      });
    const execute = vi.fn(async ({ call }) => ({
      status: 'success' as const,
      messages: [{ role: 'tool', toolCallId: call.id }],
    }));
    const events: string[] = [];
    const agent = createReactAgent({
      model: { generate },
      toolExecutor: { execute },
      policy: { maxSteps: 3 },
    });

    const result = await agent.run({
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'first' }, { name: 'second' }],
      onEvent: (event) => events.push(event.type),
    });

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(2);
    expect(result.usage).toEqual([{ totalTokens: 2 }]);
    expect(execute.mock.calls.map(([request]) => request.call.id)).toEqual(['call-1', 'call-2']);
    expect(result.messages.slice(1, 3).map((message) => message.toolCallId)).toEqual([
      'call-1',
      'call-2',
    ]);
    expect(events.at(-1)).toBe('run_completed');
  });

  it('stops after an answer and hides tools from the final allowed step', async () => {
    const generate = vi.fn(async ({ step, tools }) => ({
      assistantMessage: { role: 'assistant', content: 'answer' },
      toolCalls: [],
      metadata: { step, toolCount: tools.length },
    }));
    const agent = createReactAgent({
      model: { generate },
      toolExecutor: { execute: vi.fn() },
      policy: { maxSteps: 1 },
    });

    const result = await agent.run({ messages: [], tools: [{ name: 'x' }] });

    expect(result.status).toBe('completed');
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ tools: [], step: 1 }));
  });

  it('handles step limit, cancellation, unknown errors, pauses, and tool failure policy', async () => {
    const toolResponse = {
      assistantMessage: { role: 'assistant', content: null },
      toolCalls: [{ id: 'call-1', name: 'missing', input: {} }],
    };
    const model = { generate: vi.fn().mockResolvedValue(toolResponse) };
    const execute = vi.fn(async () => ({ messages: [], status: 'success' as const }));
    const agent = createReactAgent({ model, toolExecutor: { execute }, policy: { maxSteps: 1 } });
    const limit = await agent.run({ messages: [], tools: [{ name: 'missing' }] });
    expect(limit.status).toBe('step_limit');
    expect(execute).not.toHaveBeenCalled();

    const controller = new AbortController();
    controller.abort();
    const cancelled = await agent.run({
      messages: [],
      tools: [{ name: 'missing' }],
      signal: controller.signal,
    });
    expect(cancelled.status).toBe('cancelled');
    expect(model.generate).toHaveBeenCalledTimes(1);

    const pausedAgent = createReactAgent({
      model: { generate: vi.fn().mockResolvedValue(toolResponse) },
      toolExecutor: { execute: vi.fn().mockResolvedValue({ messages: [], status: 'paused' }) },
      policy: { maxSteps: 2 },
    });
    expect((await pausedAgent.run({ messages: [], tools: [{ name: 'missing' }] })).status).toBe(
      'paused',
    );

    const failedAgent = createReactAgent({
      model: { generate: vi.fn().mockResolvedValue(toolResponse) },
      toolExecutor: { execute: vi.fn().mockRejectedValue(new Error('tool failed')) },
      policy: { maxSteps: 2, continueOnToolError: false },
    });
    expect((await failedAgent.run({ messages: [], tools: [{ name: 'missing' }] })).status).toBe(
      'failed',
    );

    const unknownExecutor = vi.fn();
    const unknownAgent = createReactAgent({
      model: { generate: vi.fn().mockResolvedValue(toolResponse) },
      toolExecutor: { execute: unknownExecutor },
      policy: { maxSteps: 2, continueOnToolError: false },
    });
    const unknown = await unknownAgent.run({ messages: [], tools: [{ name: 'known' }] });
    expect(unknown.status).toBe('failed');
    expect(unknown.error).toBe('Unknown tool: missing');
    expect(unknownExecutor).not.toHaveBeenCalled();
  });

  it('rejects invalid maximum step values', () => {
    expect(() =>
      createReactAgent({
        model: { generate: vi.fn() },
        toolExecutor: { execute: vi.fn() },
        policy: { maxSteps: 0 },
      }),
    ).toThrow(RangeError);
  });

  it('does not start another model call after cancellation during tool execution', async () => {
    const controller = new AbortController();
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        assistantMessage: { role: 'assistant', content: null },
        toolCalls: [{ id: 'call-1', name: 'work', input: {} }],
      })
      .mockResolvedValueOnce({
        assistantMessage: { role: 'assistant', content: 'should not run' },
        toolCalls: [],
      });
    const agent = createReactAgent({
      model: { generate },
      toolExecutor: {
        async execute() {
          controller.abort();
          return { messages: [{ role: 'tool', content: 'done' }], status: 'success' as const };
        },
      },
      policy: { maxSteps: 3 },
    });

    const result = await agent.run({
      messages: [],
      tools: [{ name: 'work' }],
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
