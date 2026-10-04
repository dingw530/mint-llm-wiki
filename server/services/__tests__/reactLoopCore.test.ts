import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockAdapter = {
  getUrl: vi.fn(() => 'https://api.test.com/v1/chat/completions'),
  getHeaders: vi.fn(() => ({})),
  buildRequest: vi.fn(() => ({})),
  stream: vi.fn(),
  parseChunk: vi.fn(),
  call: vi.fn(),
};

vi.mock('../adapters/apiAdapter.js', () => ({
  getAdapter: vi.fn(() => mockAdapter as any),
  registerAdapter: vi.fn(),
}));

vi.mock('../toolRoundEngine.js', () => ({
  toolLoopEngine: {
    executeRound: vi.fn(),
    executeToolCallWithRetry: vi.fn(),
  },
}));

vi.mock('../toolOrchestration.js', () => ({
  getAllToolDefinitions: vi.fn().mockResolvedValue([]),
  getToolCallSummary: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../utils/contextWindow.js', () => ({
  DEFAULT_CONTEXT_TOKEN_BUDGET: 100000,
  DEFAULT_OUTPUT_TOKEN_RESERVE: 4096,
  prepareContext: vi.fn(async (msgs) => msgs),
}));

import { reactChat } from '../../agent-runtime/react-loop-core.js';
import { toolLoopEngine } from '../toolRoundEngine.js';
import { getAdapter } from '../adapters/apiAdapter.js';

describe('reactChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when apiUrl is missing', async () => {
    const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
    const result = await reactChat([], { apiUrl: '', apiKey: '' } as any, sink);
    expect(result.content).toBe('');
  });

  it('returns error when apiKey is missing', async () => {
    const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
    const result = await reactChat([], { apiUrl: 'https://api.test.com', apiKey: '' } as any, sink);
    expect(result.content).toBe('');
  });

  it('handles executeRound failure', async () => {
    vi.mocked(toolLoopEngine.executeRound).mockRejectedValue(new Error('API error'));
    const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
    const result = await reactChat(
      [{ role: 'user', content: 'hi' }],
      {
        apiUrl: 'https://api.test.com',
        apiKey: 'sk-key',
        apiType: 'openai-chat',
        reactMaxIterations: 5,
        toolMaxRetries: 3,
        maxContextRounds: 10,
      } as any,
      sink,
    );
    expect(result.content).toBe('');
  });

  it('returns content when no tool calls', async () => {
    vi.mocked(toolLoopEngine.executeRound).mockImplementationOnce(async ({ emitEvent }) => {
      emitEvent?.({ type: 'thought', content: 'final answer' });
      return {
        content: 'final answer',
        reasoning: 'some reasoning',
        toolCalls: null,
      };
    });
    const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
    const result = await reactChat(
      [{ role: 'user', content: 'hi' }],
      {
        apiUrl: 'https://api.test.com',
        apiKey: 'sk-key',
        apiType: 'openai-chat',
        reactMaxIterations: 3,
        toolMaxRetries: 3,
        maxContextRounds: 10,
      } as any,
      sink,
      'general',
    );
    expect(result.content).toBe('final answer');
    expect(result.reasoning).toBe('some reasoning');
    const events = sink.write.mock.calls.map(([data]) => JSON.parse(data));
    expect(
      events.filter((event) => event.type === 'answer' && event.content === 'final answer'),
    ).toHaveLength(1);
    expect(
      events.some((event) => event.type === 'thought' && event.content === 'final answer'),
    ).toBe(false);
  });

  it('does not append uncited Wiki references to the final answer', async () => {
    const wikiCall = {
      id: 'wiki-call-1',
      type: 'function' as const,
      function: { name: 'wiki_search', arguments: '{"question":"RAG"}' },
    };
    const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

    vi.mocked(toolLoopEngine.executeRound)
      .mockResolvedValueOnce({ content: '', reasoning: '', toolCalls: [wikiCall] })
      .mockResolvedValueOnce({
        content: 'RAG 通过检索外部知识降低幻觉。',
        reasoning: '',
        toolCalls: null,
      });
    vi.mocked(toolLoopEngine.executeToolCallWithRetry).mockResolvedValue({
      assistantMsg: { role: 'assistant', content: '', tool_calls: [wikiCall] },
      toolMsg: { role: 'tool', tool_call_id: wikiCall.id, content: '{}' },
      succeeded: true,
      rawResult: {
        results: [
          {
            file: 'pages/rag.md',
            title: 'RAG',
            heading: 'Overview',
            chunkId: 'pages/rag.md#chunk:0',
            granularity: 'chunk',
            content: 'RAG evidence',
          },
        ],
      },
    });

    const result = await reactChat(
      [{ role: 'user', content: 'RAG 是什么？' }],
      { apiUrl: 'https://api.test.com', apiKey: 'sk-key', apiType: 'openai-chat' } as any,
      sink,
    );

    expect(result.content).toBe('RAG 通过检索外部知识降低幻觉。');
    expect(result.content).not.toContain('补充检索来源');
    expect(result.wikiReferences).toEqual([
      expect.objectContaining({ file: 'pages/rag.md', refId: 'C1', granularity: 'chunk' }),
    ]);
  });

  it('returns Wiki references with the same display IDs used by the final answer', async () => {
    const wikiCall = {
      id: 'wiki-call-1',
      type: 'function' as const,
      function: { name: 'wiki_search', arguments: '{"question":"architecture"}' },
    };
    const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

    vi.mocked(toolLoopEngine.executeRound)
      .mockResolvedValueOnce({ content: '', reasoning: '', toolCalls: [wikiCall] })
      .mockResolvedValueOnce({
        content: '先说 C。[C3] 再说 A。[C1]',
        reasoning: '',
        toolCalls: null,
      });
    vi.mocked(toolLoopEngine.executeToolCallWithRetry).mockResolvedValue({
      assistantMsg: { role: 'assistant', content: '', tool_calls: [wikiCall] },
      toolMsg: { role: 'tool', tool_call_id: wikiCall.id, content: '{}' },
      succeeded: true,
      rawResult: {
        results: [
          { file: 'a.md', chunkId: 'a.md#chunk:0', content: 'A' },
          { file: 'b.md', chunkId: 'b.md#chunk:0', content: 'B' },
          { file: 'c.md', chunkId: 'c.md#chunk:0', content: 'C' },
        ],
      },
    });

    const result = await reactChat(
      [{ role: 'user', content: '说明架构。' }],
      { apiUrl: 'https://api.test.com', apiKey: 'sk-key', apiType: 'openai-chat' } as any,
      sink,
    );

    expect(result.content).toContain('先说 C。[C1] 再说 A。[C2]');
    expect(result.wikiReferences?.map(({ file, refId }) => ({ file, refId }))).toEqual([
      { file: 'a.md', refId: 'C2' },
      { file: 'b.md', refId: 'C3' },
      { file: 'c.md', refId: 'C1' },
    ]);
  });

  it('preserves tool call order while correlating same-name calls by callId', async () => {
    const firstCall = {
      id: 'call-1',
      type: 'function' as const,
      function: { name: 'bash', arguments: '{"command":"first"}' },
    };
    const secondCall = {
      id: 'call-2',
      type: 'function' as const,
      function: { name: 'bash', arguments: '{"command":"second"}' },
    };
    const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
    const contextMessages: any[] = [];
    const { getToolCallSummary } = await import('../toolOrchestration.js');
    vi.mocked(getToolCallSummary).mockReturnValue('正在执行工具');

    vi.mocked(toolLoopEngine.executeRound)
      .mockImplementationOnce(async ({ messages }) => {
        contextMessages.push(...messages);
        return { content: '', reasoning: 'thinking', toolCalls: [firstCall, secondCall] };
      })
      .mockImplementationOnce(async ({ messages }) => {
        contextMessages.push(...messages);
        return { content: 'done', reasoning: '', toolCalls: null };
      });
    vi.mocked(toolLoopEngine.executeToolCallWithRetry).mockImplementation(async (toolCall) => {
      await new Promise((resolve) => setTimeout(resolve, toolCall.id === 'call-1' ? 10 : 1));
      return {
        assistantMsg: {
          role: 'assistant',
          content: null as unknown as string,
          tool_calls: [toolCall],
        },
        toolMsg: { role: 'tool', tool_call_id: toolCall.id, content: toolCall.id },
        succeeded: true,
        resultSummary: '工具执行完成',
      };
    });

    await reactChat(
      [{ role: 'user', content: 'hi' }],
      {
        apiUrl: 'https://api.test.com',
        apiKey: 'sk-key',
        apiType: 'openai-chat',
        reactMaxIterations: 3,
        toolMaxRetries: 0,
        maxContextRounds: 10,
      } as any,
      sink,
    );

    const events = sink.write.mock.calls.map(([data]) => JSON.parse(data));
    expect(
      events.filter((event) => event.type === 'tool_call_start').map((event) => event.callId),
    ).toEqual(['call-1', 'call-2']);
    expect(
      events.filter((event) => event.type === 'tool_call_start').map((event) => event.summary),
    ).toEqual(['正在执行工具', '正在执行工具']);
    expect(
      events.filter((event) => event.type === 'tool_call_end').map((event) => event.callId),
    ).toEqual(['call-2', 'call-1']);
    expect(events.some((event) => event.type === 'answer' && event.content === 'done')).toBe(true);
    expect(
      events.filter((event) => event.type === 'tool_call_end').map((event) => event.summary),
    ).toEqual(['工具执行完成', '工具执行完成']);
    const toolMessages = contextMessages
      .flat()
      .filter((message: any) => message.role === 'tool')
      .map((message: any) => message.tool_call_id);
    expect(toolMessages).toEqual(['call-1', 'call-2']);
    expect(
      events.filter((event) =>
        ['run_completed', 'run_failed', 'run_cancelled'].includes(event.type),
      ),
    ).toHaveLength(1);
  });

  it('ignores sparse tool call slots from streamed tool indexes', async () => {
    const firstCall = {
      id: 'call-1',
      type: 'function' as const,
      function: { name: 'bash', arguments: '{"command":"first"}' },
    };
    const thirdCall = {
      id: 'call-3',
      type: 'function' as const,
      function: { name: 'bash', arguments: '{"command":"third"}' },
    };
    const sparseCalls = [] as any[];
    sparseCalls[0] = firstCall;
    sparseCalls[2] = thirdCall;
    const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

    vi.mocked(toolLoopEngine.executeRound)
      .mockResolvedValueOnce({ content: '', reasoning: '', toolCalls: sparseCalls })
      .mockResolvedValueOnce({ content: 'done', reasoning: '', toolCalls: null });
    vi.mocked(toolLoopEngine.executeToolCallWithRetry).mockResolvedValue({
      assistantMsg: { role: 'assistant', content: null as unknown as string, tool_calls: [] },
      toolMsg: { role: 'tool', tool_call_id: 'tool', content: '{}' },
      succeeded: true,
    });

    const result = await reactChat(
      [{ role: 'user', content: 'hi' }],
      { apiUrl: 'https://api.test.com', apiKey: 'sk-key', apiType: 'openai-chat' } as any,
      sink,
    );

    expect(result.content).toBe('done');
    expect(vi.mocked(toolLoopEngine.executeToolCallWithRetry)).toHaveBeenCalledTimes(2);
  });

  it('blocks evaluator tool calls after the configured budget', async () => {
    const calls = [1, 2, 3].map((index) => ({
      id: `wiki-${index}`,
      type: 'function' as const,
      function: { name: 'wiki_search', arguments: JSON.stringify({ question: `q-${index}` }) },
    }));
    const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

    vi.mocked(toolLoopEngine.executeRound)
      .mockResolvedValueOnce({ content: '', reasoning: '', toolCalls: calls })
      .mockResolvedValueOnce({ content: 'done', reasoning: '', toolCalls: null });
    vi.mocked(toolLoopEngine.executeToolCallWithRetry).mockResolvedValue({
      assistantMsg: { role: 'assistant', content: '', tool_calls: [] },
      toolMsg: { role: 'tool', tool_call_id: 'wiki', content: '{}' },
      succeeded: true,
    });

    await reactChat(
      [{ role: 'user', content: 'hi' }],
      { apiUrl: 'https://api.test.com', apiKey: 'sk-key', apiType: 'openai-chat' } as any,
      sink,
      undefined,
      undefined,
      'eval:budget',
      { maxToolCallsByName: { wiki_search: 2 } },
    );

    expect(vi.mocked(toolLoopEngine.executeToolCallWithRetry)).toHaveBeenCalledTimes(2);
    const events = sink.write.mock.calls.map(([data]) => JSON.parse(data));
    expect(events.filter((event) => event.type === 'tool_call_start')).toHaveLength(3);
    expect(events.filter((event) => event.type === 'tool_call_end')).toHaveLength(3);
    expect(
      events.find((event) => event.type === 'tool_call_end' && event.callId === 'wiki-3')?.summary,
    ).toContain('预算');
  });

  it('injects remaining tool budget and stops offering tools after exhaustion', async () => {
    const calls = [1, 2].map((index) => ({
      id: `wiki-budget-${index}`,
      type: 'function' as const,
      function: { name: 'wiki_search', arguments: JSON.stringify({ question: `q-${index}` }) },
    }));
    const seen: Array<{ messages: any[]; tools: unknown }> = [];
    const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

    vi.mocked(toolLoopEngine.executeRound)
      .mockImplementationOnce(async ({ messages, tools }) => {
        seen.push({ messages: [...messages], tools });
        return { content: '', reasoning: '', toolCalls: [calls[0]] };
      })
      .mockImplementationOnce(async ({ messages, tools }) => {
        seen.push({ messages: [...messages], tools });
        return { content: '', reasoning: '', toolCalls: [calls[1]] };
      })
      .mockImplementationOnce(async ({ messages, tools }) => {
        seen.push({ messages: [...messages], tools });
        return { content: 'done', reasoning: '', toolCalls: null };
      });
    vi.mocked(toolLoopEngine.executeToolCallWithRetry).mockResolvedValue({
      assistantMsg: { role: 'assistant', content: '', tool_calls: [] },
      toolMsg: { role: 'tool', tool_call_id: 'wiki-budget', content: '{}' },
      succeeded: true,
    });

    await reactChat(
      [{ role: 'user', content: 'hi' }],
      { apiUrl: 'https://api.test.com', apiKey: 'sk-key', apiType: 'openai-chat' } as any,
      sink,
      undefined,
      undefined,
      'eval:remaining-budget',
      { maxToolCallsByName: { wiki_search: 2 } },
    );

    expect(seen).toHaveLength(3);
    expect(seen[0].messages.at(-1)?.content).toContain('wiki_search=0/2（剩余=2）');
    expect(seen[1].messages.at(-1)?.content).toContain('wiki_search=1/2（剩余=1）');
    expect(seen[2].messages.at(-1)?.content).toContain('wiki_search=2/2（剩余=0）');
    expect(seen[2].tools).toBeUndefined();
    expect(vi.mocked(toolLoopEngine.executeToolCallWithRetry)).toHaveBeenCalledTimes(2);
  });

  it('limits evaluator Wiki searches to one call per round', async () => {
    const calls = [1, 2].map((index) => ({
      id: `wiki-round-${index}`,
      type: 'function' as const,
      function: { name: 'wiki_search', arguments: JSON.stringify({ question: `q-${index}` }) },
    }));
    const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

    vi.mocked(toolLoopEngine.executeRound)
      .mockResolvedValueOnce({ content: '', reasoning: '', toolCalls: calls })
      .mockResolvedValueOnce({ content: 'done', reasoning: '', toolCalls: null });
    vi.mocked(toolLoopEngine.executeToolCallWithRetry).mockResolvedValue({
      assistantMsg: { role: 'assistant', content: '', tool_calls: [] },
      toolMsg: { role: 'tool', tool_call_id: 'wiki-round', content: '{}' },
      succeeded: true,
    });

    await reactChat(
      [{ role: 'user', content: 'hi' }],
      { apiUrl: 'https://api.test.com', apiKey: 'sk-key', apiType: 'openai-chat' } as any,
      sink,
      undefined,
      undefined,
      'eval:round-budget',
      { maxToolCallsByName: { wiki_search: 2 }, maxToolCallsPerRoundByName: { wiki_search: 1 } },
    );

    expect(vi.mocked(toolLoopEngine.executeToolCallWithRetry)).toHaveBeenCalledTimes(1);
    const events = sink.write.mock.calls.map(([data]) => JSON.parse(data));
    expect(
      events.find((event) => event.type === 'tool_call_end' && event.callId === 'wiki-round-2')
        ?.summary,
    ).toContain('预算');
  });

  it('emits a single cancelled terminal event and skips the model call', async () => {
    const controller = new AbortController();
    controller.abort();
    const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

    await reactChat(
      [{ role: 'user', content: 'hi' }],
      {
        apiUrl: 'https://api.test.com',
        apiKey: 'sk-key',
        apiType: 'openai-chat',
        reactMaxIterations: 3,
        toolMaxRetries: 0,
        maxContextRounds: 10,
      } as any,
      sink,
      undefined,
      controller.signal,
    );

    const events = sink.write.mock.calls.map(([data]) => JSON.parse(data));
    expect(vi.mocked(toolLoopEngine.executeRound)).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type === 'run_cancelled')).toHaveLength(1);
    expect(
      events.some((event) => event.type === 'run_completed' || event.type === 'run_failed'),
    ).toBe(false);
  });
});
