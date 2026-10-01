import type { Request } from 'express';
import type { ArgMapping, ResultMapping, HttpError } from './types.js';

// ── 从 Express Request 提取服务参数 ──

export function extractArgs(req: Request, args: ArgMapping[]): unknown[] {
  const result: unknown[] = [];
  for (const arg of args) {
    let value: unknown;
    switch (arg.from) {
      case 'path':
        value = req.params[arg.name!];
        break;
      case 'query':
        value = arg.name === undefined ? req.query : req.query[arg.name];
        break;
      case 'body':
        value = arg.name ? req.body?.[arg.name] : req.body;
        break;
    }
    if (value !== undefined) {
      result.push(value);
    } else if (!arg.optional) {
      result.push(undefined);
    }
    // optional + undefined: 跳过，不推入
  }
  return result;
}

// ── 包装服务结果为 HTTP 响应 ──

export function wrapResult(result: unknown, mapping: ResultMapping = 'direct'): unknown {
  if (mapping === 'direct') {
    return result;
  }
  if (typeof mapping === 'string') {
    return { [mapping]: result };
  }
  if (typeof mapping === 'function') {
    return mapping(result);
  }
  return result;
}

// ── 创建带状态码的 HTTP 错误 ──

export function httpError(status: number, message: string): HttpError {
  const err = new Error(message) as HttpError;
  err.status = status;
  return err;
}
