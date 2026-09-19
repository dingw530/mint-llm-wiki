import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../adapters/apiAdapter.js', () => ({
  getAdapter: vi.fn(),
  AI_REQUEST_TIMEOUT_MS: 180_000,
}));

vi.mock('../../api/settingsService.js', () => ({
  getAiSettings: vi.fn(() => ({
    apiUrl: 'https://api.test',
    apiKey: 'test-key',
    modelId: 'test-model',
    apiType: 'openai-chat',
  })),
}));

import { getAdapter } from '../../adapters/apiAdapter.js';
import { GENERAL_AGENT_ID, createLegacyRoutingProvider } from '../legacyRoutingProvider.js';
import type { Agent } from '../../../types.js';
import { DISABLED_JEV_SETTINGS } from '../../jev/config.js';

const CONFIG = { jev: DISABLED_JEV_SETTINGS };

/** 构造候选 Agent。 */
function agent(id: string, triggerKeywords: string[], available = true): Agent {
  return {
    id,
    name: id,
    description: `${id} description`,
    type: 'custom',
    systemPrompt: null,
    mcpServerIds: [],
    available,
    errorMessage: null,
    triggerKeywords,
    createdAt: '',
    updatedAt: '',
  };
}

const AGENTS: Agent[] = [
  agent('general', []),
  agent('research', ['研究', '/^\\s*研究/']),
  agent('music', ['音乐']),
];

/** 用给定返回值配置 adapter mock。 */
function stubAdapter(returnValue: string | undefined): void {
  vi.mocked(getAdapter).mockReturnValue({
    call: vi.fn().mockResolvedValue(returnValue ?? ''),
  } as never);
}

const provider = createLegacyRoutingProvider();

describe('legacyRoutingProvider regression lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the exact keyword match with confidence 1.0', async () => {
    const outcome = await provider.route({ message: '研究', agents: AGENTS }, CONFIG);
    expect(outcome).toEqual({
      kind: 'decision',
      decision: { agentId: 'research', confidence: 1.0, method: 'keyword' },
    });
  });

  it('returns the regex keyword match with confidence 0.9', async () => {
    const outcome = await provider.route({ message: '   研究abc', agents: AGENTS }, CONFIG);
    expect(outcome).toEqual({
      kind: 'decision',
      decision: { agentId: 'research', confidence: 0.9, method: 'keyword' },
    });
  });

  it('escalates a substring match to the LLM classifier', async () => {
    stubAdapter('research');
    const outcome = await provider.route({ message: '今天研究如何', agents: AGENTS }, CONFIG);
    expect(outcome).toEqual({
      kind: 'decision',
      decision: { agentId: 'research', confidence: 0.85, method: 'llm' },
    });
  });

  it('falls back to the keyword result when the LLM answer is not a candidate', async () => {
    stubAdapter('nope');
    const outcome = await provider.route({ message: '今天研究如何', agents: AGENTS }, CONFIG);
    expect(outcome).toEqual({
      kind: 'decision',
      decision: { agentId: 'research', confidence: 0.6, method: 'keyword' },
    });
  });

  it('falls back to the keyword result when no adapter is registered', async () => {
    vi.mocked(getAdapter).mockReturnValue(undefined);
    const outcome = await provider.route({ message: '今天研究如何', agents: AGENTS }, CONFIG);
    expect(outcome).toEqual({
      kind: 'decision',
      decision: { agentId: 'research', confidence: 0.6, method: 'keyword' },
    });
  });

  it('falls back to the general agent with confidence 0 when nothing matches', async () => {
    const outcome = await provider.route(
      { message: '你好，今天有什么新闻', agents: AGENTS },
      CONFIG,
    );
    expect(outcome).toEqual({
      kind: 'decision',
      decision: { agentId: GENERAL_AGENT_ID, confidence: 0, method: 'fallback' },
    });
  });

  it('ignores unavailable agents', async () => {
    const unavailable = AGENTS.map((entry) => ({ ...entry, available: entry.id !== 'research' }));
    const outcome = await provider.route({ message: '研究', agents: unavailable }, CONFIG);
    expect(outcome).toEqual({
      kind: 'decision',
      decision: { agentId: GENERAL_AGENT_ID, confidence: 0, method: 'fallback' },
    });
  });
});
