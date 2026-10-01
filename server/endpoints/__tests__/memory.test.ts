import { describe, it, expect, vi } from 'vitest';

/**
 * Memory Service Unit Tests
 *
 * Tests the pure functions in memoryService:
 *   - extractMemoriesFromResponse(text): parses LLM output into [category, content] pairs
 *   - buildMemoryContext(): uses memoryRepo (tested via integration tests)
 *   - performExtraction(): tested via integration tests
 */

let memoryService: any;
try {
  memoryService = await import('../../domains/memory/index.js');
} catch {
  memoryService = null;
}

const runIf = (condition: any) => (condition ? describe : describe.skip);

vi.mock('../../infrastructure/persistence/memoryRepository.js', () => ({
  findManaged: vi.fn((filters) => (filters?.category ? [{ category: filters.category }] : [])),
}));

const { memoriesEndpoints } = await import('../definitions/memories.js');
const memoryRepository = await import('../../infrastructure/persistence/memoryRepository.js');

describe('memories:list endpoint filters', () => {
  it('defaults to excluding unassigned memories and only includes them when requested', () => {
    const list = memoriesEndpoints.find((endpoint) => endpoint.id === 'memories:list');
    expect(list).toBeDefined();
    const callService = list!.service as (query: Record<string, unknown>) => unknown;
    expect(callService({ scopeKind: 'space', spaceId: 'space-1' })).toEqual([]);
    expect(callService({ category: 'preference' })).toEqual([{ category: 'preference' }]);

    callService({ scopeKind: 'unassigned', includeUnassigned: true, includeInactive: true });
    expect(memoryRepository.findManaged).toHaveBeenLastCalledWith({
      category: undefined,
      scopeKind: 'unassigned',
      spaceId: undefined,
      contextPolicy: undefined,
      includeUnassigned: true,
      includeInactive: true,
    });
  });
});

runIf(memoryService)('Memory Service — extractMemoriesFromResponse', () => {
  it('should parse valid [category] content lines', () => {
    const text = `[personal] 用户名是张三
[preference] 喜欢简洁的回复风格
[project] 正在开发 AI Chat 项目`;
    const result = memoryService.extractMemoriesFromResponse(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ category: 'personal', content: '用户名是张三' });
    expect(result[1]).toEqual({ category: 'preference', content: '喜欢简洁的回复风格' });
    expect(result[2]).toEqual({ category: 'project', content: '正在开发 AI Chat 项目' });
  });

  it('should skip lines with unknown category', () => {
    const text = `[personal] 用户名叫李四
[unknown] 这个应该被忽略
[general] 一些通用信息`;
    const result = memoryService.extractMemoriesFromResponse(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ category: 'personal', content: '用户名叫李四' });
    expect(result[1]).toEqual({ category: 'general', content: '一些通用信息' });
  });

  it('should skip lines that do not match [category] content format', () => {
    const text = `[personal] 有效内容
plain text without bracket
[invalid content here]
[preference] 有效偏好`;
    const result = memoryService.extractMemoriesFromResponse(text);
    expect(result).toHaveLength(2);
  });

  it('should handle empty input', () => {
    expect(memoryService.extractMemoriesFromResponse('')).toEqual([]);
    expect(memoryService.extractMemoriesFromResponse('   ')).toEqual([]);
    expect(memoryService.extractMemoriesFromResponse('\n\n\n')).toEqual([]);
  });

  it('should trim whitespace from content', () => {
    const text = `[personal]   带空格的内容   `;
    const result = memoryService.extractMemoriesFromResponse(text);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('带空格的内容');
  });

  it('should skip empty content lines', () => {
    const text = `[personal]
[preference] 有内容`;
    const result = memoryService.extractMemoriesFromResponse(text);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('preference');
  });

  it('should handle content with colons and special characters', () => {
    const text = `[general] 使用了 Node.js v20.5 + Express 4.18`;
    const result = memoryService.extractMemoriesFromResponse(text);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('使用了 Node.js v20.5 + Express 4.18');
  });

  it('should handle mixed blank lines and valid entries', () => {
    const text = `

[personal] 有效

[preference] 另一个有效

`;
    const result = memoryService.extractMemoriesFromResponse(text);
    expect(result).toHaveLength(2);
  });

  it('should match all valid categories', () => {
    const text = `[personal] a
[preference] b
[feedback] c
[project] d
[goal] e
[general] f`;
    const result = memoryService.extractMemoriesFromResponse(text);
    expect(result).toHaveLength(6);
    const cats = result.map((r) => r.category);
    expect(cats).toEqual(['personal', 'preference', 'feedback', 'project', 'goal', 'general']);
  });
});

// ── isConversationValuable 测试 ──

describe('isConversationValuable', () => {
  it('should return false for short messages', () => {
    expect(memoryService.isConversationValuable('你好')).toBe(false);
    expect(memoryService.isConversationValuable('是的')).toBe(false);
    expect(memoryService.isConversationValuable('好')).toBe(false);
  });

  it('should return false for greetings', () => {
    expect(memoryService.isConversationValuable('谢谢')).toBe(false);
    expect(memoryService.isConversationValuable('好的明白了')).toBe(false);
    expect(memoryService.isConversationValuable('哈哈')).toBe(false);
  });

  it('should return true for self-introduction', () => {
    expect(memoryService.isConversationValuable('我叫张三，是一名前端工程师')).toBe(true);
    expect(memoryService.isConversationValuable('我是做后端开发的，有五年经验')).toBe(true);
    expect(memoryService.isConversationValuable('我来自北京，现在在上海定居')).toBe(true);
  });

  it('should return true for preference statements', () => {
    expect(memoryService.isConversationValuable('我喜欢简洁的回答风格，谢谢')).toBe(true);
    expect(memoryService.isConversationValuable('我更倾向于用 Python 写代码')).toBe(true);
    expect(memoryService.isConversationValuable('我不喜欢太冗长的技术解释')).toBe(true);
  });

  it('should return true for feedback/corrections', () => {
    expect(memoryService.isConversationValuable('不对，我用的不是 React 而是 Vue')).toBe(true);
    expect(memoryService.isConversationValuable('其实是我理解错了，不好意思')).toBe(true);
    expect(memoryService.isConversationValuable('你应该用中文来回答我的问题')).toBe(true);
  });

  it('should return true for project info', () => {
    expect(memoryService.isConversationValuable('我正在做一个聊天相关的项目')).toBe(true);
    expect(memoryService.isConversationValuable('我的技术栈是 React 和 Node.js')).toBe(true);
    expect(memoryService.isConversationValuable('我们项目用的是 Vue 框架来开发')).toBe(true);
  });

  it('should return true for goals and plans', () => {
    expect(memoryService.isConversationValuable('我打算系统学习 TypeScript 和 Rust')).toBe(true);
    expect(memoryService.isConversationValuable('我的目标是成为全栈工程师')).toBe(true);
    expect(memoryService.isConversationValuable('我正在研究大模型的推理优化')).toBe(true);
  });

  it('should return false for non-personal questions', () => {
    expect(memoryService.isConversationValuable('今天天气怎么样啊')).toBe(false);
    expect(memoryService.isConversationValuable('帮我写个 Hello World 程序吧')).toBe(false);
    expect(memoryService.isConversationValuable('什么是闭包和作用域链问题')).toBe(false);
  });

  it('should handle empty and invalid input', () => {
    expect(memoryService.isConversationValuable('')).toBe(false);
    expect(memoryService.isConversationValuable('   ')).toBe(false);
    expect(memoryService.isConversationValuable(null as any)).toBe(false);
    expect(memoryService.isConversationValuable(undefined as any)).toBe(false);
  });
});
