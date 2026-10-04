import { describe, expect, it, vi } from 'vitest';
import { RoutingService } from '../routing-service.js';
import { createLegacyRoutingProvider } from '../legacy-routing-provider.js';
import type { RoutingDependencies } from '../ports.js';
import { DISABLED_JEV_SETTINGS } from '../../../infrastructure/ai/jev/config.js';
import type { Agent } from '../../../types.js';

const agents: Agent[] = [
  {
    id: 'research',
    name: 'research',
    type: 'custom',
    description: '',
    systemPrompt: null,
    mcpServerIds: [],
    available: true,
    errorMessage: null,
    triggerKeywords: ['研究'],
    createdAt: '',
    updatedAt: '',
  },
];

/** Construct isolated domain ports; no database or model adapter is loaded. */
function dependencies(): RoutingDependencies {
  const classify = vi.fn(async () => null);
  const legacySteps = [{ provider: createLegacyRoutingProvider(classify), minConfidence: 0 }];
  return {
    classify,
    getJevSettings: vi.fn(() => DISABLED_JEV_SETTINGS),
    createDefaultSteps: vi.fn(() => legacySteps),
    legacySteps,
    disabledJevSettings: DISABLED_JEV_SETTINGS,
    recordRoute: vi.fn(),
  };
}

describe('Routing runtime ports', () => {
  it('uses per-run settings without reading global settings', async () => {
    const ports = dependencies();
    const jev = { ...DISABLED_JEV_SETTINGS, routingEnabled: true };
    const result = await new RoutingService(ports).route('研究', {
      agents,
      runtimeContext: { getJevSettings: () => jev },
    });
    expect(result).toMatchObject({ agentId: 'research', method: 'keyword', confidence: 1 });
    expect(ports.getJevSettings).not.toHaveBeenCalled();
    expect(ports.createDefaultSteps).toHaveBeenCalledWith(jev, '研究', expect.any(Object));
  });

  it('falls back to legacy routing when provider setup fails', async () => {
    const ports = dependencies();
    vi.mocked(ports.getJevSettings).mockImplementation(() => {
      throw new Error('configuration unavailable');
    });
    const result = await new RoutingService(ports).route('研究', { agents });
    expect(result).toMatchObject({ agentId: 'research', method: 'keyword' });
    expect(result.attempts).toMatchObject([{ providerId: 'legacy', outcome: 'decision' }]);
  });

  it('records hook-adjusted results and keeps the provider audit trail', async () => {
    const ports = dependencies();
    const service = new RoutingService(ports, {
      onRoutingComplete: async (result) => ({ ...result, agentId: 'general', attempts: [] }),
    });
    const context = { agents, conversationId: 'conversation', messageId: 'message' };
    const result = await service.route('研究', context);
    expect(result.agentId).toBe('general');
    expect(result.attempts).toHaveLength(1);
    expect(ports.recordRoute).toHaveBeenCalledWith(result, context);
  });

  it('returns locked decisions even when audit persistence fails', async () => {
    const ports = dependencies();
    vi.mocked(ports.recordRoute).mockImplementation(() => {
      throw new Error('database unavailable');
    });
    const result = await new RoutingService(ports).route('x', {
      agents,
      lockedAgent: 'research',
      conversationId: 'conversation',
    });
    expect(result).toMatchObject({ agentId: 'research', confidence: 1, attempts: [] });
    expect(ports.createDefaultSteps).not.toHaveBeenCalled();
  });
});
