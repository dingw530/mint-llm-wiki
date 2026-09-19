import { describe, expect, it, vi } from 'vitest';
import { formatRoutingLogMethod, resolveRoute } from '../routingPolicy.js';
import { DISABLED_JEV_SETTINGS } from '../../jev/config.js';
import type { Agent } from '../../../types.js';
import type {
  AgentRoutingOutcome,
  AgentRoutingProvider,
  RoutingAttempt,
  RoutingStep,
} from '../types.js';

const CONFIG = { jev: DISABLED_JEV_SETTINGS };
const INPUT = { message: 'hi', agents: [] as readonly Agent[] };

/** 构造一个固定返回给定 outcome 的 provider。 */
function stubProvider(id: string, outcome: AgentRoutingOutcome): AgentRoutingProvider {
  return { id, route: vi.fn(async () => outcome) };
}

/** 构造一个总是抛异常的 provider。 */
function throwingProvider(id: string): AgentRoutingProvider {
  return {
    id,
    route: vi.fn(async () => {
      throw new Error('provider exploded');
    }),
  };
}

/** 构造带门槛的步。 */
function step(provider: AgentRoutingProvider, minConfidence = 0): RoutingStep {
  return { provider, minConfidence };
}

const decided = (agentId: string, confidence: number, method: 'jev' | 'keyword' = 'jev') => ({
  kind: 'decision' as const,
  decision: { agentId, confidence, method },
});

describe('resolveRoute', () => {
  it('accepts a decision that meets its step threshold', async () => {
    const resolution = await resolveRoute(
      INPUT,
      [step(stubProvider('jev', decided('research', 0.9)), 0.5)],
      CONFIG,
    );
    expect(resolution).toMatchObject({ agentId: 'research', confidence: 0.9, method: 'jev' });
    expect(resolution.attempts).toEqual([
      expect.objectContaining({ providerId: 'jev', outcome: 'decision', confidence: 0.9 }),
    ]);
  });

  it('records a below-threshold decision and continues to the next step', async () => {
    const resolution = await resolveRoute(
      INPUT,
      [
        step(stubProvider('jev', decided('research', 0.2)), 0.5),
        step(stubProvider('legacy', decided('general', 0, 'keyword'))),
      ],
      CONFIG,
    );
    expect(resolution).toMatchObject({ agentId: 'general', method: 'keyword' });
    expect(resolution.attempts.map((a) => a.outcome)).toEqual(['below-threshold', 'decision']);
  });

  it('treats an abstain as a normal hand-off to the next step', async () => {
    const resolution = await resolveRoute(
      INPUT,
      [
        step(stubProvider('keyword-exact', { kind: 'abstain', reason: 'no_match' })),
        step(stubProvider('legacy', decided('general', 0, 'keyword'))),
      ],
      CONFIG,
    );
    expect(resolution.attempts.map((a) => a.outcome)).toEqual(['abstain', 'decision']);
    expect(resolution.agentId).toBe('general');
  });

  it('falls through when Jev is unavailable', async () => {
    const resolution = await resolveRoute(
      INPUT,
      [
        step(
          stubProvider('jev', { kind: 'unavailable', reason: 'rate_limited', message: 'HTTP 429' }),
          0.5,
        ),
        step(stubProvider('legacy', decided('research', 0.9, 'keyword'))),
      ],
      CONFIG,
    );
    expect(resolution).toMatchObject({ agentId: 'research', method: 'keyword' });
    expect(resolution.attempts[0]).toMatchObject({
      providerId: 'jev',
      outcome: 'unavailable',
      reason: 'rate_limited',
    });
  });

  it('treats a thrown provider error as unavailable instead of failing the route', async () => {
    const resolution = await resolveRoute(
      INPUT,
      [
        step(throwingProvider('jev'), 0.5),
        step(stubProvider('legacy', decided('general', 0, 'keyword'))),
      ],
      CONFIG,
    );
    expect(resolution.agentId).toBe('general');
    expect(resolution.attempts[0]).toMatchObject({
      providerId: 'jev',
      outcome: 'unavailable',
      reason: 'unknown',
    });
  });

  it('returns the general fallback when every step is exhausted', async () => {
    const resolution = await resolveRoute(
      INPUT,
      [step(stubProvider('ajev', { kind: 'abstain', reason: 'no_candidates' }))],
      CONFIG,
    );
    expect(resolution).toMatchObject({ agentId: 'general', confidence: 0, method: 'fallback' });
  });
});

describe('formatRoutingLogMethod', () => {
  const decision: RoutingAttempt = {
    providerId: 'legacy',
    outcome: 'decision',
    method: 'keyword',
    latencyMs: 1,
  };

  it('returns the effective method when nothing degraded', () => {
    expect(formatRoutingLogMethod([decision], 'keyword')).toBe('keyword');
    expect(formatRoutingLogMethod([], 'fallback')).toBe('fallback');
  });

  it('ignores normal hand-offs so the Jev happy path stays readable', () => {
    const attempts: RoutingAttempt[] = [
      { providerId: 'keyword-exact', outcome: 'abstain', reason: 'no_match', latencyMs: 1 },
      { providerId: 'jev', outcome: 'decision', method: 'jev', confidence: 0.9, latencyMs: 40 },
    ];
    expect(formatRoutingLogMethod(attempts, 'jev')).toBe('jev');
  });

  it('records the degradation reason ahead of the effective method', () => {
    const attempts: RoutingAttempt[] = [
      { providerId: 'jev', outcome: 'unavailable', reason: 'rate_limited', latencyMs: 40 },
      decision,
    ];
    expect(formatRoutingLogMethod(attempts, 'keyword')).toBe(
      'jev_unavailable:rate_limited>keyword',
    );
  });

  it('uses a placeholder reason when the provider reported none', () => {
    const attempts: RoutingAttempt[] = [
      { providerId: 'jev', outcome: 'unavailable', latencyMs: 40 },
    ];
    expect(formatRoutingLogMethod(attempts, 'fallback')).toBe('jev_unavailable:unknown>fallback');
  });
});
