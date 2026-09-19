import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// Ensure encryption key is set
if (!process.env.AI_CHAT_ENCRYPTION_KEY) {
  process.env.AI_CHAT_ENCRYPTION_KEY = crypto.randomBytes(16).toString('hex');
}

// ── retryWrapper Tests ──

describe('retryWrapper', () => {
  it('should succeed on first attempt', async () => {
    const { retry } = await import('../utils/retryWrapper.js');
    const fn = vi.fn().mockResolvedValue('success');
    const result = await retry(fn, { maxRetries: 3, baseDelay: 1, maxDelay: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    const { retry } = await import('../utils/retryWrapper.js');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');
    const result = await retry(fn, { maxRetries: 3, baseDelay: 1, maxDelay: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw after all retries exhausted', async () => {
    const { retry } = await import('../utils/retryWrapper.js');
    const fn = vi.fn().mockRejectedValue(new Error('persistent error'));
    await expect(retry(fn, { maxRetries: 2, baseDelay: 1, maxDelay: 10 })).rejects.toThrow(
      'persistent error',
    );
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('should call onRetry callback on each failure', async () => {
    const { retry } = await import('../utils/retryWrapper.js');
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const onRetry = vi.fn();
    await expect(retry(fn, { maxRetries: 2, baseDelay: 1, maxDelay: 10, onRetry })).rejects.toThrow(
      'fail',
    );
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
    expect(onRetry).toHaveBeenCalledWith(2, expect.any(Error));
  });

  it('should abort immediately when signal is already aborted', async () => {
    const { retry } = await import('../utils/retryWrapper.js');
    const abortController = new AbortController();
    abortController.abort();
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(
      retry(fn, { maxRetries: 5, baseDelay: 1000, maxDelay: 5000, signal: abortController.signal }),
    ).rejects.toThrow('Retry aborted');
    expect(fn).toHaveBeenCalledTimes(0); // 预中止时不执行
  });

  it('should handle maxRetries = 0 (no retry)', async () => {
    const { retry } = await import('../utils/retryWrapper.js');
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(retry(fn, { maxRetries: 0, baseDelay: 1, maxDelay: 10 })).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ── Tool Routing Tests ──

describe('Tool Routing — messageService reactChat vs streamChat', () => {
  function createMockSink() {
    let ended = false;
    return {
      write: vi.fn(),
      end: vi.fn(() => {
        ended = true;
      }),
      get headersSent() {
        return true;
      },
      get writableEnded() {
        return ended;
      },
    };
  }

  beforeEach(() => {
    vi.resetModules();
  });

  it('should route to streamChat when agent has no tools', async () => {
    // Mock toolRegistry to return empty tools
    vi.doMock('../toolOrchestration.js', () => ({
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      executeTool: vi.fn(),
    }));

    // Mock aiProxy to track calls
    const streamChatMock = vi
      .fn()
      .mockResolvedValue({ content: 'stream-response', reasoning: '', toolCalls: null });
    const reactChatMock = vi.fn();

    vi.doMock('../aiProxy.js', () => ({
      streamChat: streamChatMock,
    }));
    vi.doMock('../reactLoopCore.js', () => ({
      reactChat: reactChatMock,
    }));

    // Mock other dependencies
    vi.doMock('../api/settingsService.js', () => ({
      getAiSettings: vi.fn().mockReturnValue({
        apiUrl: 'https://api.test.com/v1',
        apiKey: 'test-key',
        modelId: 'test-model',
        systemPrompt: '',
        thinkingMode: false,
        memoryEnabled: false,
        reactMaxIterations: 5,
        toolMaxRetries: 5,
        showReactSteps: true,
        apiType: 'openai-chat',
      }),
      getJevSettings: vi.fn().mockReturnValue({
        apiUrl: '',
        apiKey: '',
        model: '',
        timeoutMs: 0,
        routingEnabled: false,
        routingMinConfidence: 0,
        routingBypassOnKeyword: false,
        memoryEnabled: false,
        memoryGateThreshold: 0,
      }),
    }));

    vi.doMock('../../repositories/conversationRepository.js', () => ({
      findById: vi.fn().mockReturnValue({ id: 'conv-1', title: 'Test', routingMode: 'auto' }),
      updateTimestamp: vi.fn(),
    }));

    vi.doMock('../../repositories/messageRepository.js', () => ({
      create: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      updateConversationTimestamp: vi.fn(),
    }));

    vi.doMock('../../repositories/agentRepository.js', () => ({
      findById: vi.fn().mockReturnValue(null),
    }));

    vi.doMock('../api/routingService.js', () => ({
      routingService: {
        route: vi.fn().mockResolvedValue({ agentId: 'general', confidence: 0, method: 'fallback' }),
      },
    }));

    vi.doMock('../api/memoryService.js', () => ({
      buildMemoryContext: vi.fn().mockReturnValue(''),
      isConversationValuable: vi.fn().mockReturnValue(false),
      performExtraction: vi.fn(),
      recordMemoryGateOutcome: vi.fn(),
    }));

    vi.doMock('../api/agentService.js', () => ({
      list: vi.fn().mockReturnValue([]),
      findById: vi.fn().mockReturnValue(null),
    }));

    vi.doMock('../../utils/logger.js', () => ({
      createLogger: vi.fn().mockReturnValue({ info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
    }));

    const { sendMessage } = await import('../messageService.js');
    await sendMessage('conv-1', 'Hello', createMockSink());
    expect(streamChatMock).toHaveBeenCalled();
  });

  it('should route to reactChat when agent has tools', async () => {
    const mockToolDef = {
      type: 'function',
      function: { name: 'test_tool', description: 'Test', parameters: {} },
    };

    vi.doMock('../toolOrchestration.js', () => ({
      getAllToolDefinitions: vi.fn().mockResolvedValue([mockToolDef]),
      executeTool: vi.fn(),
    }));

    const streamChatMock = vi.fn();
    const reactChatMock = vi
      .fn()
      .mockResolvedValue({ content: 'react-response', reasoning: '', toolCalls: null });

    vi.doMock('../aiProxy.js', () => ({
      streamChat: streamChatMock,
    }));
    vi.doMock('../reactLoopCore.js', () => ({
      reactChat: reactChatMock,
    }));

    vi.doMock('../api/settingsService.js', () => ({
      getAiSettings: vi.fn().mockReturnValue({
        apiUrl: 'https://api.test.com/v1',
        apiKey: 'test-key',
        modelId: 'test-model',
        systemPrompt: '',
        thinkingMode: false,
        memoryEnabled: false,
        reactMaxIterations: 5,
        toolMaxRetries: 5,
        showReactSteps: true,
        apiType: 'openai-chat',
      }),
      getJevSettings: vi.fn().mockReturnValue({
        apiUrl: '',
        apiKey: '',
        model: '',
        timeoutMs: 0,
        routingEnabled: false,
        routingMinConfidence: 0,
        routingBypassOnKeyword: false,
        memoryEnabled: false,
        memoryGateThreshold: 0,
      }),
    }));

    vi.doMock('../../repositories/conversationRepository.js', () => ({
      findById: vi.fn().mockReturnValue({ id: 'conv-1', title: 'Test', routingMode: 'auto' }),
      updateTimestamp: vi.fn(),
    }));

    vi.doMock('../../repositories/messageRepository.js', () => ({
      create: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      updateConversationTimestamp: vi.fn(),
    }));

    vi.doMock('../../repositories/agentRepository.js', () => ({
      findById: vi.fn().mockReturnValue(null),
    }));

    vi.doMock('../api/routingService.js', () => ({
      routingService: {
        route: vi
          .fn()
          .mockResolvedValue({ agentId: 'custom-agent', confidence: 0.9, method: 'keyword' }),
      },
    }));

    vi.doMock('../api/memoryService.js', () => ({
      buildMemoryContext: vi.fn().mockReturnValue(''),
      isConversationValuable: vi.fn().mockReturnValue(false),
      performExtraction: vi.fn(),
      recordMemoryGateOutcome: vi.fn(),
    }));

    // Mock agentRepo.findById to return an agent with type != 'orchestrator'
    vi.doMock('../../repositories/agentRepository.js', () => ({
      findById: vi.fn().mockReturnValue({
        id: 'custom-agent',
        name: 'Custom',
        type: 'custom',
        available: true,
        mcpServerIds: [],
        systemPrompt: null,
      }),
      findAll: vi.fn().mockReturnValue([]),
    }));

    vi.doMock('../api/agentService.js', () => ({
      list: vi
        .fn()
        .mockReturnValue([{ id: 'custom-agent', name: 'Custom', type: 'custom', available: true }]),
      findById: vi
        .fn()
        .mockReturnValue({
          id: 'custom-agent',
          name: 'Custom',
          type: 'custom',
          available: true,
          mcpServerIds: [],
          systemPrompt: null,
        }),
    }));

    vi.doMock('../../utils/logger.js', () => ({
      createLogger: vi.fn().mockReturnValue({ info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
    }));

    const { sendMessage } = await import('../messageService.js');
    const mockSink = createMockSink();

    await sendMessage('conv-1', 'What is the request?', mockSink, 'custom-agent');
    expect(reactChatMock).toHaveBeenCalled();
  });

  it('should use streamChat when reactMaxIterations is 0', async () => {
    const mockToolDef = {
      type: 'function',
      function: { name: 'test_tool', description: 'Test', parameters: {} },
    };

    vi.doMock('../toolOrchestration.js', () => ({
      getAllToolDefinitions: vi.fn().mockResolvedValue([mockToolDef]),
      executeTool: vi.fn(),
    }));

    const streamChatMock = vi
      .fn()
      .mockResolvedValue({ content: 'stream-response', reasoning: '', toolCalls: null });
    const reactChatMock = vi.fn();

    vi.doMock('../aiProxy.js', () => ({
      streamChat: streamChatMock,
    }));
    vi.doMock('../reactLoopCore.js', () => ({
      reactChat: reactChatMock,
    }));

    vi.doMock('../api/settingsService.js', () => ({
      getAiSettings: vi.fn().mockReturnValue({
        apiUrl: 'https://api.test.com/v1',
        apiKey: 'test-key',
        modelId: 'test-model',
        systemPrompt: '',
        thinkingMode: false,
        memoryEnabled: false,
        reactMaxIterations: 0, // ReAct disabled
        toolMaxRetries: 0,
        showReactSteps: true,
        apiType: 'openai-chat',
      }),
      getJevSettings: vi.fn().mockReturnValue({
        apiUrl: '',
        apiKey: '',
        model: '',
        timeoutMs: 0,
        routingEnabled: false,
        routingMinConfidence: 0,
        routingBypassOnKeyword: false,
        memoryEnabled: false,
        memoryGateThreshold: 0,
      }),
    }));

    vi.doMock('../../repositories/conversationRepository.js', () => ({
      findById: vi.fn().mockReturnValue({ id: 'conv-1', title: 'Test', routingMode: 'auto' }),
      updateTimestamp: vi.fn(),
    }));

    vi.doMock('../../repositories/messageRepository.js', () => ({
      create: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      updateConversationTimestamp: vi.fn(),
    }));

    vi.doMock('../../repositories/agentRepository.js', () => ({
      findById: vi.fn().mockReturnValue(null),
    }));

    vi.doMock('../api/routingService.js', () => ({
      routingService: {
        route: vi.fn().mockResolvedValue({ agentId: 'general', confidence: 0, method: 'fallback' }),
      },
    }));

    vi.doMock('../api/memoryService.js', () => ({
      buildMemoryContext: vi.fn().mockReturnValue(''),
      isConversationValuable: vi.fn().mockReturnValue(false),
      performExtraction: vi.fn(),
      recordMemoryGateOutcome: vi.fn(),
    }));

    vi.doMock('../api/agentService.js', () => ({
      list: vi.fn().mockReturnValue([]),
      findById: vi
        .fn()
        .mockReturnValue({
          id: 'custom-agent',
          name: 'Custom',
          type: 'custom',
          available: true,
          mcpServerIds: [],
          systemPrompt: null,
        }),
    }));

    vi.doMock('../../utils/logger.js', () => ({
      createLogger: vi.fn().mockReturnValue({ info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
    }));

    const { sendMessage } = await import('../messageService.js');
    await sendMessage('conv-1', 'Hello', createMockSink(), 'custom-agent');
    expect(streamChatMock).toHaveBeenCalled();
    expect(reactChatMock).not.toHaveBeenCalled();
  });
});
