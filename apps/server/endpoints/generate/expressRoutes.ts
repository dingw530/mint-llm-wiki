import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { Router } from 'express';
import type { EndpointDescriptor } from '../types.js';
import { extractArgs, wrapResult } from '../helpers.js';
import { asyncHandler } from '../../middleware/errorHandler.js';

// ── 从描述符创建 Express 路由处理器 ──

function createHandler(desc: EndpointDescriptor): RequestHandler {
  const handler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    // 1. 按 args 映射提取参数
    const serviceArgs = extractArgs(req, desc.args || []);

    // 2. 可选的 body 验证
    if (desc.bodySchema && req.method !== 'GET') {
      desc.bodySchema.parse(req.body);
    }

    // 3. 调用服务
    const invocationArgs = [...serviceArgs, ...(desc.stream ? [req, res] : [])];
    const result = desc.async
      ? await Reflect.apply(desc.service, undefined, invocationArgs)
      : Reflect.apply(desc.service, undefined, invocationArgs);

    if (desc.stream) return;

    // 4. 包装响应
    const response = wrapResult(result, desc.result ?? 'direct');
    const status = desc.method === 'POST' ? 201 : 200;
    res.status(status).json(response);
  };

  return asyncHandler(handler);
}

// ── 从一组描述符创建资源路由 ──

export function createResourceRouter(descriptors: EndpointDescriptor[]): Router {
  const router = Router();

  for (const desc of descriptors) {
    const method = desc.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    router[method](desc.path, createHandler(desc));
  }

  return router;
}
