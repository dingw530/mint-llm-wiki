import { describe, expect, it, vi, beforeEach } from 'vitest';

const sessionMockState = vi.hoisted(() => ({
  initialEvents: [] as unknown[],
  lastEvents: [] as unknown[],
}));

vi.mock('../../../domains/conversations/index.js', () => ({
  findById: vi.fn(),
  updateTimestamp: vi.fn(),
}));

vi.mock('../../../repositories/messageRepository.js', () => ({
  findByConversationId: vi.fn(),
  create: vi.fn(),
  createWithMemoryScope: vi.fn(),
  getHistory: vi.fn(),
  getHistoryThroughMessageId: vi.fn(),
  updateConversationTimestamp: vi.fn(),
}));

vi.mock('../../../infrastructure/persistence/memory-scope-repository.js', () => ({
  findConversationScope: vi.fn(() => ({
    scopeKind: 'global',
    spaceId: null,
    bindingRevision: 1,
  })),
}));

vi.mock('../../../infrastructure/persistence/conversation-session-repository.js', () => ({
  ConversationSessionRepository: vi.fn().mockImplementation(() => {
    const events = [...sessionMockState.initialEvents];
    let lastSequence = events.length;
    return {
      ensureConversation: vi.fn(() => ({ lastSequence })),
      withTransaction: vi.fn((operation: () => unknown) => operation()),
      claimOwner: vi.fn((conversationId: string, ownerId: string) => ({
        conversationId,
        ownerId,
        ownerFence: 1,
        expiresAt: '2026-10-21T00:05:00.000Z',
      })),
      readAll: vi.fn(() => events),
      appendBatch: vi.fn(
        (
          _conversationId: string,
          expectedLastSequence: number,
          _fence: number,
          batch: unknown[],
        ) => {
          events.push(...batch);
          lastSequence = expectedLastSequence + batch.length;
          sessionMockState.lastEvents = [...events];
          return { lastSequence };
        },
      ),
      renewOwner: vi.fn((lease: unknown) => lease),
      releaseOwner: vi.fn(() => true),
    };
  }),
}));

vi.mock('../../../repositories/a2uiRepository.js', () => ({
  findUiBlocksByMessageId: vi.fn(() => []),
  createUiBlock: vi.fn(),
}));

vi.mock('../../settings/settings-service.js', () => ({
  getAiSettings: vi.fn(),
  getJevSettings: vi.fn(() => ({
    apiUrl: '',
    apiKey: '',
    model: '',
    timeoutMs: 0,
    routingEnabled: false,
    routingMinConfidence: 0,
    routingBypassOnKeyword: false,
    memoryEnabled: false,
    memoryGateThreshold: 0,
  })),
}));

vi.mock('../../../domains/memory/index.js', () => ({
  MEMORY_CONTEXT_PREFIX: '<user_memory>\\nMemory facts only.',
  MEMORY_CONTEXT_SUFFIX: '</user_memory>',
  createMemoryJobService: vi.fn(() => ({
    enqueueMemoryProcessing: vi.fn(),
    startMemoryProcessing: vi.fn(),
    stopMemoryProcessing: vi.fn(async () => undefined),
  })),
  buildMemoryContext: vi.fn(() => ''),
  prepareMemoryContext: vi.fn(() => ({
    text: '',
    observation: {
      totalBudget: 0,
      coreBudget: 0,
      estimatedTokens: 0,
      coreCandidateCount: 0,
      retrievalCandidateCount: 0,
      selectedCoreIds: [],
      selectedRetrievalIds: [],
      skipped: {},
    },
  })),
  performExtraction: vi.fn(),
  recordMemoryGateOutcome: vi.fn(),
  createMemory: vi.fn(),
  deleteMemory: vi.fn(),
  listMemories: vi.fn(),
  updateMemory: vi.fn(),
  evaluateMemoryGate: vi.fn(async () => ({
    memorize: false,
    providerId: 'legacy',
    attempts: [],
  })),
}));

vi.mock('../../../bootstrap/memory.js', () => ({
  trackMemoryGate: vi.fn((work: () => Promise<void>) => Promise.resolve().then(work)),
  enqueueMemoryProcessing: vi.fn(),
  evaluateMemoryGate: vi.fn(async () => ({
    memorize: false,
    providerId: 'legacy',
    attempts: [],
  })),
}));

vi.mock('../../../domains/agents/index.js', () => ({
  list: vi.fn(() => []),
  findById: vi.fn(),
}));

vi.mock('../../../bootstrap/routing.js', () => ({
  routingService: {
    route: vi.fn(),
  },
}));

vi.mock('../ai-proxy.js', () => ({
  streamChat: vi.fn(),
}));

vi.mock('../../../bootstrap/agent-runtime.js', () => ({
  runAgentChat: vi.fn(),
  getToolDefinitions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../agent-runtime/agent-run-recovery-service.js', () => ({
  buildToolRecoveryMessages: vi.fn(),
  claimRecoveryAction: vi.fn(),
  claimRecoveryActionForConversation: vi.fn(),
  completeRecoveryAction: vi.fn(),
  recoverAgentRun: vi.fn(),
}));

import * as conversationRepo from '../../../domains/conversations/index.js';
import * as messageRepo from '../../../repositories/messageRepository.js';
import * as a2uiRepository from '../../../repositories/a2uiRepository.js';
import * as settingsService from '../../settings/settings-service.js';
import * as memoryService from '../../../domains/memory/index.js';
import * as agentService from '../../../domains/agents/index.js';
import { enqueueMemoryProcessing } from '../../../bootstrap/memory.js';
import { evaluateMemoryGate } from '../../../bootstrap/memory.js';
import { routingService } from '../../../bootstrap/routing.js';
import { streamChat } from '../ai-proxy.js';
import { runAgentChat as reactChat } from '../../../bootstrap/agent-runtime.js';
import { getToolDefinitions } from '../../../bootstrap/agent-runtime.js';
import {
  buildToolRecoveryMessages,
  claimRecoveryAction,
  claimRecoveryActionForConversation,
  completeRecoveryAction,
  recoverAgentRun,
} from '../../agent-runtime/agent-run-recovery-service.js';
import { agentRunRegistry } from '../../../agent-runtime/agent-run.js';
import {
  sendMessage,
  getMessages,
  streamRecoveryAction,
  selectRegenerationHistory,
} from '../message-service.js';

describe('messageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMockState.initialEvents = [];
    sessionMockState.lastEvents = [];
    agentRunRegistry.clear();
    vi.mocked(agentService.findById).mockReturnValue(undefined);

    vi.mocked(conversationRepo.findById).mockReturnValue({
      id: 'conv-1',
      title: 'Test',
      type: 'text',
      lockedAgent: null,
      routingMode: 'auto',
      createdAt: '',
      updatedAt: '',
    });
    vi.mocked(messageRepo.getHistory).mockReturnValue([]);
    vi.mocked(messageRepo.getHistoryThroughMessageId).mockReturnValue([]);
    vi.mocked(settingsService.getAiSettings).mockReturnValue({
      apiUrl: 'https://api.test.com',
      apiKey: 'sk-key',
      modelId: 'gpt-4',
      apiType: 'openai-chat',
      systemPrompt: '',
      thinkingMode: false,
      memoryEnabled: false,
      reactMaxIterations: 5,
      toolMaxRetries: 3,
      showReactSteps: true,
      maxContextRounds: 10,
      wikiPath: '',
      wikiMaxFileSize: 10485760,
    });
    vi.mocked(streamChat).mockResolvedValue({
      content: 'response',
      reasoning: '',
      toolCalls: null,
    });
    vi.mocked(a2uiRepository.createUiBlock).mockImplementation(() => undefined);
  });

  it('replaces a plain assistant answer but refuses to repeat a tool-backed request', () => {
    const prefix = [{ role: 'user' as const, content: 'write report' }];
    expect(
      selectRegenerationHistory([...prefix, { role: 'assistant', content: 'old answer' }]).map(
        (message) => message.role,
      ),
    ).toEqual(['user']);

    try {
      selectRegenerationHistory([
        ...prefix,
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'write_file', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'success' },
      ]);
      throw new Error('expected regeneration to be rejected');
    } catch (error) {
      expect(error).toMatchObject({ status: 409 });
    }
  });

  it('streams a recovery successor from Session history and records its origin action', async () => {
    const recoveredMessages: HistoryMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'origin-call',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: '{"path":"report.md","content":"full text"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'origin-call',
        content: '{"originalRunId":"origin-run","errorCode":"OUTCOME_UNKNOWN"}',
      },
    ];
    vi.mocked(claimRecoveryActionForConversation).mockReturnValue({
      id: 'recovery-action',
      originRunId: 'origin-run',
      conversationId: 'conv-1',
      action: 'retry',
      idempotencyKey: 'recovery-key',
      successorRunId: 'successor-run',
      status: 'started',
    });
    sessionMockState.initialEvents = [
      {
        schemaVersion: 1,
        conversationId: 'conv-1',
        eventId: 'legacy-origin-message',
        seq: 1,
        runId: 'legacy-run',
        turnId: 'legacy-turn',
        createdAt: '2026-10-20T00:00:00.000Z',
        type: 'user_message',
        messageId: 'origin-message',
        content: 'write the report',
      },
    ];
    vi.mocked(recoverAgentRun).mockReturnValue({
      runId: 'origin-run',
      conversationId: 'conv-1',
      originMessageId: 'origin-message',
      agentId: 'general',
      executionMode: 'react',
      phase: 'running',
      sequence: 3,
      round: 1,
      toolCalls: [
        { callId: 'origin-call', toolName: 'write_file', status: 'tool_outcome_unknown' },
      ],
      terminal: false,
      recovery: 'interrupted',
      unknownToolCalls: ['origin-call'],
    });
    vi.mocked(buildToolRecoveryMessages).mockReturnValue(recoveredMessages);
    vi.mocked(getToolDefinitions).mockResolvedValueOnce([
      {
        type: 'function',
        function: { name: 'write_file', description: 'write a file', parameters: {} },
      },
    ]);
    vi.mocked(reactChat).mockResolvedValueOnce({
      content: 'checked state',
      reasoning: '',
      toolCalls: null,
    });
    const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

    await streamRecoveryAction('conv-1', 'recovery-action', sink);

    const requestMessages = vi.mocked(reactChat).mock.calls.at(-1)?.[0] ?? [];
    const restoredCallIndex = requestMessages.findIndex(
      (message) => message.role === 'assistant' && message.tool_calls?.[0]?.id === 'origin-call',
    );
    const recoveredResultIndex = requestMessages.findIndex(
      (message) => message.role === 'tool' && message.tool_call_id === 'origin-call',
    );
    expect(requestMessages[0]?.role).toBe('system');
    expect(requestMessages[1]?.content).toContain('用户已明确确认');
    expect(requestMessages[2]).toMatchObject({ role: 'user', content: 'write the report' });
    expect(requestMessages[restoredCallIndex]?.tool_calls?.[0]).toMatchObject({
      id: 'origin-call',
      function: { arguments: '{"path":"report.md","content":"full text"}' },
    });
    expect(requestMessages[recoveredResultIndex]).toMatchObject({
      role: 'tool',
      tool_call_id: 'origin-call',
    });
    expect(recoveredResultIndex).toBeGreaterThan(restoredCallIndex);
    expect(buildToolRecoveryMessages).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'origin-run' }),
    );
    expect(claimRecoveryActionForConversation).toHaveBeenCalledWith('recovery-action', 'conv-1');
    expect(completeRecoveryAction).toHaveBeenCalledWith('recovery-action');
    expect(sessionMockState.lastEvents).toContainEqual(
      expect.objectContaining({
        type: 'turn_started',
        runId: 'successor-run',
        originRunId: 'origin-run',
        recoveryActionId: 'recovery-action',
        recoveryAction: 'retry',
      }),
    );
  });

  describe('sendMessage', () => {
    it('throws 404 for non-existent conversation', async () => {
      vi.mocked(conversationRepo.findById).mockReturnValue(null);
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      await expect(sendMessage('nonexistent', 'hello', sink)).rejects.toThrow('not found');
    });

    it('saves user message and streams AI response', async () => {
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      await sendMessage('conv-1', 'hello', sink);
      expect(messageRepo.create).toHaveBeenCalledTimes(2); // user msg + AI response
      const sentMessages = vi.mocked(streamChat).mock.calls[0][0];
      expect(sentMessages[0].role).toBe('system');
      expect(sentMessages[0].content).toContain('遇到以 [压缩后的历史摘要] 开头的 user 消息时');
      expect(streamChat).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Object),
        expect.any(Object),
        'general',
        'conv-1',
        expect.anything(),
        expect.objectContaining({ sessionRecorder: expect.any(Object) }),
      );
    });

    it('repairs the previous tool call before adding the next user message to model history', async () => {
      const conversationId = 'conv-1';
      const runId = 'interrupted-run';
      const turnId = 'interrupted-turn';
      const eventBase = (eventId: string, seq: number) => ({
        schemaVersion: 1 as const,
        conversationId,
        eventId,
        seq,
        runId,
        turnId,
        createdAt: '2026-10-20T00:00:00.000Z',
      });
      sessionMockState.initialEvents = [
        { ...eventBase('turn-started', 1), type: 'turn_started' },
        {
          ...eventBase('old-user', 2),
          type: 'user_message',
          messageId: 'old-user-message',
          content: 'write a report',
        },
        {
          ...eventBase('model-tool-call', 3),
          type: 'model_message',
          round: 1,
          messages: [
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'write_file', arguments: '{"path":"report.md"}' },
                },
              ],
            },
          ],
        },
        {
          ...eventBase('dispatch-1', 4),
          type: 'tool_dispatch_committed',
          round: 1,
          callId: 'call-1',
          toolName: 'write_file',
          argumentsJson: '{"path":"report.md"}',
          retrySafety: 'never',
        },
      ];
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

      await sendMessage(conversationId, 'continue after the crash', sink);

      const modelMessages = vi.mocked(streamChat).mock.calls[0][0];
      const restoredCallIndex = modelMessages.findIndex(
        (message) => message.role === 'assistant' && message.tool_calls?.[0]?.id === 'call-1',
      );
      const recoveryResultIndex = modelMessages.findIndex(
        (message) => message.role === 'tool' && message.tool_call_id === 'call-1',
      );
      const newUserIndex = modelMessages.findIndex(
        (message) => message.role === 'user' && message.content === 'continue after the crash',
      );

      expect(restoredCallIndex).toBeGreaterThanOrEqual(0);
      expect(recoveryResultIndex).toBeGreaterThan(restoredCallIndex);
      expect(modelMessages[recoveryResultIndex]?.content).toContain('outcome is unknown');
      expect(newUserIndex).toBeGreaterThan(recoveryResultIndex);
    });

    it('adds scoped Bash cleanup guidance for Wiki lint handling', async () => {
      vi.mocked(settingsService.getAiSettings).mockReturnValue({
        apiUrl: 'https://api.test.com',
        apiKey: 'sk-key',
        modelId: 'gpt-4',
        apiType: 'openai-chat',
        systemPrompt: '',
        thinkingMode: false,
        memoryEnabled: false,
        reactMaxIterations: 5,
        toolMaxRetries: 3,
        showReactSteps: true,
        maxContextRounds: 10,
        wikiPath: '/tmp/wiki',
        wikiMaxFileSize: 10485760,
      });
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

      await sendMessage('conv-1', '处理 Wiki lint', sink);

      const sentMessages = vi.mocked(streamChat).mock.calls[0][0];
      const systemContent =
        sentMessages.find((message) => message.role === 'system')?.content || '';
      expect(systemContent).toContain('处理 wiki lint 时');
      expect(systemContent).toContain('可以使用 bash 删除该文件');
      expect(systemContent).toContain('不得删除其他路径或整个知识库目录');
    });

    it('does not re-save user message on regenerate', async () => {
      sessionMockState.initialEvents = [
        {
          schemaVersion: 1,
          conversationId: 'conv-1',
          eventId: 'existing-user',
          seq: 1,
          runId: 'existing-run',
          turnId: 'existing-turn',
          createdAt: '2026-10-20T00:00:00.000Z',
          type: 'user_message',
          messageId: 'existing-message',
          content: 'hello',
        },
      ];
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      await sendMessage('conv-1', 'hello', sink, undefined, true);
      expect(messageRepo.create).toHaveBeenCalledTimes(1); // only AI response
    });

    it('routes to locked agent', async () => {
      vi.mocked(conversationRepo.findById).mockReturnValue({
        id: 'conv-2',
        title: 'Locked',
        type: 'text',
        lockedAgent: 'general',
        routingMode: 'auto',
        createdAt: '',
        updatedAt: '',
      });
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      await sendMessage('conv-2', '请帮我查询信息', sink);
      expect(routingService.route).not.toHaveBeenCalled(); // locked agent skips routing
    });

    it('routes automatically in auto mode', async () => {
      vi.mocked(routingService.route).mockResolvedValue({
        agentId: 'general',
        confidence: 0.6,
        method: 'keyword',
        latencyMs: 10,
      });
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      await sendMessage('conv-1', '请帮我查询信息', sink);
      expect(routingService.route).toHaveBeenCalled();
    });

    it('skips routing in manual mode', async () => {
      vi.mocked(conversationRepo.findById).mockReturnValue({
        id: 'conv-3',
        title: 'Manual',
        type: 'text',
        lockedAgent: null,
        routingMode: 'manual',
        createdAt: '',
        updatedAt: '',
      });
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      await sendMessage('conv-3', 'hi', sink);
      expect(routingService.route).not.toHaveBeenCalled();
    });

    it('uses agent-specific system prompt', async () => {
      vi.mocked(agentService.findById).mockReturnValue({
        id: 'custom-agent',
        name: 'Custom',
        description: '',
        type: 'custom',
        systemPrompt: 'You are custom!',
        mcpServerIds: [],
        available: true,
        errorMessage: null,
        triggerKeywords: [],
        createdAt: '',
        updatedAt: '',
      });
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      await sendMessage('conv-1', 'hi', sink, 'custom-agent');
      // streamChat should be called with custom system prompt
      const systemContent = vi.mocked(streamChat).mock.calls[0][0][0].content || '';
      expect(systemContent).toContain('遇到以 [压缩后的历史摘要] 开头的 user 消息时');
      expect(systemContent).toContain('You are custom!');
    });

    it('injects memory context when enabled', async () => {
      vi.mocked(settingsService.getAiSettings).mockReturnValue({
        apiUrl: 'https://api.test.com',
        apiKey: 'sk-key',
        modelId: 'gpt-4',
        apiType: 'openai-chat',
        systemPrompt: 'base prompt',
        thinkingMode: false,
        memoryEnabled: true,
        reactMaxIterations: 5,
        toolMaxRetries: 3,
        showReactSteps: true,
        maxContextRounds: 10,
        wikiPath: '',
        wikiMaxFileSize: 10485760,
      });
      vi.mocked(memoryService.prepareMemoryContext).mockReturnValue({
        text: '记忆：用户在北京',
        observation: {
          totalBudget: 2_000,
          coreBudget: 500,
          estimatedTokens: 20,
          coreCandidateCount: 1,
          retrievalCandidateCount: 1,
          selectedCoreIds: [],
          selectedRetrievalIds: ['memory-1'],
          skipped: {},
        },
      });
      vi.mocked(messageRepo.getHistory).mockReturnValue([]);
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      await sendMessage('conv-1', 'hi', sink);
      expect(memoryService.prepareMemoryContext).toHaveBeenCalled();
      const memoryContextCall = vi.mocked(memoryService.prepareMemoryContext).mock.calls[0];
      expect(memoryContextCall[1]).toEqual({
        scopeKind: 'global',
        spaceId: null,
        bindingRevision: 1,
      });
      expect(memoryContextCall[2]).toMatchObject({ inputBudget: 95_904 });
      expect(Number.isSafeInteger(memoryContextCall[2]?.remainingInputTokens)).toBe(true);
      const sentMessages = vi.mocked(streamChat).mock.calls[0][0];
      const systemContent =
        sentMessages.find((message) => message.role === 'system')?.content || '';
      expect(systemContent).toContain('遇到以 [压缩后的历史摘要] 开头的 user 消息时');
      expect(systemContent).toContain('base prompt');
      expect(sentMessages.map((message) => message.role)).toEqual(['system', 'user', 'user']);
      expect(sentMessages[1].content).toContain('<user_memory>');
      expect(sentMessages[2].content).toBe('hi');
    });

    it('passes the assembled context to ReAct when tools are available', async () => {
      vi.mocked(settingsService.getAiSettings).mockReturnValue({
        apiUrl: 'https://api.test.com',
        apiKey: 'sk-key',
        modelId: 'gpt-4',
        apiType: 'openai-chat',
        systemPrompt: 'base prompt',
        thinkingMode: false,
        memoryEnabled: true,
        reactMaxIterations: 5,
        toolMaxRetries: 3,
        showReactSteps: true,
        maxContextRounds: 10,
        wikiPath: '',
        wikiMaxFileSize: 10485760,
      });
      vi.mocked(memoryService.prepareMemoryContext).mockReturnValue({
        text: '记忆：用户在北京',
        observation: {
          totalBudget: 2_000,
          coreBudget: 500,
          estimatedTokens: 20,
          coreCandidateCount: 1,
          retrievalCandidateCount: 1,
          selectedCoreIds: [],
          selectedRetrievalIds: ['memory-1'],
          skipped: {},
        },
      });
      vi.mocked(messageRepo.getHistory).mockReturnValue([]);
      vi.mocked(getToolDefinitions).mockResolvedValueOnce([
        {
          type: 'function',
          function: { name: 'lookup', description: 'lookup context', parameters: {} },
        },
      ]);
      vi.mocked(reactChat).mockResolvedValueOnce({
        content: 'response',
        reasoning: '',
        toolCalls: null,
      });
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

      await sendMessage('conv-1', 'hi', sink);

      const sentMessages = vi.mocked(reactChat).mock.calls[0][0];
      expect(sentMessages.map((message) => message.role)).toEqual(['system', 'user', 'user']);
      expect(sentMessages[0].content).toContain('遇到以 [压缩后的历史摘要] 开头的 user 消息时');
      expect(sentMessages[1].content).toContain('<user_memory>');
      expect(sentMessages[2].content).toBe('hi');
    });

    it('handles streaming errors gracefully', async () => {
      vi.mocked(streamChat).mockRejectedValue(new Error('API down'));
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      // Should not throw — errors are caught internally
      await sendMessage('conv-1', 'hi', sink);
      expect(sink.write).toHaveBeenCalledWith(expect.stringContaining('error'));
    });

    it('uses general agent when routing fails', async () => {
      vi.mocked(routingService.route).mockRejectedValue(new Error('routing error'));
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      await sendMessage('conv-1', 'hi', sink);
      // Falls back to general agent
      expect(streamChat).toHaveBeenCalled();
    });

    it('supports explicit agent override', async () => {
      vi.mocked(agentService.findById).mockReturnValue({
        id: 'custom-agent',
        name: 'Custom',
        description: '',
        type: 'custom',
        systemPrompt: 'You are a custom assistant',
        mcpServerIds: [],
        available: true,
        errorMessage: null,
        triggerKeywords: [],
        createdAt: '',
        updatedAt: '',
      });
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      await sendMessage('conv-1', 'custom request', sink, 'custom-agent');
      expect(streamChat).toHaveBeenCalled();
    });

    it('handles file attachments', async () => {
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      await sendMessage('conv-1', '', sink, undefined, false, [
        { name: 'test.txt', content: Buffer.from('hello').toString('base64'), type: 'text/plain' },
      ]);
      expect(messageRepo.create).toHaveBeenCalled();
    });

    it('persists UI blocks after the assistant message', async () => {
      vi.mocked(streamChat).mockResolvedValue({
        content: 'response',
        reasoning: '',
        toolCalls: null,
        uiBlocks: [
          {
            id: 'block-1',
            messageId: '',
            blockIndex: 0,
            textOffset: 8,
            kind: 'wiki_source_reference',
            version: 1,
            data: { refId: 'C1' },
            createdAt: '',
            updatedAt: '',
          },
        ],
      });
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      await sendMessage('conv-1', 'hi', sink);
      expect(a2uiRepository.createUiBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: expect.any(String),
          blockIndex: 0,
          kind: 'wiki_source_reference',
        }),
      );
    });

    it('keeps the text answer when UI block persistence fails', async () => {
      vi.mocked(streamChat).mockResolvedValue({
        content: 'response',
        reasoning: '',
        toolCalls: null,
        uiBlocks: [
          {
            id: 'block-1',
            messageId: '',
            blockIndex: 0,
            textOffset: 8,
            kind: 'wiki_source_reference',
            version: 1,
            data: { refId: 'C1' },
            createdAt: '',
            updatedAt: '',
          },
        ],
      });
      vi.mocked(a2uiRepository.createUiBlock).mockImplementation(() => {
        throw new Error('db unavailable');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };
      await sendMessage('conv-1', 'hi', sink);
      expect(messageRepo.create).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[a2ui] failed to persist UI block'),
        expect.objectContaining({ error: 'db unavailable' }),
      );
      errorSpy.mockRestore();
    });
  });

  describe('memory gate scheduling', () => {
    beforeEach(() => {
      vi.mocked(settingsService.getAiSettings).mockReturnValue({
        apiUrl: 'https://api.test.com',
        apiKey: 'sk-key',
        modelId: 'gpt-4',
        apiType: 'openai-chat',
        systemPrompt: '',
        thinkingMode: false,
        memoryEnabled: true,
        reactMaxIterations: 5,
        toolMaxRetries: 3,
        showReactSteps: true,
        maxContextRounds: 10,
        wikiPath: '',
        wikiMaxFileSize: 10485760,
      } as never);
    });

    it('ends the response before the gate settles', async () => {
      // 模拟真实流：streamChat 结束时调用 sink.end()，使 DeferredEndSink 有待刷出的 end。
      vi.mocked(streamChat).mockImplementationOnce(async (...args) => {
        args[2].end();
        return { content: 'response', reasoning: '', toolCalls: null };
      });
      let releaseGate: (() => void) | undefined;
      vi.mocked(evaluateMemoryGate).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseGate = () => resolve({ memorize: false, providerId: 'legacy', attempts: [] });
          }),
      );
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

      await sendMessage('conv-1', '我叫王丁，住在杭州', sink);

      // 门控仍在挂起，但响应已经结束 —— 证明门控不会延长单条消息的响应时间。
      expect(sink.end).toHaveBeenCalled();
      expect(evaluateMemoryGate).toHaveBeenCalled();
      expect(vi.mocked(evaluateMemoryGate).mock.invocationCallOrder[0]).toBeGreaterThan(
        vi.mocked(sink.end).mock.invocationCallOrder[0],
      );
      releaseGate?.();
    });

    it('records the gate outcome and enqueues extraction only when it memorizes', async () => {
      vi.mocked(evaluateMemoryGate).mockResolvedValueOnce({
        memorize: true,
        providerId: 'jev',
        attempts: [],
      });
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

      await sendMessage('conv-1', '我叫王丁，住在杭州', sink);
      await vi.waitFor(() => {
        expect(memoryService.recordMemoryGateOutcome).toHaveBeenCalled();
      });
      expect(enqueueMemoryProcessing).toHaveBeenCalled();
    });

    it('skips extraction when the gate declines', async () => {
      vi.mocked(evaluateMemoryGate).mockResolvedValueOnce({
        memorize: false,
        providerId: 'jev',
        attempts: [],
      });
      const sink = { write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false };

      await sendMessage('conv-1', '你好', sink);
      await vi.waitFor(() => {
        expect(memoryService.recordMemoryGateOutcome).toHaveBeenCalled();
      });
      expect(enqueueMemoryProcessing).not.toHaveBeenCalled();
    });
  });

  describe('getMessages', () => {
    it('returns messages for existing conversation', () => {
      sessionMockState.initialEvents = [
        {
          schemaVersion: 1,
          conversationId: 'conv-1',
          eventId: 'session-user-1',
          seq: 1,
          runId: 'run-1',
          turnId: 'turn-1',
          createdAt: '2026-10-21T00:00:00.000Z',
          type: 'user_message',
          messageId: 'm1',
          content: 'hi',
        },
        {
          schemaVersion: 1,
          conversationId: 'conv-1',
          eventId: 'session-assistant-1',
          seq: 2,
          runId: 'run-1',
          turnId: 'turn-1',
          createdAt: '2026-10-21T00:00:01.000Z',
          type: 'model_message',
          round: 1,
          messageId: 'assistant-1',
          messages: [{ role: 'assistant', content: 'hello' }],
        },
      ];
      vi.mocked(messageRepo.findByConversationId).mockReturnValue([
        {
          id: 'm1',
          conversationId: 'conv-1',
          role: 'user',
          content: 'hi',
          createdAt: '',
          reasoning: null,
        },
        {
          id: 'assistant-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'hello',
          createdAt: '2026-10-21T00:00:01.000Z',
          reasoning: null,
        },
      ]);
      const msgs = getMessages('conv-1');
      expect(msgs).toHaveLength(2);
      expect(msgs[1]).toMatchObject({ id: 'assistant-1', content: 'hello' });
      expect(a2uiRepository.findUiBlocksByMessageId).toHaveBeenCalledWith('assistant-1');
    });

    it('places recovered A2UI sources after the complete displayed answer', () => {
      const answer = '正文末尾展开。';
      sessionMockState.initialEvents = [
        {
          schemaVersion: 1,
          conversationId: 'conv-1',
          eventId: 'session-assistant-final',
          seq: 1,
          runId: 'run-1',
          turnId: 'turn-1',
          createdAt: '2026-10-21T00:00:01.000Z',
          type: 'model_message',
          round: 1,
          messageId: 'assistant-final',
          messages: [{ role: 'assistant', content: answer }],
        },
      ];
      vi.mocked(messageRepo.findByConversationId).mockReturnValue([]);
      vi.mocked(a2uiRepository.findUiBlocksByMessageId).mockReturnValue([
        {
          id: 'source-1',
          messageId: 'assistant-final',
          blockIndex: 0,
          textOffset: answer.length - 3,
          kind: 'wiki_source_reference',
          version: 1,
          data: { refId: 'C1' },
          createdAt: '2026-10-21T00:00:01.000Z',
          updatedAt: '2026-10-21T00:00:01.000Z',
        },
      ]);

      const [message] = getMessages('conv-1');

      expect(message?.content).toBe(answer);
      expect(message?.uiBlocks?.[0]?.textOffset).toBe(answer.length);
    });

    it('throws 404 for non-existent conversation', () => {
      vi.mocked(conversationRepo.findById).mockReturnValue(null);
      expect(() => getMessages('nonexistent')).toThrow('not found');
    });
  });
});
