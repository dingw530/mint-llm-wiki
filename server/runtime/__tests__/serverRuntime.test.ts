import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerRuntime } from '../serverRuntime.js';

const dependencies = vi.hoisted(() => ({
  cleanupArtifacts: vi.fn().mockResolvedValue(undefined),
  listSkills: vi.fn().mockResolvedValue([]),
  mcpInitialize: vi.fn().mockResolvedValue(undefined),
  mcpShutdown: vi.fn().mockResolvedValue(undefined),
  startMemory: vi.fn(),
  stopMemory: vi.fn().mockResolvedValue(undefined),
  wikiStart: vi.fn(),
  wikiShutdown: vi.fn(),
  startWikiLifecycle: vi.fn(() => ({ unref: vi.fn() })),
  flushLangfuse: vi.fn().mockResolvedValue(undefined),
  closeDb: vi.fn(),
  cancelAllRuns: vi.fn(),
}));

vi.mock('../../services/utils/toolResultArtifact.js', () => ({
  cleanupArtifacts: dependencies.cleanupArtifacts,
}));
vi.mock('../../services/api/skillService.js', () => ({ listSkills: dependencies.listSkills }));
vi.mock('../../services/api/mcpService.js', () => ({
  mcpService: { initialize: dependencies.mcpInitialize, shutdown: dependencies.mcpShutdown },
}));
vi.mock('../../services/api/memoryJobService.js', () => ({
  startMemoryProcessing: dependencies.startMemory,
  stopMemoryProcessing: dependencies.stopMemory,
}));
vi.mock('../../services/api/wikiIngestionJobService.js', () => ({
  wikiIngestionJobService: {
    startWorker: dependencies.wikiStart,
    shutdownWorker: dependencies.wikiShutdown,
  },
}));
vi.mock('../../services/api/wikiLifecycleService.js', () => ({
  startWikiLifecycleProcessing: dependencies.startWikiLifecycle,
}));
vi.mock('../../services/observability/langfuse.js', () => ({
  flushLangfuseTracing: dependencies.flushLangfuse,
}));
vi.mock('../../db.js', () => ({ closeDb: dependencies.closeDb }));
vi.mock('../../services/agentRun.js', () => ({
  agentRunRegistry: { cancelAll: dependencies.cancelAllRuns },
}));
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));
vi.mock('../../utils/typeGuards.js', () => ({
  getAddressPort: (address: { port?: number } | null) => address?.port ?? null,
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

function createAppMock() {
  let errorHandler: ((error: Error) => void) | undefined;
  const server = {
    address: vi.fn(() => ({ port: 3456 })),
    on: vi.fn((event: string, handler: (error: Error) => void) => {
      if (event === 'error') errorHandler = handler;
    }),
    close: vi.fn((callback: () => void) => callback()),
    closeAllConnections: vi.fn(),
  };
  const app = {
    listen: vi.fn((_port: number, _host: string, callback: () => void) => {
      setImmediate(callback);
      return server;
    }),
  };
  return { app, server, fail: () => errorHandler?.(new Error('listen failed')) };
}

describe('ServerRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts once and shuts down idempotently in resource order', async () => {
    const { app, server } = createAppMock();
    const runtime = new ServerRuntime({ app, preferredPort: 3456, host: '127.0.0.1' });

    await Promise.all([runtime.start(), runtime.start()]);
    expect(runtime.state).toBe('running');
    expect(runtime.port).toBe(3456);
    expect(app.listen).toHaveBeenCalledTimes(1);

    await Promise.all([runtime.shutdown('test'), runtime.shutdown('test-again')]);
    expect(runtime.state).toBe('stopped');
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(dependencies.stopMemory).toHaveBeenCalledTimes(1);
    expect(dependencies.cancelAllRuns).toHaveBeenCalledTimes(1);
    expect(dependencies.wikiShutdown).toHaveBeenCalledTimes(1);
    expect(dependencies.mcpShutdown).toHaveBeenCalledTimes(1);
    expect(dependencies.flushLangfuse).toHaveBeenCalledTimes(1);
    expect(dependencies.closeDb).toHaveBeenCalledTimes(1);
  });

  it('rolls back owned resources when listening fails', async () => {
    const { app, fail } = createAppMock();
    const runtime = new ServerRuntime({ app, preferredPort: 3456, host: '127.0.0.1' });
    const startPromise = runtime.start();
    await new Promise((resolve) => setImmediate(resolve));
    fail();

    await expect(startPromise).rejects.toThrow('listen failed');
    expect(runtime.state).toBe('stopped');
    expect(dependencies.stopMemory).toHaveBeenCalled();
    expect(dependencies.wikiShutdown).toHaveBeenCalled();
    expect(dependencies.closeDb).toHaveBeenCalled();
  });

  it('cancels active runs before closing the HTTP connections', async () => {
    const { app, server } = createAppMock();
    const runtime = new ServerRuntime({ app, preferredPort: 3456, host: '127.0.0.1' });

    await runtime.start();
    await runtime.shutdown('test');

    expect(dependencies.cancelAllRuns.mock.invocationCallOrder[0]).toBeLessThan(
      server.closeAllConnections.mock.invocationCallOrder[0],
    );
  });
});
