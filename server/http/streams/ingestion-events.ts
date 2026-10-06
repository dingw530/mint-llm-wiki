import type { Request, Response } from 'express';
import { wikiIngestionJobService } from '../../application/wiki/wiki-ingestion-job-service.js';
import {
  createSurface,
  updateComponents,
  updateDataModel,
} from '../../infrastructure/transports/ingestion-a2ui.js';

/** 将指定会话的摄入任务事件以标准 A2UI envelope 持续推送。 */
export function streamConversationIngestionEvents(
  conversationId: string,
  req: Request,
  res: Response,
): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;
  const heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) res.write(': keep-alive\n\n');
  }, 15_000);
  const write = (event: unknown): void => {
    if (!closed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  // Flush one byte immediately so clients/proxies establish the SSE response
  // even when this conversation has no ingestion jobs yet.
  res.write(': connected\n\n');
  const jobs = wikiIngestionJobService
    .list({ limit: 100 })
    .filter((job) => job.sourceType === 'chat' && job.conversationId === conversationId);
  const sentSurfaces = new Set<string>();
  for (const job of jobs) {
    write(createSurface(job));
    write(updateComponents(job));
    write(updateDataModel(job));
    sentSurfaces.add(job.id);
  }
  const unsubscribe = wikiIngestionJobService.subscribe((job) => {
    if (job.sourceType !== 'chat' || job.conversationId !== conversationId) return;
    if (!sentSurfaces.has(job.id)) {
      write(createSurface(job));
      write(updateComponents(job));
      sentSurfaces.add(job.id);
    }
    write(updateDataModel(job));
  });
  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });
  res.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });
}
