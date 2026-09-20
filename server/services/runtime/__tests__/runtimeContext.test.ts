import { describe, expect, it } from 'vitest';
import { DISABLED_JEV_SETTINGS } from '../../jev/config.js';
import { createRuntimeContext } from '../runtimeContext.js';

describe('RuntimeContext', () => {
  const fallbackJev = {
    ...DISABLED_JEV_SETTINGS,
    apiUrl: 'https://jev.example.test',
    apiKey: 'fallback-key',
    model: 'fallback-model',
    timeoutMs: 10_000,
    routingEnabled: true,
    routingMinConfidence: 0.8,
    routingBypassOnKeyword: true,
    memoryEnabled: true,
    memoryGateThreshold: 0.7,
    rerankEnabled: true,
  };

  it('falls back to persisted Jev settings when no feature is provided', () => {
    const context = createRuntimeContext({ fallbackJev });

    expect(context.getJevSettings()).toEqual(fallbackJev);
  });

  it('turns off all Jev capabilities when the feature is disabled', () => {
    const context = createRuntimeContext({
      fallbackJev,
      features: { jev: { enabled: false } },
    });

    expect(context.getJevSettings()).toEqual(DISABLED_JEV_SETTINGS);
  });

  it('overrides Jev capability options without changing the fallback object', () => {
    const context = createRuntimeContext({
      fallbackJev,
      features: {
        jev: {
          options: {
            routingEnabled: false,
            memoryEnabled: false,
            rerankEnabled: false,
            model: 'eval-model',
          },
        },
      },
    });

    expect(context.getJevSettings()).toMatchObject({
      model: 'eval-model',
      routingEnabled: false,
      memoryEnabled: false,
      rerankEnabled: false,
      timeoutMs: fallbackJev.timeoutMs,
    });
    expect(fallbackJev.model).toBe('fallback-model');
  });

  it('preserves unknown features for future runtime capabilities', () => {
    const context = createRuntimeContext({
      features: { futureFeature: { enabled: true, options: { mode: 'strict' } } },
    });

    expect(context.getFeature('futureFeature')).toEqual({
      enabled: true,
      options: { mode: 'strict' },
    });
  });
});
