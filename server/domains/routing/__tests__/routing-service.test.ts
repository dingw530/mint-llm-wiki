import { describe, expect, it, vi, beforeEach } from 'vitest';

process.env.AI_CHAT_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';

vi.mock('../../../infrastructure/persistence/agent-repository.js', () => ({
  findAll: vi.fn(),
  findById: vi.fn(),
}));

vi.mock('../../../infrastructure/ai/adapters/api-adapter.js', () => ({
  getAdapter: vi.fn(),
}));

import { RoutingService } from '../../../bootstrap/routing.js';
import { getAdapter } from '../../../infrastructure/ai/adapters/api-adapter.js';

describe('RoutingService', () => {
  let service: RoutingService;

  const agents = [
    {
      id: 'general',
      name: '通用',
      description: 'gen',
      type: 'general',
      systemPrompt: '',
      mcpServerIds: [],
      available: true,
      errorMessage: null,
      triggerKeywords: [],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'research',
      name: '研究',
      description: '研究',
      type: 'custom',
      systemPrompt: '',
      mcpServerIds: [],
      available: true,
      errorMessage: null,
      triggerKeywords: ['研究', '/^\\s*研究/'],
      createdAt: '',
      updatedAt: '',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RoutingService();
    vi.mocked(getAdapter).mockReturnValue({
      call: vi.fn().mockResolvedValue('research'),
      getUrl: vi.fn(),
      getHeaders: vi.fn(),
      buildRequest: vi.fn(),
      parseChunk: vi.fn(),
    } as any);
  });

  describe('keywordMatch', () => {
    it('returns null on no match', () => {
      expect(service.keywordMatch('你好', agents).agentId).toBeNull();
    });

    it('matches substring (0.6)', () => {
      const r = service.keywordMatch('今天研究如何', agents);
      expect(r.agentId).toBe('research');
      expect(r.confidence).toBe(0.6);
    });

    it('matches regex with leading whitespace (0.9)', () => {
      // `   研究abc` — "研究" is matched by the regex pattern
      const r = service.keywordMatch('   研究abc', agents);
      expect(r.agentId).toBe('research');
      expect(r.confidence).toBe(0.9);
    });

    it('regex beats substring on same match', () => {
      // Keyword "/^\\s*研究/" triggers regex match for "  研究abc"
      // Since regex score (0.9) > substring (0.6), regex wins
      const r = service.keywordMatch('   研究abc', agents);
      expect(r.confidence).toBe(0.9);
    });

    it('exact match scores 1.0', () => {
      const r = service.keywordMatch('研究', agents);
      expect(r.confidence).toBe(1.0);
    });

    it('skips unavailable agents', () => {
      const r = service.keywordMatch(
        '研究',
        agents.map((a) => ({ ...a, available: false })),
      );
      expect(r.agentId).toBeNull();
    });
  });

  describe('route', () => {
    it('falls back to general', async () => {
      expect((await service.route('你好', { agents })).agentId).toBe('general');
    });

    it('uses lockedAgent', async () => {
      expect((await service.route('hi', { agents, lockedAgent: 'research' })).agentId).toBe(
        'research',
      );
    });

    it('skips in manual mode', async () => {
      expect((await service.route('hi', { agents, routingMode: 'manual' })).agentId).toBe(
        'general',
      );
    });
  });

  describe('llmClassify', () => {
    it('null with only general', async () => {
      expect(await service.llmClassify('hi', [agents[0]])).toBeNull();
    });

    it('null when adapter missing', async () => {
      vi.mocked(getAdapter).mockReturnValue(undefined as any);
      expect(await service.llmClassify('a', [agents[1]])).toBeNull();
    });

    it('null on API error', async () => {
      vi.mocked(getAdapter).mockReturnValue({
        call: vi.fn().mockRejectedValue(new Error('e')),
      } as any);
      expect(await service.llmClassify('a', [agents[1]])).toBeNull();
    });

    it('null when agentId unknown', async () => {
      vi.mocked(getAdapter).mockReturnValue({ call: vi.fn().mockResolvedValue('nope') } as any);
      expect(await service.llmClassify('a', [agents[1]])).toBeNull();
    });
  });
});
