import 'dotenv/config';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { ServerRuntime } from './runtime/serverRuntime.js';
import { loadStartupConfig, type ListenMode, type RuntimeMode } from './runtime/startupConfig.js';

/** Resolve the listener host while retaining the legacy boundary-test API. */
export function resolveListenHost(mode: string | undefined): string {
  if (mode === undefined || mode === 'loopback' || mode === 'container') {
    return loadStartupConfig({ listenMode: mode || 'loopback' }).host;
  }
  throw new Error(`Unsupported HTTP listen mode: ${mode}`);
}

let activeRuntime: ServerRuntime | undefined;
let activeRuntimeMode: 'loopback' | 'container' | undefined;

function requireEncryptionKey(): void {
  if (!process.env.AI_CHAT_ENCRYPTION_KEY) {
    throw new Error('AI_CHAT_ENCRYPTION_KEY environment variable is not set');
  }
}

function createRuntime(
  preferredPort: number | undefined,
  mode: RuntimeMode,
  listenMode: ListenMode,
): ServerRuntime {
  requireEncryptionKey();
  const config = loadStartupConfig({ mode, listenMode, preferredPort });
  return new ServerRuntime({
    app: createApp(),
    preferredPort: config.preferredPort,
    host: config.host,
  });
}

/** Start the local HTTP runtime and return its actual listening port. */
export function startServer(preferredPort?: number): Promise<number> {
  return startServerRuntime(preferredPort, 'node', 'loopback');
}

/** Start the Docker HTTP runtime and return its actual listening port. */
export function startDockerServer(preferredPort?: number): Promise<number> {
  return startServerRuntime(preferredPort, 'docker', 'container');
}

/** Start or reuse the process-owned runtime for an explicit listener mode. */
export async function startServerRuntime(
  preferredPort: number | undefined,
  mode: RuntimeMode,
  listenMode: ListenMode = mode === 'docker' ? 'container' : 'loopback',
): Promise<number> {
  if (activeRuntime && activeRuntimeMode !== listenMode) {
    throw new Error(`HTTP runtime already started in ${activeRuntimeMode} mode`);
  }
  if (!activeRuntime) {
    activeRuntime = createRuntime(preferredPort, mode, listenMode);
    activeRuntimeMode = listenMode;
  }
  await activeRuntime.start();
  return activeRuntime.port ?? preferredPort ?? 3001;
}

/** Shut down the process-owned runtime, if one was started. */
export async function shutdownServer(reason = 'shutdown'): Promise<void> {
  const runtime = activeRuntime;
  if (!runtime) return;
  await runtime.shutdown(reason);
  activeRuntime = undefined;
  activeRuntimeMode = undefined;
}

function isDirectEntryPoint(): boolean {
  return Boolean(
    process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url,
  );
}

if (isDirectEntryPoint()) {
  startServer().catch((error: unknown) => {
    console.error('Failed to start server:', error);
    process.exitCode = 1;
  });
  const shutdown = (): void => {
    void shutdownServer('signal').finally(() => process.exit());
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
