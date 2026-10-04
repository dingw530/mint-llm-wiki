import { beforeEach, describe, expect, it, vi } from 'vitest';
import { anthropicAdapter } from '../anthropic-adapter.js';
import { openaiChatAdapter } from '../openai-chat-adapter.js';
import { openaiResponsesAdapter } from '../openai-responses-adapter.js';
import { toModelMessages, toModelTools } from '../ai-sdk-adapter.js';

const settings = {
  modelId: 'test-model',
  thinkingMode: false,
  systemPrompt: 'You are helpful.',
};

describe('AI SDK adapters', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('converts history messages while preserving tool call context', () => {
    const messages = toModelMessages(
      [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Search Mint' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'wiki_search', arguments: '{"query":"Mint"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call-1', content: '{"results":[]}' },
      ],
      'Fallback system',
    );

    expect(messages).toEqual([
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Search Mint' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'wiki_search',
            input: { query: 'Mint' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'wiki_search',
            output: { type: 'text', value: '{"results":[]}' },
          },
        ],
      },
    ]);
  });

  it('converts tool definitions without installing an executor', () => {
    const tools = toModelTools([
      {
        type: 'function',
        function: {
          name: 'wiki_search',
          description: 'Search Wiki',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      },
    ]);

    expect(tools?.wiki_search.description).toBe('Search Wiki');
    expect(tools?.wiki_search.execute).toBeUndefined();
  });

  it('uses AI SDK fullStream for OpenAI-compatible chat', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.test.com/v1/chat/completions');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('test-model');
      expect(body.stream).toBe(true);
      return new Response(
        [
          'data: {"choices":[{"delta":{"reasoning_content":"plan"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
          'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\n',
          'data: [DONE]\n\n',
        ].join(''),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const stream = await openaiChatAdapter.stream(
      [{ role: 'user', content: 'Hi' }],
      settings,
      'https://api.test.com',
      'sk-test',
    );
    const chunks: Array<{ content?: string; reasoning?: string; isFinished?: boolean }> = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks).toEqual([
      { reasoning: 'plan' },
      { content: 'Hello' },
      { isFinished: true, usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes AI SDK tool calls without executing Mint tools', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"wiki_search","arguments":"{\\"query\\":\\"Mint\\"}"}}]}}]}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const stream = await openaiChatAdapter.stream(
      [{ role: 'user', content: 'Search Mint' }],
      settings,
      'https://api.test.com',
      'sk-test',
      [
        {
          type: 'function',
          function: {
            name: 'wiki_search',
            description: 'Search Wiki',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        },
      ],
    );
    const chunks: Array<{ toolCallDelta?: unknown; isFinished?: boolean }> = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks).toEqual([
      {
        toolCallDelta: {
          index: 0,
          id: 'call-1',
          type: 'function',
          function: { name: 'wiki_search', arguments: '{"query":"Mint"}' },
        },
      },
      { isFinished: true },
    ]);
  });

  it('creates the configured Responses and Anthropic models', () => {
    expect(
      openaiResponsesAdapter.createModel('https://api.test.com', 'key', settings).provider,
    ).toBe('openai.responses');
    expect(
      anthropicAdapter.createModel('https://api.test.com/anthropic', 'key', settings).provider,
    ).toBe('anthropic.messages');
  });

  it('uses generateText for non-streaming calls', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.thinking).toEqual({ type: 'disabled' });
      expect(body.enable_thinking).toBe(false);
      expect(body.return_reasoning).toBe(true);

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Generated title' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      openaiChatAdapter.call(
        [{ role: 'user', content: 'Make a title' }],
        { modelId: 'test-model' },
        'https://api.test.com',
        'sk-test',
        { thinking: false },
      ),
    ).resolves.toBe('Generated title');
  });
});
