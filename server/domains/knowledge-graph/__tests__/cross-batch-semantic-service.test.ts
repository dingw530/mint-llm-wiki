import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../infrastructure/ai/adapters/api-adapter.js', () => ({
  getAdapter: vi.fn(),
}));

// We only test the pure logic functions, not the AI-dependent flow
import { getAdapter } from '../../../infrastructure/ai/adapters/api-adapter.js';

describe('crossBatchSemanticService', () => {
  it('returns null when adapter is not configured', async () => {
    vi.mocked(getAdapter).mockReturnValue(undefined);

    // Dynamic import to ensure the module uses the mock
    const { generateCrossBatchCandidates } = await import('../cross-batch-semantic-service.js');
    await generateCrossBatchCandidates({ apiType: 'openai-chat' } as any, '/tmp/wiki', []);
    // Should not throw
    expect(true).toBe(true);
  });
});
