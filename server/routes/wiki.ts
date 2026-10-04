import type { Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import * as wikiService from '../domains/wiki/index.js';
import { wikiIngestionJobService } from '../application/wiki/wiki-ingestion-job-service.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// 文件上传配置（内存存储，最大 50MB 给路由层兜底，业务层按 wikiMaxFileSize 限制）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// POST /api/wiki/upload — 上传文件到 Wiki 知识库（异步：立即返回 jobId，后台处理）
router.post(
  '/upload',
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: '请上传文件' });
      return;
    }

    const { originalname, buffer, size } = req.file;
    const idempotencyKey =
      typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : undefined;
    const result = wikiIngestionJobService.start({
      name: originalname,
      buffer,
      size,
      idempotencyKey,
    });
    res.json(result);
  }),
);

// GET /api/wiki/list — 列出 Wiki 文件树（递归）
router.get(
  '/list',
  asyncHandler(async (_req: Request, res: Response) => {
    const result = wikiService.listWiki();
    res.json(result);
  }),
);

// GET /api/wiki/read?path=xxx — 读取 Wiki 文件内容
router.get(
  '/read',
  asyncHandler(async (req: Request, res: Response) => {
    const filePath = req.query.path as string;
    const result = wikiService.readWiki(filePath);
    res.json(result);
  }),
);

export default router;
