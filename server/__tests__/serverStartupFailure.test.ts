import { describe, expect, it, vi } from 'vitest';

const mockApp = vi.hoisted(() => ({ listen: vi.fn() }));
const mockCleanup = vi.hoisted(() => ({
  cleanupArtifacts: vi.fn().mockRejectedValue(new Error('permission denied')),
}));
const mockSkills = vi.hoisted(() => ({ listSkills: vi.fn().mockResolvedValue([]) }));

vi.mock('../app.js', () => ({ default: mockApp, createApp: vi.fn(() => mockApp) }));
vi.mock('../services/utils/toolResultArtifact.js', () => mockCleanup);
vi.mock('../services/api/skillService.js', () => mockSkills);

process.env.AI_CHAT_CLIENT_DIST = 'test-client-dist';

const { startServer } = await import('../index.js');

describe('server startup cleanup failure', () => {
  it('continues listening when startup cleanup fails', async () => {
    mockApp.listen.mockImplementation((_port: number, _host: string, callback: () => void) => {
      const server = {
        address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 3457 }),
        on: vi.fn(),
      };
      setImmediate(callback);
      return server;
    });

    await expect(startServer(3457)).resolves.toBe(3457);
    expect(mockCleanup.cleanupArtifacts).toHaveBeenCalledWith({ mode: 'startup' });
    expect(mockApp.listen).toHaveBeenCalledWith(3457, '127.0.0.1', expect.any(Function));
  });
});
