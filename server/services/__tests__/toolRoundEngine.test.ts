import { describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/ai/adapters/api-adapter.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/ai/adapters/api-adapter.js')>()),
  getAdapter: vi.fn(),
}));

import { ToolLoopEngine, parseSSEStream } from '../toolRoundEngine.js';

describe('ToolLoopEngine', () => {
  const engine = new ToolLoopEngine();

  it('rejects missing apiUrl', async () => {
    await expect(
      engine.executeRound({
        messages: [],
        settings: { apiUrl: '', apiKey: '' } as any,
      }),
    ).rejects.toThrow('API URL');
  });

  it('rejects missing apiKey', async () => {
    await expect(
      engine.executeRound({
        messages: [],
        settings: { apiUrl: 'https://api.test.com', apiKey: '' } as any,
      }),
    ).rejects.toThrow('API Key');
  });

  it('delegates the model stream to the adapter and parses it', async () => {
    const adapter = {
      stream: vi.fn().mockResolvedValue(
        (async function* () {
          yield { content: 'answer' };
          yield { isFinished: true };
        })(),
      ),
    };

    const result = await engine.executeRound({
      messages: [],
      settings: { apiUrl: 'https://api.test.com', apiKey: 'key', apiType: 'test' } as any,
      adapter: adapter as any,
    });

    expect(result.content).toBe('answer');
    expect(adapter.stream).toHaveBeenCalledWith(
      [],
      expect.anything(),
      'https://api.test.com',
      'key',
      undefined,
      expect.objectContaining({ signal: undefined }),
    );
  });
});

describe('parseSSEStream', () => {
  it('accumulates content from normalized model chunks', async () => {
    const result = await parseSSEStream(
      (async function* () {
        yield { content: 'Hello ' };
        yield { content: 'World!' };
        yield { isFinished: true };
      })(),
    );

    expect(result.content).toBe('Hello World!');
  });

  it('accumulates tool call chunks', async () => {
    const result = await parseSSEStream(
      (async function* () {
        yield {
          toolCallDelta: {
            index: 0,
            id: 'call-1',
            type: 'function',
            function: { name: 'wiki_search', arguments: '{"query":"Mint"}' },
          },
        };
        yield { isFinished: true };
      })(),
    );

    expect(result.toolCalls).toEqual([
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'wiki_search', arguments: '{"query":"Mint"}' },
      },
    ]);
  });

  it('writes to sink', async () => {
    const sink = { write: vi.fn() };
    await parseSSEStream(
      (async function* () {
        yield { content: 'test' };
        yield { isFinished: true };
      })(),
      undefined,
      sink as any,
    );

    expect(sink.write).toHaveBeenCalledWith(expect.stringContaining('test'));
  });

  it('emits typed stream events when an event callback is provided', async () => {
    const events: unknown[] = [];
    await parseSSEStream(
      (async function* () {
        yield { content: 'typed' };
        yield { isFinished: true };
      })(),
      undefined,
      undefined,
      { eventType: 'thought', emitEvent: (event) => events.push(event) },
    );

    expect(events).toEqual([{ type: 'thought', content: 'typed' }]);
  });
});
