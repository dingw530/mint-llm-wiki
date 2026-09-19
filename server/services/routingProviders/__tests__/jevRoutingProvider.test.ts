import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJevRoutingProvider } from '../jevRoutingProvider.js';
import type { Agent, JevSettings } from '../../../types.js';

const JEV: JevSettings = {
  apiUrl: 'https://api.typesafe.ai/v1/systemone',
  apiKey: 'test-key',
  model: 'jev-latest',
  timeoutMs: 3_000,
  routingEnabled: true,
  routingMinConfidence: 0.5,
  routingBypassOnKeyword: true,
  memoryEnabled: false,
  memoryGateThreshold: 0.4,
};

const CONFIG = { jev: JEV };

/** 构造候选 Agent。 */
function agent(id: string, available = true): Agent {
  return {
    id,
    name: id,
    description: `${id} description`,
    type: 'custom',
    systemPrompt: null,
    mcpServerIds: [],
    available,
    errorMessage: null,
    triggerKeywords: [],
    createdAt: '',
    updatedAt: '',
  };
}

const AGENTS: Agent[] = [agent('general'), agent('research'), agent('music')];

/** 让 fetch 返回一个带 `answers` 的 Jev 响应。 */
function stubAnswers(answers: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(JSON.stringify({ model: 'jev-latest', answers }), { status: 200 }),
    ),
  );
}

const provider = createJevRoutingProvider();

describe('jevRoutingProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // fetch 是进程级全局：必须在每个用例后恢复，否则 stub 会泄漏到同线程的后续测试文件。
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('maps an ASCII option id back to the agent id', async () => {
    stubAnswers({ agent: { type: 'choice', choice: 'a1', confidence: 0.91 } });
    const outcome = await provider.route({ message: '帮我查资料', agents: AGENTS }, CONFIG);
    expect(outcome).toEqual({
      kind: 'decision',
      decision: { agentId: 'research', confidence: 0.91, method: 'jev' },
    });
  });

  it('can select the general option', async () => {
    stubAnswers({ agent: { type: 'choice', choice: 'general', confidence: 0.7 } });
    const outcome = await provider.route({ message: '随便聊聊', agents: AGENTS }, CONFIG);
    expect(outcome).toMatchObject({ kind: 'decision', decision: { agentId: 'general' } });
  });

  it('abstains when the answer is not one of the offered options', async () => {
    stubAnswers({ agent: { type: 'choice', choice: '音乐助手', confidence: 0.9 } });
    await expect(provider.route({ message: 'x', agents: AGENTS }, CONFIG)).resolves.toEqual({
      kind: 'abstain',
      reason: 'answer_not_a_candidate',
    });
  });

  it('abstains when the answer is missing or has the wrong type', async () => {
    stubAnswers({ agent: { type: 'noul', noul: 0.9 } });
    await expect(provider.route({ message: 'x', agents: AGENTS }, CONFIG)).resolves.toEqual({
      kind: 'abstain',
      reason: 'answer_not_a_candidate',
    });
  });

  it('abstains without calling Jev when only the general agent exists', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      provider.route({ message: 'x', agents: [agent('general')] }, CONFIG),
    ).resolves.toEqual({ kind: 'abstain', reason: 'no_candidates' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports unavailable when the API key is not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await provider.route(
      { message: 'x', agents: AGENTS },
      {
        jev: { ...JEV, apiKey: '' },
      },
    );

    expect(outcome).toEqual({
      kind: 'unavailable',
      reason: 'not_configured',
      message: expect.any(String),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports unavailable on a rate limited response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 429 })),
    );

    const outcome = await provider.route({ message: 'x', agents: AGENTS }, CONFIG);

    expect(outcome).toMatchObject({ kind: 'unavailable', reason: 'rate_limited' });
  });
});
