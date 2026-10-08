import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../infrastructure/ai/adapters/api-adapter.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../infrastructure/ai/adapters/api-adapter.js')>()),
  getAdapter: vi.fn(() => ({
    stream: vi.fn(),
    call: vi.fn(),
  })),
}));

vi.mock('../../../bootstrap/agent-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../bootstrap/agent-runtime.js')>()),
  getToolDefinitions: vi.fn(),
}));

import { streamChat, generateTitle } from '../ai-proxy.js';
import { getToolDefinitions } from '../../../bootstrap/agent-runtime.js';

describe('aiProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe('streamChat', () => {
    it('returns error when apiUrl missing', async () => {
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      const result = await streamChat([], { apiUrl: '', apiKey: 'key' } as any, sink);
      expect(result.content).toBe('');
      expect(sink.end).toHaveBeenCalled();
    });

    it('returns error when apiKey missing', async () => {
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      const result = await streamChat(
        [],
        { apiUrl: 'https://api.test.com', apiKey: '' } as any,
        sink,
      );
      expect(result.content).toBe('');
    });

    it('uses one AgentRun event contract for ordinary streamed answers', async () => {
      const adapter = vi.mocked(
        (await import('../../../infrastructure/ai/adapters/api-adapter.js')).getAdapter,
      )();
      adapter.stream = vi.fn(async () =>
        (async function* () {
          yield { content: 'hello' };
          yield { isFinished: true };
        })(),
      );
      vi.mocked(
        (await import('../../../infrastructure/ai/adapters/api-adapter.js')).getAdapter,
      ).mockReturnValue(adapter);
      vi.mocked(getToolDefinitions).mockResolvedValue([]);
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

      const result = await streamChat(
        [{ role: 'user', content: 'hi' }],
        { apiUrl: 'https://api.test.com', apiKey: 'key', apiType: 'openai-chat' },
        sink,
        'general',
        'conversation-1',
      );

      const events = sink.write.mock.calls.map(([data]) => JSON.parse(data));
      expect(result.content).toBe('hello');
      expect(events.map((event) => event.type)).toEqual(['run_started', 'answer', 'run_completed']);
      expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
      expect(new Set(events.map((event) => event.runId)).size).toBe(1);
    });
  });

  describe('generateTitle', () => {
    it('returns empty when apiUrl missing', async () => {
      const title = await generateTitle({ apiUrl: '', apiKey: '' } as any, 'hi', 'hello');
      expect(title).toBe('');
    });

    it('returns fallback on API error', async () => {
      // getAdapter returns a mock from the vi.mock above
      const { getAdapter } = await import('../../../infrastructure/ai/adapters/api-adapter.js');
      const mockAdapter = vi.mocked(getAdapter)();
      mockAdapter.call = vi.fn().mockRejectedValue(new Error('API fail'));
      vi.mocked(getAdapter).mockReturnValue(mockAdapter);

      const title = await generateTitle(
        { apiUrl: 'https://api.test.com', apiKey: 'sk-key', apiType: 'openai-chat' } as any,
        'Hello world this is a long message',
        'Response',
      );
      // Falls back to truncated title
      expect(title).toBeTruthy();
    });

    it('disables thinking for title generation', async () => {
      const { getAdapter } = await import('../../../infrastructure/ai/adapters/api-adapter.js');
      const mockAdapter = vi.mocked(getAdapter)();
      mockAdapter.call = vi.fn().mockResolvedValue('Chat title');
      vi.mocked(getAdapter).mockReturnValue(mockAdapter);

      const title = await generateTitle(
        { apiUrl: 'https://api.test.com', apiKey: 'sk-key', apiType: 'openai-chat' } as any,
        'Hello world',
        'Response',
      );

      expect(title).toBe('Chat title');
      expect(mockAdapter.call).toHaveBeenCalledWith(
        expect.any(Array),
        { modelId: undefined },
        'https://api.test.com',
        'sk-key',
        { maxTokens: 60, temperature: 0.5, thinking: false },
      );
    });
  });
});
