import { fork, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ToolContext } from '../../../agent-runtime/tooling/tool-contracts.js';

export type SandboxExecutionState = 'sandboxed' | 'host_fallback' | 'denied' | 'cleanup_failed';

export interface SandboxMetadata {
  state: SandboxExecutionState;
  sandboxed: boolean;
  backend: 'anthropic-sandbox-runtime' | 'host' | 'none';
  reason?: string;
}

export interface SandboxRunInput {
  command: string;
  cwd: string;
  timeoutMs: number;
  invocationId: string;
  allowHostFallback: boolean;
}

export interface SandboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
  metadata: SandboxMetadata;
}

interface WorkerResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
  cleanupFailed?: boolean;
}

interface SandboxWorker extends ChildProcess {
  send(message: object): boolean;
}

const MAX_OUTPUT_BYTES = 1024 * 1024;

/** Returns the first available POSIX shell for host fallback execution. */
function getShellPath(): string {
  return existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
}

/** Runs one Bash invocation in a disposable sandbox Worker. */
export class SandboxRunner {
  private readonly workerPath: string;

  constructor(workerPath = fileURLToPath(new URL('./sandbox-worker.js', import.meta.url))) {
    this.workerPath = workerPath;
  }

  /** Returns whether this host can use the macOS sandbox backend. */
  isAvailable(): boolean {
    return (
      process.platform === 'darwin' &&
      Number(process.versions.node.split('.')[0]) >= 20 &&
      existsSync(this.workerPath)
    );
  }

  /** Executes one command and destroys all Worker state afterwards. */
  async run(input: SandboxRunInput, context: ToolContext): Promise<SandboxRunResult> {
    if (!this.isAvailable()) {
      return input.allowHostFallback
        ? this.hostFallback(input, 'macOS sandbox backend unavailable', context)
        : this.deniedResult('macOS sandbox backend unavailable');
    }
    const startedAt = Date.now();
    let worker: SandboxWorker | undefined;
    try {
      worker = fork(this.workerPath, [], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      }) as SandboxWorker;
      const result = await this.waitForWorker(worker, input, context);
      const metadata: SandboxMetadata = result.cleanupFailed
        ? {
            state: 'cleanup_failed',
            sandboxed: true,
            backend: 'anthropic-sandbox-runtime',
            reason: 'worker cleanup failed',
          }
        : { state: 'sandboxed', sandboxed: true, backend: 'anthropic-sandbox-runtime' };
      return { ...result, duration: Date.now() - startedAt, metadata };
    } catch (error) {
      this.killWorker(worker);
      const reason = `sandbox worker failed: ${error instanceof Error ? error.message : String(error)}`;
      return this.deniedResult(reason);
    } finally {
      this.killWorker(worker);
    }
  }

  private deniedResult(reason: string): SandboxRunResult {
    return {
      stdout: '',
      stderr: `Sandbox execution denied: ${reason}`,
      exitCode: null,
      duration: 0,
      metadata: { state: 'denied', sandboxed: false, backend: 'none', reason },
    };
  }

  private waitForWorker(
    worker: SandboxWorker,
    input: SandboxRunInput,
    context: ToolContext,
  ): Promise<WorkerResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('sandbox worker timed out')),
        input.timeoutMs + 1000,
      );
      let workerStderr = '';
      const finish = (callback: () => void): void => {
        clearTimeout(timer);
        callback();
      };
      worker.once('error', (error) => finish(() => reject(error)));
      worker.once('exit', (code, signal) => {
        if (code !== 0 && signal !== 'SIGTERM') {
          finish(() =>
            reject(new Error(`sandbox worker exited (${code ?? signal}): ${workerStderr.trim()}`)),
          );
        }
      });
      worker.stderr?.on('data', (chunk: Buffer) => {
        workerStderr += chunk.toString();
      });
      worker.on('message', (message: WorkerResult & { type?: string }) => {
        if (message.type === 'result') finish(() => resolve(message));
      });
      context.signal?.addEventListener('abort', () => this.killWorker(worker), { once: true });
      worker.send({
        type: 'run',
        command: input.command,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs,
        invocationId: input.invocationId,
      });
    });
  }

  private killWorker(worker?: SandboxWorker): void {
    if (!worker?.pid || worker.killed) return;
    try {
      process.kill(-worker.pid, 'SIGTERM');
    } catch {
      worker.kill('SIGTERM');
    }
  }

  private hostFallback(
    input: SandboxRunInput,
    reason: string,
    context: ToolContext,
  ): Promise<SandboxRunResult> {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const child = spawn(getShellPath(), ['-c', input.command], {
        cwd: input.cwd,
        env: process.env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let outputBytes = 0;
      let finished = false;
      const finish = (exitCode: number | null, errorText = ''): void => {
        if (finished) return;
        finished = true;
        if (errorText && !stderr) stderr = errorText;
        resolve({
          stdout,
          stderr,
          exitCode,
          duration: Date.now() - startedAt,
          metadata: { state: 'host_fallback', sandboxed: false, backend: 'host', reason },
        });
      };
      const terminate = (): void => killProcessGroup(child.pid);
      const timer = setTimeout(terminate, input.timeoutMs);
      const abortHandler = (): void => terminate();
      context.signal?.addEventListener('abort', abortHandler, { once: true });
      const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
        outputBytes += chunk.byteLength;
        if (outputBytes <= MAX_OUTPUT_BYTES) {
          if (target === 'stdout') stdout += chunk.toString();
          else stderr += chunk.toString();
        }
        if (outputBytes > MAX_OUTPUT_BYTES) terminate();
      };
      child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
      child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));
      child.once('error', (error) => {
        clearTimeout(timer);
        context.signal?.removeEventListener('abort', abortHandler);
        finish(null, error.message);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        context.signal?.removeEventListener('abort', abortHandler);
        finish(code);
      });
    });
  }
}

export const sandboxRunner = new SandboxRunner();

function killProcessGroup(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    /* process already exited */
  }
}
