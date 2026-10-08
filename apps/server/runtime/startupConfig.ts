import { resolve } from 'node:path';

export type RuntimeMode = 'node' | 'cli' | 'docker' | 'electron';
export type ListenMode = 'loopback' | 'container';

export interface StartupConfig {
  mode: RuntimeMode;
  listenMode: ListenMode;
  host: string;
  preferredPort: number;
  clientDist?: string;
}

interface StartupConfigOverrides {
  mode?: RuntimeMode;
  listenMode?: ListenMode;
  preferredPort?: number;
  clientDist?: string;
}

/** Load and validate the explicit process/runtime startup contract. */
export function loadStartupConfig(
  overrides: StartupConfigOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): StartupConfig {
  const mode = overrides.mode ?? 'node';
  const listenMode = overrides.listenMode ?? (mode === 'docker' ? 'container' : 'loopback');
  const preferredPort = overrides.preferredPort ?? parsePort(env.PORT || '3001');
  if (!Number.isInteger(preferredPort) || preferredPort < 0 || preferredPort > 65535) {
    throw new Error(`Invalid PORT: ${preferredPort}`);
  }
  return {
    mode,
    listenMode,
    host: listenMode === 'container' ? '0.0.0.0' : '127.0.0.1',
    preferredPort,
    ...(overrides.clientDist || env.AI_CHAT_CLIENT_DIST
      ? { clientDist: resolve(overrides.clientDist || env.AI_CHAT_CLIENT_DIST || '') }
      : {}),
  };
}

function parsePort(value: string): number {
  const port = Number(value);
  return Number.isInteger(port) ? port : -1;
}
