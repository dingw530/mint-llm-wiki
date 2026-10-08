import type { z } from 'zod';

// ── 参数映射 ──

/**
 * 描述一个 IPC 位置参数如何映射到 HTTP 请求组件。
 * args 数组中的顺序对应 IPC 参数顺序。
 */
export interface ArgMapping {
  /** 'path' = req.params[name], 'query' = req.query[name], 'body' = req.body[name] */
  from: 'path' | 'query' | 'body';
  /** 参数名（如 'id', 'category', 'data'） */
  name?: string;
  /** 标记为可选（undefined 时跳过） */
  optional?: boolean;
}

// ── 响应包装 ──

/**
 * 如何包装服务调用结果：
 * - 'direct': res.json(result)  直接返回
 * - string:   res.json({ [key]: result })  用 key 包装
 * - function: 自定义转换
 */
export type ResultMapping =
  | 'direct'
  | string
  | ((result: unknown) => Record<string, unknown>);

// ── IPC 服务引用 ──

/**
 * 描述 IPC handler 如何定位服务函数。
 * 例如 { module: 'memSvc', method: 'listMemories' } → services.memSvc.listMemories(...)
 */
export interface ServiceRef {
  /** services 对象中的模块名 */
  module: string;
  /** 模块上的方法名 */
  method: string;
}

// ── Endpoint 描述符 ──

export interface EndpointDescriptor {
  /** 唯一标识，如 'memories:list', 'agents:create' */
  id: string;

  /** HTTP 方法 */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  /** Express 路径（相对于资源前缀），如 '/', '/:id', '/:id/restart' */
  path: string;

  /** IPC 通道名，默认等于 id */
  ipcChannel?: string;

  /** preload 桥接方法名（camelCase），如 'getMemories', 'createAgent' */
  preloadMethod?: string;

  /** Express 环境下的服务函数引用 */
  service: (...args: never[]) => unknown;

  /** IPC 环境下的服务引用路径（用于从 services 对象中解析）。如省略，IPC handler 直接使用 service 函数 */
  ipcServiceRef?: ServiceRef;

  /** IPC 位置参数到 HTTP 请求组件的映射 */
  args?: ArgMapping[];

  /** 响应包装方式，默认 'direct' */
  result?: ResultMapping;

  /** 可选的请求体 Zod 验证 schema */
  bodySchema?: z.ZodType<unknown>;

  /** 服务函数是否为 async */
  async?: boolean;

  /** 标记使用原始 HTTP 流响应；此类端点不生成 JSON/IPC handler。 */
  stream?: boolean;
}

// ── Manifest 条目（JSON 序列化格式，供 preload 和前端消费） ──

export interface ManifestEntry {
  id: string;
  ipcChannel: string;
  preloadMethod: string | null;
  method: string;
  httpPath: string;
  args: ArgMapping[];
  result: string | null;
  async: boolean;
}

// ── 辅助类型 ──

export interface HttpError extends Error {
  status?: number;
}
