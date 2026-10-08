/**
 * 判断未知值是否为可索引的 JSON 对象。
 * @param value 待判断值
 * @returns 值是否为非 null 且非数组的对象
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 将未知错误转换为稳定的日志或用户可见文本。
 * @param error 捕获到的未知错误
 * @returns 错误消息
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 读取未知对象上的字符串字段。 */
export function readString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' ? value[key] : undefined;
}

/** 读取未知对象上的数字字段。 */
export function readNumber(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] : undefined;
}

/**
 * 从 Node HTTP server 地址中读取实际端口。
 * @param address server.address() 返回值
 * @returns 实际端口；地址不可用时返回 null
 */
export function getAddressPort(address: ReturnType<Server['address']>): number | null {
  return address && typeof address !== 'string' ? address.port : null;
}
import type { Server } from 'node:http';
