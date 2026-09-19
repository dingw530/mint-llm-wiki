import express from 'express';
import { describe, expect, it } from 'vitest';
import { InProcessJobQueue } from '../../services/jobs/jobQueue.js';
import { ServerRuntime } from '../serverRuntime.js';

describe('lifecycle integration', () => {
  it('stops accepting work before draining the queue', async () => {
    const queue = new InProcessJobQueue();
    let releaseWorker!: () => void;
    let workerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      workerStarted = resolve;
    });
    const worker = new Promise<void>((resolve) => {
      releaseWorker = resolve;
    });
    queue.start(async () => {
      workerStarted();
      await worker;
    });
    queue.enqueue('active-job');
    await started;

    let stopped = false;
    const stopping = queue.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    releaseWorker();
    await stopping;
    expect(stopped).toBe(true);
  });

  it('closes a real HTTP listener after stop-new-work and task drain', async () => {
    const app = express();
    app.get('/health', (_request, response) => response.json({ ok: true }));
    const events: string[] = [];
    const runtime = new ServerRuntime({
      app,
      preferredPort: 0,
      host: '127.0.0.1',
      startBackgroundServices: false,
      onLifecycleEvent: (event) => events.push(event),
    });

    await runtime.start();
    const response = await fetch(`http://127.0.0.1:${runtime.port}/health`);
    expect(response.status).toBe(200);
    await runtime.shutdown('integration');

    expect(runtime.state).toBe('stopped');
    expect(events.indexOf('stop-new-work')).toBeLessThan(events.indexOf('agent-runs'));
    expect(events.indexOf('agent-runs')).toBeLessThan(events.indexOf('memory'));
    expect(events.indexOf('memory')).toBeLessThan(events.indexOf('wiki-ingestion'));
    expect(events.indexOf('wiki-ingestion')).toBeLessThan(events.indexOf('http'));
    expect(events.indexOf('http')).toBeLessThan(events.indexOf('mcp'));
    expect(events.indexOf('mcp')).toBeLessThan(events.indexOf('langfuse'));
    expect(events.indexOf('langfuse')).toBeLessThan(events.indexOf('wiki-lifecycle'));
    expect(events.indexOf('wiki-lifecycle')).toBeLessThan(events.indexOf('sqlite'));

    await expect(fetch(`http://127.0.0.1:${runtime.port}/health`)).rejects.toThrow();
  });
});
