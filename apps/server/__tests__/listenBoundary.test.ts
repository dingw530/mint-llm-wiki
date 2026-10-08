import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const mockApp = vi.hoisted(() => ({ listen: vi.fn() }));
const mockCleanup = vi.hoisted(() => ({ cleanupArtifacts: vi.fn().mockResolvedValue(undefined) }));
const mockSkills = vi.hoisted(() => ({ listSkills: vi.fn().mockResolvedValue([]) }));

vi.mock('../app.js', () => ({ default: mockApp }));
vi.mock('../infrastructure/tools/tool-result-artifact.js', () => mockCleanup);
vi.mock('../domains/skills/index.js', () => mockSkills);

process.env.AI_CHAT_CLIENT_DIST = 'test-client-dist';

const { resolveListenHost } = await import('../index.js');

describe('HTTP listen boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unsupported listener modes instead of opening every network interface', () => {
    expect(resolveListenHost()).toBe('127.0.0.1');
    expect(resolveListenHost('loopback')).toBe('127.0.0.1');
    expect(resolveListenHost('container')).toBe('0.0.0.0');
    expect(() => resolveListenHost('0.0.0.0')).toThrow('Unsupported HTTP listen mode');
  });

  it('keeps the Docker-only listener and Compose publication explicit', async () => {
    const [entry, compose] = await Promise.all([
      readFile(resolve(process.cwd(), 'docker-entry.js'), 'utf8'),
      readFile(resolve(process.cwd(), '..', '..', 'docker-compose.yml'), 'utf8'),
    ]);

    expect(entry).toContain('startDockerServer(port)');
    expect(compose).toMatch(/- ['"]?127\.0\.0\.1:3001:3001['"]?/);
    expect(compose).not.toMatch(/^\s*- ['"]?3001:3001['"]?$/m);
  });
});
