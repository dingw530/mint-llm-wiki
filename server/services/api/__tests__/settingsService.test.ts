import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockSettings: Record<string, string> = {};

vi.mock('../../../repositories/settingsRepository.js', () => ({
  getAll: vi.fn(() => ({ ...mockSettings })),
  upsertAll: vi.fn((data: Record<string, string>) => {
    Object.assign(mockSettings, data);
  }),
}));

vi.mock('../../../repositories/endpointRepository.js', () => ({
  getActive: vi.fn(),
  update: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import * as settingsService from '../settingsService.js';
import * as settingsRepo from '../../../repositories/settingsRepository.js';
import * as endpointRepo from '../../../repositories/endpointRepository.js';

describe('settingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k]);
    vi.mocked(endpointRepo.getActive).mockReturnValue(null);
    vi.mocked(settingsRepo.getAll).mockReturnValue(mockSettings);
  });

  describe('get', () => {
    it('returns defaults when empty', () => {
      const s = settingsService.get();
      expect(s.apiUrl).toBe('');
      expect(s.thinkingMode).toBe(false);
      expect(s.memoryEnabled).toBe(false);
      expect(s.routingMode).toBe('auto');
      expect(s.reactMaxIterations).toBe(5);
      expect(s.toolMaxRetries).toBe(5);
      expect(s.showReactSteps).toBe(true);
      expect(s.maxContextRounds).toBe(10);
      expect(s.activeEndpointId).toBeNull();
    });

    it('parses stored values', () => {
      mockSettings.apiUrl = 'https://api.test.com';
      mockSettings.modelId = 'gpt-4';
      mockSettings.systemPrompt = 'You are helpful';
      mockSettings.thinkingMode = 'true';
      mockSettings.memoryEnabled = 'true';
      mockSettings.routingMode = 'manual';
      mockSettings.reactMaxIterations = '10';
      mockSettings.toolMaxRetries = '3';
      mockSettings.showReactSteps = 'false';
      mockSettings.maxContextRounds = '20';
      mockSettings.wikiPath = '/tmp/wiki';
      mockSettings.vectorStore = 'chroma';
      mockSettings.chromaUrl = 'http://chroma.test:8000';
      mockSettings.chromaApiKey = 'encrypted-key';

      const s = settingsService.get();
      expect(s.apiUrl).toBe('https://api.test.com');
      expect(s.modelId).toBe('gpt-4');
      expect(s.thinkingMode).toBe(true);
      expect(s.routingMode).toBe('manual');
      expect(s.reactMaxIterations).toBe(10);
      expect(s.wikiPath).toBe('/tmp/wiki');
      expect(s.vectorStore).toBe('chroma');
      expect(s.chromaUrl).toBe('http://chroma.test:8000');
    });

    it('reads active endpoint info', () => {
      vi.mocked(endpointRepo.getActive).mockReturnValue({
        id: 'ep-1',
        name: 'Active',
        apiUrl: '',
        apiKey: '',
        modelId: '',
        apiType: 'openai-chat',
        category: 'text',
        isActive: true,
        sortOrder: 0,
        createdAt: '',
        updatedAt: '',
      } as any);
      const s = settingsService.get();
      expect(s.activeEndpointId).toBe('ep-1');
      expect(s.activeEndpointName).toBe('Active');
    });
  });

  describe('getAiSettings', () => {
    it('uses active endpoint', () => {
      vi.mocked(endpointRepo.getActive).mockReturnValue({
        id: 'ep-2',
        name: 'Active',
        apiUrl: 'https://active.com',
        apiKey: 'sk-actual',
        modelId: 'gpt-4o',
        apiType: 'openai-chat',
        category: 'text',
        isActive: true,
        sortOrder: 0,
        createdAt: '',
        updatedAt: '',
      } as any);
      mockSettings.systemPrompt = 'custom';
      mockSettings.thinkingMode = 'true';

      const s = settingsService.getAiSettings();
      expect(s.apiUrl).toBe('https://active.com');
      expect(s.modelId).toBe('gpt-4o');
      expect(s.systemPrompt).toBe('custom');
    });

    it('falls back to legacy when no active endpoint', () => {
      mockSettings.apiUrl = 'https://legacy.com';
      mockSettings.modelId = 'gpt-3.5';
      mockSettings.systemPrompt = 'legacy';
      mockSettings.thinkingMode = 'false';
      mockSettings.memoryEnabled = 'true';
      mockSettings.showReactSteps = 'true';

      const s = settingsService.getAiSettings();
      expect(s.apiUrl).toBe('https://legacy.com');
      expect(s.modelId).toBe('gpt-3.5');
      expect(s.apiType).toBe('openai-chat');
    });
  });

  describe('save', () => {
    it('persists settings', () => {
      settingsService.save({
        apiUrl: 'https://new.com',
        modelId: 'gpt-4',
        apiKey: 'sk-new',
        vectorStore: 'chroma',
        chromaUrl: 'http://chroma.test:8000',
        chromaApiKey: 'chroma-key',
      });

      expect(mockSettings.apiUrl).toBe('https://new.com');
      expect(mockSettings.modelId).toBe('gpt-4');
      expect(mockSettings.vectorStore).toBe('chroma');
      expect(mockSettings.chromaUrl).toBe('http://chroma.test:8000');
      expect(mockSettings.chromaApiKey).not.toBe('chroma-key');
      // apiKey should be encrypted
      expect(mockSettings.apiKey).toBeTruthy();
      expect(mockSettings.apiKey).not.toContain('sk-new');
    });

    it('syncs to active endpoint when available', () => {
      vi.mocked(endpointRepo.getActive).mockReturnValue({
        id: 'ep-3',
        name: 'Active',
        apiUrl: 'https://old.com',
        apiKey: '',
        modelId: 'old',
        apiType: 'openai-chat',
        category: 'text',
        isActive: true,
        sortOrder: 0,
        createdAt: '',
        updatedAt: '',
      } as any);
      const updateMock = vi.mocked(endpointRepo.update);

      settingsService.save({
        apiUrl: 'https://new.com',
        modelId: 'gpt-4',
        apiKey: 'sk-key',
      });

      expect(updateMock).toHaveBeenCalledWith(
        'ep-3',
        expect.objectContaining({
          apiUrl: 'https://new.com',
          modelId: 'gpt-4',
        }),
      );
    });

    it('does not overwrite or sync model settings when they are omitted', () => {
      mockSettings.apiUrl = 'https://legacy.com';
      mockSettings.modelId = 'legacy-model';
      vi.mocked(endpointRepo.getActive).mockReturnValue({
        id: 'ep-4',
        name: 'Active',
        apiUrl: 'https://endpoint.com',
        apiKey: '',
        modelId: 'endpoint-model',
        apiType: 'openai-chat',
        category: 'text',
        isActive: true,
        sortOrder: 0,
        createdAt: '',
        updatedAt: '',
      } as any);

      settingsService.save({ systemPrompt: 'Be concise' });

      expect(mockSettings.apiUrl).toBe('https://legacy.com');
      expect(mockSettings.modelId).toBe('legacy-model');
      expect(endpointRepo.update).not.toHaveBeenCalled();
    });
  });
});

describe('settingsService Jev settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k]);
    vi.mocked(endpointRepo.getActive).mockReturnValue(null);
    vi.mocked(settingsRepo.getAll).mockReturnValue(mockSettings);
  });

  it('exposes the documented defaults with both switches off', () => {
    const jev = settingsService.getJevSettings();
    expect(jev).toEqual({
      apiUrl: 'https://api.typesafe.ai/v1/systemone',
      apiKey: '',
      model: 'jev-latest',
      timeoutMs: 3000,
      routingEnabled: false,
      routingMinConfidence: 0.5,
      routingBypassOnKeyword: true,
      memoryEnabled: false,
      memoryGateThreshold: 0.4,
      rerankEnabled: false,
    });
  });

  it('masks the API key in the visible settings', () => {
    settingsService.save({ jevApiKey: 'sk-secret-value' });

    const visible = settingsService.get();
    expect(visible.jevApiKeyMasked).toBe('sk-****e');
    expect(JSON.stringify(visible)).not.toContain('sk-secret-value');
  });

  it('keeps the stored key when a later save omits it', () => {
    settingsService.save({ jevApiKey: 'sk-secret-value' });
    const encryptedOnce = mockSettings.jevApiKey;

    settingsService.save({ jevRoutingEnabled: true });

    expect(mockSettings.jevApiKey).toBe(encryptedOnce);
    expect(settingsService.getJevSettings().apiKey).toBe('sk-secret-value');
    expect(settingsService.getJevSettings().routingEnabled).toBe(true);
  });

  it('resets the switches to off when a save omits them, matching the full-overwrite contract', () => {
    settingsService.save({ jevRoutingEnabled: true, jevMemoryEnabled: true });
    expect(settingsService.getJevSettings().routingEnabled).toBe(true);

    settingsService.save({ systemPrompt: 'next' });

    expect(settingsService.getJevSettings().routingEnabled).toBe(false);
    expect(settingsService.getJevSettings().memoryEnabled).toBe(false);
  });

  it('clamps out-of-range thresholds and timeouts instead of storing them', () => {
    settingsService.save({
      jevRoutingMinConfidence: 5,
      jevMemoryGateThreshold: -1,
      jevTimeoutMs: 999_999,
    });

    const jev = settingsService.getJevSettings();
    expect(jev.routingMinConfidence).toBe(1);
    expect(jev.memoryGateThreshold).toBe(0);
    expect(jev.timeoutMs).toBe(15_000);
  });

  it('returns an empty API key when the stored ciphertext cannot be decrypted', () => {
    mockSettings.jevApiKey = 'not-a-valid-ciphertext';
    expect(settingsService.getJevSettings().apiKey).toBe('');
    expect(settingsService.get().jevApiKeyMasked).toBe('****');
  });
});
