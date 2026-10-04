import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ──

vi.mock('../../../domains/agents/index.js', () => ({
  list: vi.fn(),
  findById: vi.fn(),
}));

vi.mock('../../../application/settings/settings-service.js', () => ({
  getAiSettings: vi.fn(),
}));

vi.mock('../../../bootstrap/agent-runtime.js', () => ({
  runAgentChat: vi.fn(),
}));

import * as agentService from '../../../domains/agents/index.js';
import * as settingsService from '../../../application/settings/settings-service.js';
import { runAgentChat as reactChat } from '../../../bootstrap/agent-runtime.js';
import { InvokeAgentTool } from '../InvokeAgentTool.js';

const ctx = { conversationId: 'test-conv' };

describe('InvokeAgentTool', () => {
  const tool = new InvokeAgentTool();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('invoke_agent');
    expect(tool.isReadOnly()).toBe(false);
    expect(tool.isConcurrencySafe()).toBe(true);
    expect(tool.isIdempotent()).toBe(false);
  });

  it('should include available agents in description', () => {
    vi.mocked(agentService.list).mockReturnValue([
      {
        id: 'code-reviewer',
        name: 'Code Reviewer',
        description: '审查代码质量',
        type: 'worker',
        systemPrompt: '',
        mcpServerIds: [],
        available: true,
        errorMessage: null,
        triggerKeywords: [],
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'debugger',
        name: 'Debugger',
        description: '调试分析',
        type: 'worker',
        systemPrompt: '',
        mcpServerIds: [],
        available: false,
        errorMessage: 'deprecated',
        triggerKeywords: [],
        createdAt: '',
        updatedAt: '',
      },
    ] as any);

    const desc = tool.description;
    expect(desc).toContain('code-reviewer');
    expect(desc).toContain('审查代码质量');
    expect(desc).not.toContain('debugger'); // available=false → not listed
  });

  it('should return error when agent not found', async () => {
    vi.mocked(agentService.findById).mockReturnValue(undefined);

    const result = await tool.execute({ agent_id: 'no-exist', task: 'do something' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should return error when agent is not available', async () => {
    vi.mocked(agentService.findById).mockReturnValue({
      id: 'debugger',
      available: false,
    } as any);

    const result = await tool.execute({ agent_id: 'debugger', task: 'do something' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });

  it('should return error when AI API not configured', async () => {
    vi.mocked(agentService.findById).mockReturnValue({
      id: 'worker',
      available: true,
    } as any);
    vi.mocked(settingsService.getAiSettings).mockReturnValue({
      apiUrl: '',
      apiKey: '',
      modelId: '',
      systemPrompt: '',
      thinkingMode: false,
      memoryEnabled: false,
      wikiPath: '',
      wikiMaxFileSize: 0,
    } as any);

    const result = await tool.execute({ agent_id: 'worker', task: 'do something' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured');
  });

  it('should execute agent successfully', async () => {
    vi.mocked(agentService.findById).mockReturnValue({
      id: 'worker',
      available: true,
      systemPrompt: 'You are a worker',
    } as any);
    vi.mocked(settingsService.getAiSettings).mockReturnValue({
      apiUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      modelId: 'claude-sonnet-4-6',
      systemPrompt: '',
      thinkingMode: false,
      memoryEnabled: false,
      wikiPath: '',
      wikiMaxFileSize: 0,
      reactMaxIterations: 5,
    } as any);
    vi.mocked(reactChat).mockResolvedValue({
      content: 'Task completed successfully',
      toolCalls: [{ name: 'read_file', result: 'ok' }],
    } as any);

    const result = await tool.execute({ agent_id: 'worker', task: 'do something' }, ctx);
    expect(result.success).toBe(true);
    expect(result.content).toBe('Task completed successfully');
    expect(result.agentId).toBe('worker');
    expect(result.toolCalls).toBe(1);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('should handle agent execution failure', async () => {
    vi.mocked(agentService.findById).mockReturnValue({
      id: 'worker',
      available: true,
    } as any);
    vi.mocked(settingsService.getAiSettings).mockReturnValue({
      apiUrl: 'https://api.example.com',
      apiKey: 'sk-test',
    } as any);
    vi.mocked(reactChat).mockRejectedValue(new Error('API rate limit exceeded'));

    const result = await tool.execute({ agent_id: 'worker', task: 'do something' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('rate limit');
  });
});
