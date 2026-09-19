import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ARTIFACT_HARD_TTL_MS } from '../services/utils/toolResultArtifact.js';

const mockApp = vi.hoisted(() => ({ listen: vi.fn() }));
const mockSkills = vi.hoisted(() => ({ listSkills: vi.fn().mockResolvedValue([]) }));

vi.mock('../app.js', () => ({ default: mockApp, createApp: vi.fn(() => mockApp) }));
vi.mock('../services/api/skillService.js', () => mockSkills);

process.env.AI_CHAT_CLIENT_DIST = 'test-client-dist';

const { startServer } = await import('../index.js');

describe('server startup', () => {
  let artifactRoot: string;

  beforeEach(async () => {
    mockApp.listen.mockClear();
    artifactRoot = join(tmpdir(), `mint-startup-artifact-${Date.now()}`);
    process.env.AI_CHAT_CONTEXT_ARTIFACT_DIR = artifactRoot;
    mockApp.listen.mockImplementation((_port: number, _host: string, callback: () => void) => {
      const server = {
        address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 3456 }),
        on: vi.fn(),
      };
      setImmediate(callback);
      return server;
    });
  });

  afterAll(async () => {
    delete process.env.AI_CHAT_CLIENT_DIST;
    delete process.env.AI_CHAT_CONTEXT_ARTIFACT_DIR;
    await rm(artifactRoot, { recursive: true, force: true });
  });

  it('cleans expired artifacts before listening', async () => {
    const directory = join(artifactRoot, 'conversation-1');
    const expiredPath = join(directory, `${Date.now() - ARTIFACT_HARD_TTL_MS - 1}-expired.json`);
    await mkdir(directory, { recursive: true });
    await writeFile(expiredPath, 'expired');

    const port = await startServer(3456);

    expect(port).toBe(3456);
    expect(mockApp.listen).toHaveBeenCalledWith(3456, '127.0.0.1', expect.any(Function));
    await expect(readFile(expiredPath)).rejects.toThrow();
  });
});
