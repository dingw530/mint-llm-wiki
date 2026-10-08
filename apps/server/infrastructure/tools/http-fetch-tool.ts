/**
 * HTTP 请求工具 - 使用 undici + 浏览器请求头
 */

import { z } from 'zod';
import { BaseTool } from '../../agent-runtime/tooling/base-tool.js';
import { browserFetch } from '../network/browser-fetch.js';
import type { ToolContext, ToolMetadata } from '../../agent-runtime/tooling/tool-contracts.js';

// ── 输入 Schema ──

const HttpFetchInputSchema = z.object({
  url: z.string().describe('请求 URL'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
    .optional()
    .default('GET')
    .describe('HTTP 方法，默认 GET'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('自定义请求头（会合并到浏览器默认头之上）'),
  body: z.string().optional().describe('请求体（字符串）'),
  timeout: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .optional()
    .default(30000)
    .describe('超时时间（毫秒），默认 30000'),
});

type HttpFetchInput = z.infer<typeof HttpFetchInputSchema>;

// ── 输出类型 ──

interface HttpFetchOutput {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
}

// ── HTTP 请求工具 ──

export class HttpFetchTool extends BaseTool<HttpFetchInput, HttpFetchOutput> {
  readonly name = 'http_fetch';
  readonly description =
    '发起 HTTP 请求获取外部数据（支持 GET/POST/PUT/DELETE/PATCH），使用浏览器风格请求头避免被拦截';
  readonly inputSchema = HttpFetchInputSchema;

  isReadOnly(): boolean {
    return false;
  }

  isIdempotent(): boolean {
    return false;
  }

  getMetadata(): ToolMetadata {
    return { ...super.getMetadata(), approvalMode: 'conditional', sideEffect: 'network' };
  }

  validate(input: unknown): { valid: boolean; error?: string } {
    const baseValidation = super.validate(input);
    if (!baseValidation.valid) {
      return baseValidation;
    }

    const typedInput = input as HttpFetchInput;
    if (['POST', 'PUT', 'PATCH'].includes(typedInput.method || 'GET') && !typedInput.body) {
      console.warn(`[HttpFetchTool] ${typedInput.method} request without body`);
    }

    return { valid: true };
  }

  async execute(input: HttpFetchInput, context: ToolContext): Promise<HttpFetchOutput> {
    const { url, method, headers, body, timeout } = input;
    const startTime = Date.now();

    try {
      const response = await browserFetch(url, {
        method: method || 'GET',
        headers,
        body: body && ['POST', 'PUT', 'PATCH'].includes(method || 'GET') ? body : undefined,
        timeout,
        signal: context.signal,
        targetPolicy: 'public-only',
      });

      const responseText = await response.text();
      const duration = Date.now() - startTime;

      // 转换 headers 为 Record<string, string>
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body:
          responseText.length > 10000
            ? responseText.substring(0, 10000) + '\n...(truncated)'
            : responseText,
        duration,
      };
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        if (context.signal?.aborted) {
          throw new Error('Request was cancelled');
        }
        // browserFetch 已经把超时错误包装好了
        throw err;
      }

      throw new Error(`HTTP request failed: ${(err as Error).message}`);
    }
  }
}
