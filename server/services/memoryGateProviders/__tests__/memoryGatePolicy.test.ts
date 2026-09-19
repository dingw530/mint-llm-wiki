import { describe, expect, it, vi } from 'vitest';
import { evaluateMemoryGate } from '../memoryGatePolicy.js';
import type { MemoryGateProvider } from '../types.js';
import type { JevSettings } from '../../../types.js';

/** 构造 Jev 设置；默认开启记忆门控。 */
function jevSettings(overrides: Partial<JevSettings> = {}): JevSettings {
  return {
    apiUrl: 'https://api.typesafe.ai/v1/systemone',
    apiKey: 'test-key',
    model: 'jev-latest',
    timeoutMs: 3_000,
    routingEnabled: false,
    routingMinConfidence: 0.5,
    routingBypassOnKeyword: true,
    memoryEnabled: true,
    memoryGateThreshold: 0.4,
    ...overrides,
  };
}

/** 构造一个固定返回给定结论的 provider。 */
function stubProvider(id: string, outcome: Awaited<ReturnType<MemoryGateProvider['evaluate']>>) {
  return { id, evaluate: vi.fn(async () => outcome) } satisfies MemoryGateProvider;
}

/** 一条有自指信息、legacy 启发式会判定值得记忆的消息。 */
const VALUABLE = '我叫王丁，住在杭州，喜欢用 TypeScript 做后端开发。';

describe('evaluateMemoryGate', () => {
  it('is terminal on a Jev skip and never consults the legacy heuristic', async () => {
    const jev = stubProvider('jev', { kind: 'skip', reason: 'not_worth_remembering' });

    const resolution = await evaluateMemoryGate({ userContent: VALUABLE }, { jev: jevSettings() }, [
      jev,
    ]);

    expect(resolution.memorize).toBe(false);
    expect(jev.evaluate).toHaveBeenCalled();
    // 关键：没有 legacy 尝试记录，说明 Jev 的"跳过"没有被正则推翻。
    expect(resolution.attempts.map((attempt) => attempt.providerId)).toEqual(['jev']);
  });

  it('is terminal on a Jev memorize', async () => {
    const jev = stubProvider('jev', { kind: 'memorize', hint: undefined });

    const resolution = await evaluateMemoryGate({ userContent: VALUABLE }, { jev: jevSettings() }, [
      jev,
    ]);

    expect(resolution).toMatchObject({ memorize: true, providerId: 'jev' });
    expect(resolution.attempts.map((attempt) => attempt.providerId)).toEqual(['jev']);
  });

  it('falls back to the legacy heuristic only when Jev is unavailable', async () => {
    const jev = stubProvider('jev', {
      kind: 'unavailable',
      reason: 'rate_limited',
      message: 'HTTP 429',
    });

    const resolution = await evaluateMemoryGate({ userContent: VALUABLE }, { jev: jevSettings() }, [
      jev,
    ]);

    expect(resolution).toMatchObject({ memorize: true, providerId: 'legacy' });
    expect(resolution.attempts.map((attempt) => attempt.providerId)).toEqual(['jev', 'legacy']);
    expect(resolution.attempts[0]).toMatchObject({
      outcome: 'unavailable',
      reason: 'rate_limited',
    });
  });

  it('uses the legacy heuristic directly when the Jev memory switch is off', async () => {
    const jev = stubProvider('jev', { kind: 'memorize' });

    const resolution = await evaluateMemoryGate(
      { userContent: VALUABLE },
      {
        jev: jevSettings({ memoryEnabled: false }),
      },
      [jev],
    );

    expect(jev.evaluate).not.toHaveBeenCalled();
    expect(resolution).toMatchObject({ memorize: true, providerId: 'legacy' });
  });

  it('declines a greeting through the legacy heuristic', async () => {
    const resolution = await evaluateMemoryGate(
      { userContent: '谢谢你' },
      { jev: jevSettings({ memoryEnabled: false }) },
    );
    expect(resolution.memorize).toBe(false);
  });

  it('treats a thrown provider as unavailable and still falls back', async () => {
    const exploding: MemoryGateProvider = {
      id: 'jev',
      evaluate: vi.fn(async () => {
        throw new Error('provider exploded');
      }),
    };

    const resolution = await evaluateMemoryGate({ userContent: VALUABLE }, { jev: jevSettings() }, [
      exploding,
    ]);

    expect(resolution.attempts[0]).toMatchObject({ providerId: 'jev', outcome: 'unavailable' });
    expect(resolution.providerId).toBe('legacy');
  });
});
