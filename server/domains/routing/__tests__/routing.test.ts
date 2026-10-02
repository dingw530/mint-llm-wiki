import { describe, it, expect } from 'vitest';
import { RoutingService } from '../../../bootstrap/routing.js';
import { createLogger } from '../../../utils/logger.js';
import type { Agent } from '../../../types.js';

describe('RoutingService.keywordMatch', () => {
  const service = new RoutingService();

  const agents: Agent[] = [
    {
      id: 'research',
      name: '研究助手',
      description: '研究资料查询',
      type: 'custom',
      systemPrompt: null,
      mcpServerIds: [],
      available: true,
      errorMessage: null,
      triggerKeywords: ['研究', '资料', '查询', '/^今天\\s*(的)?[的]?(研究|资料)$/'],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'music',
      name: '音乐助手',
      description: '音乐推荐',
      type: 'custom',
      systemPrompt: null,
      mcpServerIds: [],
      available: true,
      errorMessage: null,
      triggerKeywords: ['音乐', '歌曲', '歌手'],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'general',
      name: '通用助手',
      description: '通用 AI 对话助手',
      type: 'general',
      systemPrompt: null,
      mcpServerIds: [],
      available: true,
      errorMessage: null,
      triggerKeywords: [],
      createdAt: '',
      updatedAt: '',
    },
  ];

  it('should return exact match with confidence 1.0', () => {
    const result = service.keywordMatch('研究', agents);
    expect(result.agentId).toBe('research');
    expect(result.confidence).toBe(1.0);
  });

  it('should return the highest scoring agent when multiple agents match', () => {
    // The custom agent keyword is a substring match (0.6)
    // No music agent keyword matches
    const result = service.keywordMatch('明天研究怎么样', agents);
    expect(result.agentId).toBe('research');
    expect(result.confidence).toBe(0.6);
  });

  it('should return null when no keywords match', () => {
    const result = service.keywordMatch('你好，今天有什么新闻', agents);
    expect(result.agentId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('should handle regex pattern keywords', () => {
    const result = service.keywordMatch('今天的资料', agents);
    expect(result.agentId).toBe('research');
    expect(result.confidence).toBe(0.9);
  });

  it('should handle substring partial match', () => {
    const result = service.keywordMatch('播放一首歌曲', agents);
    expect(result.agentId).toBe('music');
    expect(result.confidence).toBe(0.6);
  });

  it('should prefer exact match over substring match', () => {
    // Both agents match: exact match wins over substring
    const result = service.keywordMatch('研究', agents);
    expect(result.agentId).toBe('research');
    expect(result.confidence).toBe(1.0);
  });

  it('should handle empty agent list', () => {
    const result = service.keywordMatch('研究', []);
    expect(result.agentId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('should handle agent with no triggerKeywords', () => {
    const noKeywordsAgents: Agent[] = [
      {
        id: 'general',
        name: '通用助手',
        description: '通用助手',
        type: 'general',
        systemPrompt: null,
        mcpServerIds: [],
        available: true,
        errorMessage: null,
        triggerKeywords: [],
        createdAt: '',
        updatedAt: '',
      },
    ];
    const result = service.keywordMatch('研究', noKeywordsAgents);
    expect(result.agentId).toBeNull();
    expect(result.confidence).toBe(0);
  });
});

describe('RoutingService.route', () => {
  const service = new RoutingService();

  const agents: Agent[] = [
    {
      id: 'research',
      name: '研究助手',
      description: '研究资料查询',
      type: 'custom',
      systemPrompt: null,
      mcpServerIds: [],
      available: true,
      errorMessage: null,
      triggerKeywords: ['研究', '资料'],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'general',
      name: '通用助手',
      description: '通用 AI 对话助手',
      type: 'general',
      systemPrompt: null,
      mcpServerIds: [],
      available: true,
      errorMessage: null,
      triggerKeywords: [],
      createdAt: '',
      updatedAt: '',
    },
  ];

  it('should skip routing and return lockedAgent when lockedAgent is set', async () => {
    const result = await service.route('研究怎么样', {
      agents,
      lockedAgent: 'general',
    });
    expect(result.agentId).toBe('general');
    expect(result.confidence).toBe(1.0);
    expect(result.method).toBe('fallback');
  });

  it('should skip routing when routingMode is manual', async () => {
    const result = await service.route('研究怎么样', {
      agents,
      routingMode: 'manual',
    });
    expect(result.agentId).toBe('general');
    expect(result.confidence).toBe(0);
    expect(result.method).toBe('fallback');
  });

  it('should return agent directly via keyword when confidence > 0.8', async () => {
    const result = await service.route('研究', {
      agents,
    });
    expect(result.agentId).toBe('research');
    expect(result.confidence).toBe(1.0);
    expect(result.method).toBe('keyword');
  });

  it('should fallback to general when agents list is empty', async () => {
    const result = await service.route('研究怎么样', {
      agents: [],
    });
    expect(result.agentId).toBe('general');
    expect(result.confidence).toBe(0);
    expect(result.method).toBe('fallback');
  });

  it('should fallback to general when keyword has low confidence', async () => {
    const lowMatchAgents: Agent[] = [
      {
        id: 'research',
        name: '研究助手',
        description: '研究资料查询',
        type: 'custom',
        systemPrompt: null,
        mcpServerIds: [],
        available: true,
        errorMessage: null,
        triggerKeywords: ['论文资料'], // won't match '研究'
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'general',
        name: '通用助手',
        description: '通用助手',
        type: 'general',
        systemPrompt: null,
        mcpServerIds: [],
        available: true,
        errorMessage: null,
        triggerKeywords: [],
        createdAt: '',
        updatedAt: '',
      },
    ];
    const result = await service.route('今天研究怎么样', { agents: lowMatchAgents });
    expect(result.agentId).toBe('general');
    expect(result.method).toBe('fallback');
  });

  it('should have latencyMs >= 0', async () => {
    const result = await service.route('研究', { agents });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should return general when no agent matches and no lockedAgent', async () => {
    const result = await service.route('今天有什么新闻', { agents });
    expect(result.agentId).toBe('general');
    expect(result.confidence).toBe(0);
    expect(result.method).toBe('fallback');
  });

  it('should handle beforeRoute hook skip', async () => {
    const serviceWithHook = new RoutingService({
      beforeRoute: async () => ({ skip: true, message: undefined }),
    });
    const result = await serviceWithHook.route('研究', { agents });
    expect(result.agentId).toBe('general');
    expect(result.confidence).toBe(0);
    expect(result.method).toBe('fallback');
  });

  it('should handle beforeRoute hook message override', async () => {
    const serviceWithHook = new RoutingService({
      beforeRoute: async () => ({ message: '音乐' }),
    });
    const agents4: Agent[] = [
      ...agents,
      {
        id: 'music',
        name: '音乐助手',
        description: '音乐推荐',
        type: 'custom',
        systemPrompt: null,
        mcpServerIds: [],
        available: true,
        errorMessage: null,
        triggerKeywords: ['音乐'],
        createdAt: '',
        updatedAt: '',
      },
    ];
    const result = await serviceWithHook.route('研究', { agents: agents4 });
    // The message was overridden to '音乐', which matches music agent
    expect(result.agentId).toBe('music');
    expect(result.method).toBe('keyword');
  });
});

describe('RoutingService.llmClassify', () => {
  const service = new RoutingService();

  it('should return null when only general agent is available', async () => {
    const result = await service.llmClassify('研究', [
      {
        id: 'general',
        name: '通用助手',
        description: '通用助手',
        type: 'general',
        systemPrompt: null,
        mcpServerIds: [],
        available: true,
        errorMessage: null,
        triggerKeywords: [],
        createdAt: '',
        updatedAt: '',
      },
    ]);
    expect(result).toBeNull();
  });

  it('should return null when all agents are unavailable', async () => {
    const result = await service.llmClassify('研究', [
      {
        id: 'research',
        name: '研究助手',
        description: '研究资料',
        type: 'custom',
        systemPrompt: null,
        mcpServerIds: [],
        available: false,
        errorMessage: null,
        triggerKeywords: [],
        createdAt: '',
        updatedAt: '',
      },
    ]);
    expect(result).toBeNull();
  });
});

// ── Logger 单元测试 ──

describe('Logger', () => {
  it('should output valid JSON for each log level', () => {
    const logger = createLogger('test-module');
    const lines: string[] = [];

    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: unknown): boolean => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      logger.debug('debug message', { key: 'value' });
      logger.info('info message');
      logger.warn('warn message', { count: 42 });
      logger.error('error message', { code: 500 });

      expect(lines.length).toBe(4);

      for (const line of lines) {
        const parsed = JSON.parse(line.trim());
        expect(parsed).toHaveProperty('timestamp');
        expect(parsed).toHaveProperty('level');
        expect(parsed).toHaveProperty('module', 'test-module');
        expect(parsed).toHaveProperty('message');
      }

      // debug level
      const debugEntry = JSON.parse(lines[0].trim());
      expect(debugEntry.level).toBe('debug');
      expect(debugEntry.message).toBe('debug message');
      expect(debugEntry.data).toEqual({ key: 'value' });

      // info level without data
      const infoEntry = JSON.parse(lines[1].trim());
      expect(infoEntry.level).toBe('info');
      expect(infoEntry.data).toBeUndefined();

      // warn level
      const warnEntry = JSON.parse(lines[2].trim());
      expect(warnEntry.level).toBe('warn');
      expect(warnEntry.message).toBe('warn message');
      expect(warnEntry.data).toEqual({ count: 42 });

      // error level
      const errorEntry = JSON.parse(lines[3].trim());
      expect(errorEntry.level).toBe('error');
      expect(errorEntry.message).toBe('error message');
      expect(errorEntry.data).toEqual({ code: 500 });
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it('should output ISO 8601 timestamps', () => {
    const logger = createLogger('ts-test');
    const lines: string[] = [];

    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: unknown): boolean => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      logger.info('timestamp test');
      const parsed = JSON.parse(lines[0].trim());
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    } finally {
      process.stdout.write = origWrite;
    }
  });
});
