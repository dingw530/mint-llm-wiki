import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JEV_API_URL,
  createEmptyJevFormState,
  createJevFormState,
  toJevSettingsInput,
} from '../jevForm';

describe('createJevFormState', () => {
  it('defaults both sub-switches to off', () => {
    const form = createJevFormState({});
    expect(form.routingEnabled).toBe(false);
    expect(form.memoryEnabled).toBe(false);
    expect(form.apiUrl).toBe(DEFAULT_JEV_API_URL);
    expect(form.apiKey).toBe('');
  });

  it('never carries a plaintext key, only the mask', () => {
    const form = createJevFormState({ jevApiKeyMasked: 'sk-****y' });
    expect(form.apiKey).toBe('');
    expect(form.apiKeyMasked).toBe('sk-****y');
  });

  it('round-trips the stored switches and thresholds', () => {
    const form = createJevFormState({
      jevApiUrl: 'https://proxy.internal/v1/systemone',
      jevModel: 'jev-1.13',
      jevRoutingEnabled: true,
      jevRoutingMinConfidence: 0.6,
      jevMemoryEnabled: true,
      jevMemoryGateThreshold: 0.35,
    });

    expect(form).toMatchObject({
      apiUrl: 'https://proxy.internal/v1/systemone',
      model: 'jev-1.13',
      routingEnabled: true,
      routingMinConfidence: 0.6,
      memoryEnabled: true,
      memoryGateThreshold: 0.35,
    });
  });
});

describe('toJevSettingsInput', () => {
  it('omits the key when the field is left empty so the stored key survives', () => {
    const input = toJevSettingsInput({ ...createEmptyJevFormState(), apiKeyMasked: 'sk-****y' });
    expect('jevApiKey' in input).toBe(false);
  });

  it('sends the key when the user typed a new one', () => {
    const input = toJevSettingsInput({ ...createEmptyJevFormState(), apiKey: 'sk-new' });
    expect(input.jevApiKey).toBe('sk-new');
  });

  it('trims the endpoint and model', () => {
    const input = toJevSettingsInput({
      ...createEmptyJevFormState(),
      apiUrl: '  https://api.typesafe.ai/v1/systemone  ',
      model: '  jev-latest  ',
    });
    expect(input.jevApiUrl).toBe('https://api.typesafe.ai/v1/systemone');
    expect(input.jevModel).toBe('jev-latest');
  });

  it('carries both sub-switches independently', () => {
    const input = toJevSettingsInput({
      ...createEmptyJevFormState(),
      routingEnabled: true,
      memoryEnabled: false,
    });
    expect(input.jevRoutingEnabled).toBe(true);
    expect(input.jevMemoryEnabled).toBe(false);
  });
});
