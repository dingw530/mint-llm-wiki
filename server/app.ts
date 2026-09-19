import path from 'path';
import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import { createResourceRouter, endpointRegistry } from './endpoints/index.js';
import conversationsRouter from './routes/conversations.js';
import messagesRouter from './routes/messages.js';
import wikiRouter from './routes/wiki.js';

const defaultCorsOrigins = [
  'http://localhost:5800',
  'http://127.0.0.1:5800',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const CLIENT_ASSET_RATE_LIMIT_WINDOW_MS = 60_000;
const CLIENT_ASSET_RATE_LIMIT_MAX_REQUESTS = 120;

/**
 * Create the rate limiter for production client assets and SPA fallback.
 * @returns Middleware that limits non-API client asset requests per IP
 */
export function createClientAssetRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: CLIENT_ASSET_RATE_LIMIT_WINDOW_MS,
    limit: CLIENT_ASSET_RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/api') || !['GET', 'HEAD'].includes(req.method),
    message: { error: 'Too many client asset requests, please try again later.' },
  });
}

/**
 * Resolves configured development origins without opening the API to the
 * entire network. Requests without an Origin are allowed for Electron.
 * @param origin Browser Origin header, when present
 * @returns Whether the origin is allowed to receive CORS headers
 */
export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const configuredOrigins = process.env.AI_CHAT_CORS_ORIGINS?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = configuredOrigins?.length ? configuredOrigins : defaultCorsOrigins;
  return allowedOrigins.includes(origin);
}

/**
 * Create the Express application without starting process-owned resources.
 * @returns Configured Express application
 */
export function createApp(): express.Express {
  const app = express();
  app.use(
    cors({
      origin: (origin, callback) => callback(null, isAllowedCorsOrigin(origin)),
    }),
  );
  app.use(express.json());

  // ── 手动路由（SSE 流式、generateTitle 等复杂端点） ──
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/conversations', messagesRouter);

  // ── Wiki 知识库浏览 ──
  app.use('/api/wiki', wikiRouter);

  // ── 自动生成路由（Endpoint Registry） ──
  for (const resource of endpointRegistry.resources()) {
    app.use(`/api/${resource}`, createResourceRouter(endpointRegistry.getByResource(resource)));
  }

  // ── 生产模式静态文件服务 ──
  const clientDistPath = process.env.AI_CHAT_CLIENT_DIST;
  if (clientDistPath) {
    app.use(createClientAssetRateLimiter());
    app.use(express.static(clientDistPath));
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.resolve(clientDistPath, 'index.html'));
      }
    });
  }

  // 全局错误处理中间件（必须在路由之后注册）
  app.use(errorHandler);
  return app;
}

export default createApp();
