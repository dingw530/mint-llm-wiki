import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../repositories/memoryRepository.js', () => ({
  findAll: vi.fn(),
  create: vi.fn(),
  findByContent: vi.fn(),
  findByCategory: vi.fn(),
  findActiveProfile: vi.fn(),
  search: vi.fn(),
  findActiveByKey: vi.fn(),
  supersede: vi.fn(),
  update: vi.fn(),
  deleteById: vi.fn(),
  withTransaction: vi.fn((work: () => unknown) => work()),
  createEvent: vi.fn(),
}));

vi.mock('../../adapters/apiAdapter.js', () => ({
  AI_REQUEST_TIMEOUT_MS: 180_000,
  getAdapter: vi.fn(),
}));

import * as memoryService from '../memoryService.js';
import * as memoryRepo from '../../../repositories/memoryRepository.js';
import { getAdapter } from '../../adapters/apiAdapter.js';
import type { MemoryGateResolution } from '../../memoryGateProviders/types.js';
import type { Memory } from '../../../types.js';

const SAMPLE_MEMORIES: Memory[] = [
  {
    id: '1',
    content: '用户叫张三',
    category: 'personal',
    sourceConversationId: 'c1',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: '2',
    content: '喜欢简洁回答',
    category: 'preference',
    sourceConversationId: 'c1',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: '3',
    content: '项目信息',
    category: 'project',
    sourceConversationId: 'c2',
    createdAt: '',
    updatedAt: '',
  },
];

describe('memoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(memoryRepo.findActiveByKey).mockReturnValue([]);
    vi.mocked(memoryRepo.withTransaction).mockImplementation((work) => work());
  });

  describe('listMemories', () => {
    it('returns all when no category', () => {
      vi.mocked(memoryRepo.findAll).mockReturnValue(SAMPLE_MEMORIES);
      expect(memoryService.listMemories()).toHaveLength(3);
    });

    it('filters by category', () => {
      vi.mocked(memoryRepo.findByCategory).mockReturnValue([SAMPLE_MEMORIES[0]]);
      expect(memoryService.listMemories('personal')).toHaveLength(1);
    });

    it('returns empty if none', () => {
      vi.mocked(memoryRepo.findAll).mockReturnValue([]);
      expect(memoryService.listMemories()).toEqual([]);
    });
  });

  describe('createMemory', () => {
    it('creates', () => {
      const m: Memory = {
        id: 'n',
        content: 'x',
        category: 'general',
        sourceConversationId: null,
        createdAt: '',
        updatedAt: '',
      };
      vi.mocked(memoryRepo.create).mockReturnValue(m);
      expect(memoryService.createMemory({ id: 'n', content: 'x' }).content).toBe('x');
    });
  });

  describe('updateMemory', () => {
    it('updates existing', () => {
      const u = { ...SAMPLE_MEMORIES[0], content: 'updated' };
      vi.mocked(memoryRepo.update).mockReturnValue(u);
      expect(memoryService.updateMemory('1', { content: 'updated' })!.content).toBe('updated');
    });

    it('returns null on not found', () => {
      vi.mocked(memoryRepo.update).mockReturnValue(null);
      expect(memoryService.updateMemory('nope', { content: 'x' })).toBeNull();
    });
  });

  describe('deleteMemory', () => {
    it('deletes by id', () => {
      memoryService.deleteMemory('1');
      expect(memoryRepo.deleteById).toHaveBeenCalledWith('1');
    });
  });

  describe('buildMemoryContext', () => {
    it('empty when no memories', () => {
      vi.mocked(memoryRepo.findAll).mockReturnValue([]);
      expect(memoryService.buildMemoryContext()).toBe('');
    });

    it('groups by category order', () => {
      vi.mocked(memoryRepo.findAll).mockReturnValue(SAMPLE_MEMORIES);
      const ctx = memoryService.buildMemoryContext();
      expect(ctx).toContain('个人信息');
      expect(ctx).toContain('偏好');
      expect(ctx).toContain('项目信息');
      expect(ctx).toContain('张三');
    });
  });

  describe('isConversationValuable', () => {
    it('false for short', () => {
      expect(memoryService.isConversationValuable('你好')).toBe(false);
      expect(memoryService.isConversationValuable('')).toBe(false);
    });

    it('false for greetings', () => {
      expect(memoryService.isConversationValuable('哈哈')).toBe(false);
      expect(memoryService.isConversationValuable('谢谢')).toBe(false);
      expect(memoryService.isConversationValuable('hello')).toBe(false);
    });

    it('true for self-ref', () => {
      expect(memoryService.isConversationValuable('我叫张三做软件开发生涯')).toBe(true);
      expect(memoryService.isConversationValuable('我喜欢用TypeScript语言')).toBe(true);
      expect(memoryService.isConversationValuable('我的项目是一个AI应用')).toBe(true);
    });

    it('true for preferences', () => {
      expect(memoryService.isConversationValuable('我更喜欢简洁风格的回答')).toBe(true);
      expect(memoryService.isConversationValuable('我不喜欢太长回复内容')).toBe(true);
    });

    it('true for corrections', () => {
      expect(memoryService.isConversationValuable('不对我其实在上海工作')).toBe(true);
      expect(memoryService.isConversationValuable('你理解错我是前端工程师')).toBe(true);
    });
  });

  describe('extractMemoriesFromResponse', () => {
    it('parses valid lines', () => {
      const r = memoryService.extractMemoriesFromResponse('[personal] 张三\n[preference] 简洁\n');
      expect(r).toHaveLength(2);
      expect(r[0].category).toBe('personal');
    });

    it('filters invalid categories', () => {
      const r = memoryService.extractMemoriesFromResponse('[bad] x\n[personal] y\n');
      expect(r).toHaveLength(1);
      expect(r[0].content).toBe('y');
    });

    it('returns empty for no matches', () => {
      expect(memoryService.extractMemoriesFromResponse('abc')).toEqual([]);
      expect(memoryService.extractMemoriesFromResponse('')).toEqual([]);
    });
  });

  describe('structured memory operations', () => {
    it('parses JSON operations', () => {
      expect(
        memoryService.extractMemoryOperations(
          '{"operations":[{"action":"ADD","memoryKey":"personal.name","content":"用户叫张三"}]}',
        ),
      ).toHaveLength(1);
      expect(memoryService.extractMemoryOperations('not json')).toEqual([]);
    });

    it('rejects invalid action, oversized content, and non-finite score', () => {
      expect(
        memoryService.extractMemoryOperations('{"operations":[{"action":"UPSERT","content":"x"}]}'),
      ).toEqual([]);
      expect(
        memoryService.extractMemoryOperations(
          '{"operations":[{"action":"ADD","memoryKey":"   ","content":"x"}]}',
        ),
      ).toEqual([]);
      expect(
        memoryService.extractMemoryOperations(
          `{"operations":[{"action":"ADD","content":"${'x'.repeat(501)}"}]}`,
        ),
      ).toEqual([]);
      expect(
        memoryService.extractMemoryOperations(
          '{"operations":[{"action":"ADD","content":"x","confidence":2}]}',
        ),
      ).toEqual([]);
    });

    it('allows key-only DELETE and NOOP operations', () => {
      expect(
        memoryService.extractMemoryOperations(
          '{"operations":[{"action":"DELETE","memoryKey":"personal.name"},{"action":"NOOP","memoryKey":"personal.name"}]}',
        ),
      ).toHaveLength(2);
    });

    it('creates an updated fact and supersedes the active version', () => {
      vi.mocked(memoryRepo.findActiveByKey).mockReturnValue([SAMPLE_MEMORIES[0]]);
      vi.mocked(memoryRepo.create).mockReturnValue({
        ...SAMPLE_MEMORIES[0],
        content: '用户住在上海',
      });
      const result = memoryService.applyMemoryOperations(
        [
          {
            action: 'UPDATE',
            memoryKey: 'personal.location',
            subject: 'user',
            content: '用户住在上海',
          },
        ],
        'c2',
      );
      expect(memoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ memoryKey: 'personal.location' }),
      );
      expect(memoryRepo.supersede).toHaveBeenCalledWith('1', expect.any(String));
      expect(result).toHaveLength(1);
      expect(memoryRepo.withTransaction).toHaveBeenCalledTimes(1);
      expect(memoryRepo.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          status: 'applied',
          resultMemoryId: expect.any(String),
        }),
      );
      expect(memoryRepo.createEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.any(String) }),
      );
    });

    it('turns a duplicate ADD into an auditable NOOP', () => {
      vi.mocked(memoryRepo.findActiveByKey).mockReturnValue([SAMPLE_MEMORIES[0]]);
      const result = memoryService.applyMemoryOperations(
        [{ action: 'ADD', memoryKey: 'personal.name', content: SAMPLE_MEMORIES[0].content }],
        'c2',
        'job-1',
      );
      expect(result).toEqual([]);
      expect(memoryRepo.create).not.toHaveBeenCalled();
      expect(memoryRepo.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-1',
          action: 'ADD',
          status: 'noop',
          resultMemoryId: '1',
        }),
      );
    });
  });

  describe('performExtraction', () => {
    it('returns early when memory disabled', async () => {
      await memoryService.performExtraction({ memoryEnabled: false } as any, [], 'c1');
      expect(getAdapter).not.toHaveBeenCalled();
    });

    it('returns early when apiUrl missing', async () => {
      await memoryService.performExtraction(
        { memoryEnabled: true, apiUrl: '', apiKey: '' } as any,
        [],
        'c1',
      );
      expect(getAdapter).not.toHaveBeenCalled();
    });

    it('calls adapter and processes response', async () => {
      const mockAdapter = {
        call: vi.fn().mockResolvedValue('[personal] 测试信息\n[preference] 喜欢测试\n'),
        getUrl: vi.fn(),
        getHeaders: vi.fn(),
        buildRequest: vi.fn(),
        parseChunk: vi.fn(),
      };
      vi.mocked(getAdapter).mockReturnValue(mockAdapter as any);
      vi.mocked(memoryRepo.create).mockReturnValue({ ...SAMPLE_MEMORIES[0], id: 'created' });

      await memoryService.performExtraction(
        {
          memoryEnabled: true,
          apiUrl: 'https://api.test.com',
          apiKey: 'sk-key',
          apiType: 'openai-chat',
          modelId: 'gpt-4',
        } as any,
        [
          { id: 'u1', role: 'user', content: 'user msg', createdAt: '2026-08-03T00:00:00.000Z' },
          {
            id: 'a1',
            role: 'assistant',
            content: 'assistant msg',
            createdAt: '2026-08-03T00:00:01.000Z',
          },
        ],
        'conv-1',
      );

      expect(mockAdapter.call).toHaveBeenCalled();
      const transcript = mockAdapter.call.mock.calls[0][0][1].content;
      expect(transcript).toContain('(u1)');
      expect(transcript).toContain('(a1)');
      expect(transcript.indexOf('(u1)')).toBeLessThan(transcript.indexOf('(a1)'));
      expect(memoryRepo.create).toHaveBeenCalledTimes(2);
    });

    it('handles adapter timeout gracefully', async () => {
      const mockAdapter = {
        call: vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
        getUrl: vi.fn(),
        getHeaders: vi.fn(),
        buildRequest: vi.fn(),
        parseChunk: vi.fn(),
      };
      vi.mocked(getAdapter).mockReturnValue(mockAdapter as any);

      await memoryService.performExtraction(
        {
          memoryEnabled: true,
          apiUrl: 'https://api.test.com',
          apiKey: 'sk-key',
          apiType: 'openai-chat',
          modelId: 'gpt-4',
        } as any,
        [{ id: 'u1', role: 'user', content: 'user msg', createdAt: '2026-08-03T00:00:00.000Z' }],
        'conv-1',
      );

      // Should not throw
      expect(mockAdapter.call).toHaveBeenCalled();
    });

    it('does not fall back to legacy parsing after invalid structured JSON', async () => {
      const mockAdapter = {
        call: vi.fn().mockResolvedValue('{"operations":[{"action":"ADD","content":123}]}'),
        getUrl: vi.fn(),
        getHeaders: vi.fn(),
        buildRequest: vi.fn(),
        parseChunk: vi.fn(),
      };
      vi.mocked(getAdapter).mockReturnValue(mockAdapter as any);

      await memoryService.performExtraction(
        {
          memoryEnabled: true,
          apiUrl: 'https://api.test.com',
          apiKey: 'sk-key',
          apiType: 'openai-chat',
          modelId: 'gpt-4',
        } as any,
        [
          { id: 'u1', role: 'user', content: 'user msg', createdAt: '2026-08-03T00:00:00.000Z' },
          {
            id: 'a1',
            role: 'assistant',
            content: 'assistant msg',
            createdAt: '2026-08-03T00:00:01.000Z',
          },
        ],
        'conv-1',
      );

      expect(memoryRepo.create).not.toHaveBeenCalled();
      expect(memoryRepo.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'rejected',
          errorCode: 'memory_operation_schema_invalid',
        }),
      );
    });
  });
});

describe('recordMemoryGateOutcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(memoryRepo.withTransaction).mockImplementation((work: () => unknown) => work());
  });

  /** 构造一个"Jev 判定跳过"的门控结论。 */
  const declinedGate = (): MemoryGateResolution => ({
    memorize: false,
    providerId: 'jev',
    attempts: [{ providerId: 'jev', outcome: 'skip', latencyMs: 1 }],
  });

  it('records a memorized gate as applied with the Jev category', () => {
    memoryService.recordMemoryGateOutcome(
      {
        memorize: true,
        providerId: 'jev',
        hint: { category: 'project', importance: 3, action: 'ADD', confidence: 0.7, worth: 0.9 },
        attempts: [{ providerId: 'jev', outcome: 'memorize', latencyMs: 1 }],
      },
      'conv-1',
      'msg-1',
    );

    expect(memoryRepo.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GATE',
        conversationId: 'conv-1',
        sourceMessageId: 'msg-1',
        subject: 'user',
        memoryKey: 'project',
        status: 'applied',
      }),
    );
  });

  it('records a declined gate as noop', () => {
    memoryService.recordMemoryGateOutcome(declinedGate(), 'conv-1', 'msg-1');

    expect(memoryRepo.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'noop', memoryKey: 'general', errorCode: null }),
    );
  });

  it('records a degraded gate as failed with the Jev failure reason', () => {
    memoryService.recordMemoryGateOutcome(
      {
        memorize: false,
        providerId: 'legacy',
        attempts: [
          { providerId: 'jev', outcome: 'unavailable', reason: 'rate_limited', latencyMs: 1 },
          { providerId: 'legacy', outcome: 'skip', latencyMs: 1 },
        ],
      },
      'conv-1',
      'msg-1',
    );

    expect(memoryRepo.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorCode: 'jev_gate_rate_limited' }),
    );
  });

  it('never throws when the audit write fails', () => {
    vi.mocked(memoryRepo.createEvent).mockImplementationOnce(() => {
      throw new Error('db unavailable');
    });

    expect(() =>
      memoryService.recordMemoryGateOutcome(declinedGate(), 'conv-1', null),
    ).not.toThrow();
  });
});
