import { spawn } from 'node:child_process';
import { SandboxManager, type SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';

interface RunRequest {
  type: 'run';
  command: string;
  cwd: string;
  timeoutMs: number;
  invocationId: string;
}

const MAX_OUTPUT_BYTES = 1024 * 1024;

/** Executes one command under the macOS Seatbelt-backed sandbox runtime. */
async function run(request: RunRequest): Promise<void> {
  const config: SandboxRuntimeConfig = {
    network: {
      allowedDomains: ['*'],
      deniedDomains: [],
      allowUnixSockets: [],
      allowLocalBinding: false,
    },
    filesystem: {
      denyRead: [process.env.HOME || '/Users'],
      allowRead: [request.cwd],
      allowWrite: [request.cwd, '/tmp'],
      denyWrite: ['**/.env', '**/.git/config', '**/.git/hooks/**', '**/.zshrc', '**/.bashrc'],
    },
  };
  await SandboxManager.initialize(config);
  const wrapped = await SandboxManager.wrapWithSandboxArgv(
    withResourceLimits(request.command, request.timeoutMs),
    '/bin/bash',
    undefined,
    undefined,
    request.cwd,
    { commandId: request.invocationId, commandText: request.command },
  );
  const child = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
    cwd: request.cwd,
    env: scrubEnvironment(wrapped.env),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let outputBytes = 0;
  const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
    outputBytes += chunk.byteLength;
    if (outputBytes <= MAX_OUTPUT_BYTES) {
      if (target === 'stdout') stdout += chunk.toString();
      else stderr += chunk.toString();
    }
    if (outputBytes > MAX_OUTPUT_BYTES) killProcessGroup(child.pid);
  };
  child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
  child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));
  const timer = setTimeout(() => killProcessGroup(child.pid), request.timeoutMs);
  const exitCode = await new Promise<number | null>((resolve) =>
    child.once('close', (code) => resolve(code)),
  );
  clearTimeout(timer);
  await SandboxManager.reset();
  sendResult({ type: 'result', stdout, stderr, exitCode, duration: 0, cleanupFailed: false });
}

function scrubEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(environment)) {
    if (
      /^(PATH|HOME|TMPDIR|LANG|LC_|TERM|SHELL|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|SSL_CERT_FILE|GIT_SSL_CAINFO|JAVA_TOOL_OPTIONS|SRT_)/.test(
        key,
      )
    ) {
      result[key] = value;
    }
  }
  delete result.NO_PROXY;
  return result;
}

function withResourceLimits(command: string, timeoutMs: number): string {
  const quoted = `'${command.replace(/'/g, `'\\''`)}'`;
  return (
    `ulimit -t ${Math.ceil(timeoutMs / 1000)} 2>/dev/null || true; ` +
    'ulimit -v 524288 2>/dev/null || true; ' +
    `exec /bin/bash -c ${quoted}`
  );
}

function killProcessGroup(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    /* process already exited */
  }
}

process.on('message', (message: RunRequest) => {
  if (message?.type !== 'run') return;
  run(message).catch((error) => {
    sendResult({
      type: 'result',
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: null,
      duration: 0,
      cleanupFailed: false,
    });
  });
});

function sendResult(result: object): void {
  if (!process.send) process.exit(1);
  process.send(result, () => process.exit(0));
}
