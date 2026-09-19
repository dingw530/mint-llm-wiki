import type { Express } from 'express';
import type { Server } from 'node:http';
import { closeDb } from '../db.js';
import { agentRunRegistry } from '../services/agentRun.js';
import { listSkills } from '../services/api/skillService.js';
import { mcpService } from '../services/api/mcpService.js';
import { startMemoryProcessing, stopMemoryProcessing } from '../services/api/memoryJobService.js';
import { wikiIngestionJobService } from '../services/api/wikiIngestionJobService.js';
import { startWikiLifecycleProcessing } from '../services/api/wikiLifecycleService.js';
import { flushLangfuseTracing } from '../services/observability/langfuse.js';
import { cleanupArtifacts } from '../services/utils/toolResultArtifact.js';
import { getAddressPort, getErrorMessage } from '../utils/typeGuards.js';
import { createLogger } from '../utils/logger.js';

export type RuntimeState = 'created' | 'starting' | 'running' | 'stopping' | 'stopped';

export interface ServerRuntimeOptions {
  app: Express;
  preferredPort: number;
  host: string;
  startBackgroundServices?: boolean;
  shutdownTimeoutMs?: number;
  onLifecycleEvent?: (event: string) => void;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const log = createLogger('server-runtime');

/** Owns one server process and releases its resources in a bounded order. */
export class ServerRuntime {
  private stateValue: RuntimeState = 'created';
  private startPromise?: Promise<void>;
  private shutdownPromise?: Promise<void>;
  private httpServer?: Server;
  private lifecycleTimer?: ReturnType<typeof setInterval>;
  private actualPort?: number;
  private httpClosePromise?: Promise<void>;

  constructor(private readonly options: ServerRuntimeOptions) {}

  /** Return the current lifecycle state. */
  get state(): RuntimeState {
    return this.stateValue;
  }

  /** Return the actual bound port after start. */
  get port(): number | undefined {
    return this.actualPort;
  }

  /** Start this runtime once and share the in-flight promise. */
  start(): Promise<void> {
    if (this.stateValue === 'running') return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    if (this.stateValue !== 'created') {
      return Promise.reject(new Error(`Cannot start runtime in state ${this.stateValue}`));
    }
    this.startPromise = this.startInternal();
    return this.startPromise;
  }

  /** Stop all owned resources once and share the in-flight promise. */
  shutdown(reason = 'shutdown'): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    if (this.stateValue === 'stopped') return Promise.resolve();
    this.shutdownPromise = this.shutdownInternal(reason);
    return this.shutdownPromise;
  }

  private async startInternal(): Promise<void> {
    this.stateValue = 'starting';
    try {
      await cleanupArtifacts({ mode: 'startup' }).catch((error: unknown) => {
        log.warn('startup artifact cleanup failed; continuing', { error: getErrorMessage(error) });
      });
      await this.startBackgroundServices();
      await this.listen();
      this.stateValue = 'running';
      log.info('runtime started', { port: this.actualPort });
    } catch (error) {
      await this.shutdownInternal('startup-failure');
      throw error;
    }
  }

  private async startBackgroundServices(): Promise<void> {
    try {
      await listSkills();
    } catch (error) {
      log.warn('skill scan failed; continuing startup', { error: getErrorMessage(error) });
    }
    if (this.options.startBackgroundServices === false) return;
    await mcpService.initialize();
    startMemoryProcessing();
    wikiIngestionJobService.startWorker();
    this.lifecycleTimer = startWikiLifecycleProcessing();
  }

  private listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = this.options.app.listen(this.options.preferredPort, this.options.host, () => {
        const port = getAddressPort(server.address());
        if (port === null) {
          reject(new Error('Server started without a TCP address'));
          return;
        }
        this.httpServer = server;
        this.actualPort = port;
        resolve();
      });
      this.httpServer = server;
      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          log.warn(`port ${this.options.preferredPort} is in use; trying a random port`);
          server.close();
          const fallback = this.options.app.listen(0, this.options.host, () => {
            const port = getAddressPort(fallback.address());
            if (port === null) {
              reject(new Error('Fallback server started without a TCP address'));
              return;
            }
            this.httpServer = fallback;
            this.actualPort = port;
            resolve();
          });
          this.httpServer = fallback;
          fallback.on('error', reject);
          return;
        }
        reject(error);
      });
    });
  }

  private async shutdownInternal(reason: string): Promise<void> {
    if (this.stateValue === 'stopped') return;
    this.stateValue = 'stopping';
    const deadline = Date.now() + (this.options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS);
    await this.closeStep('stop-new-work', () => this.beginHttpShutdown(), deadline);
    await this.closeStep('agent-runs', () => agentRunRegistry.cancelAll(), deadline);
    await this.closeStep('memory', () => stopMemoryProcessing(), deadline);
    await this.closeStep(
      'wiki-ingestion',
      () => wikiIngestionJobService.shutdownWorker(),
      deadline,
    );
    await this.closeStep('http', () => this.finishHttpShutdown(), deadline);
    await this.closeStep('mcp', () => mcpService.shutdown(), deadline);
    await this.closeStep('langfuse', () => flushLangfuseTracing(), deadline);
    await this.closeStep(
      'wiki-lifecycle',
      () => {
        if (this.lifecycleTimer) clearInterval(this.lifecycleTimer);
        this.lifecycleTimer = undefined;
      },
      deadline,
    );
    await this.closeStep('sqlite', () => closeDb(), deadline);
    this.stateValue = 'stopped';
    log.info('runtime stopped', { reason });
  }

  private closeHttpServer(): Promise<void> {
    const server = this.httpServer;
    this.httpServer = undefined;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  private beginHttpShutdown(): void {
    const server = this.httpServer;
    if (!server || this.httpClosePromise) return;
    this.httpClosePromise = new Promise((resolve) => server.close(() => resolve()));
  }

  private async finishHttpShutdown(): Promise<void> {
    this.httpServer?.closeAllConnections?.();
    await (this.httpClosePromise || this.closeHttpServer());
    this.httpServer = undefined;
    this.httpClosePromise = undefined;
  }

  private async closeStep(
    name: string,
    close: () => void | Promise<void>,
    deadline: number,
  ): Promise<void> {
    const remaining = Math.max(0, deadline - Date.now());
    if (remaining === 0) {
      log.warn('shutdown step skipped after deadline', { resource: name });
      return;
    }
    try {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(close),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('shutdown timeout')), remaining);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      this.options.onLifecycleEvent?.(name);
    } catch (error) {
      log.warn('shutdown step failed', { resource: name, error: getErrorMessage(error) });
    }
  }
}
