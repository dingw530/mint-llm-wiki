import type { EndpointDescriptor, ServiceRef } from '../types.js';
import { wrapResult } from '../helpers.js';
import { createLogger } from '../../infrastructure/observability/logger.js';

const log = createLogger('ipc-handlers');

// ── 服务引用解析 ──

type DynamicService = (...args: never[]) => unknown;
type ServiceMap = Record<string, unknown>;

function resolveService(ref: ServiceRef, services: ServiceMap): DynamicService | null {
  const module = services[ref.module];
  if (!module || typeof module !== 'object') return null;
  const method = Reflect.get(module, ref.method);
  if (typeof method !== 'function') return null;
  return method.bind(module) as DynamicService;
}

// ── IPC handle 接口（兼容 Electron 的 ipcMain） ──

interface IpcMain {
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void;
}

// ── 注册 IPC handlers ──

export function registerIpcHandlers(
  descriptors: EndpointDescriptor[],
  services: ServiceMap,
  ipcMain: IpcMain,
): void {
  for (const desc of descriptors) {
    if (desc.stream) continue;
    const channel = desc.ipcChannel || desc.id;

    // 优先使用 ipcServiceRef（从 services 对象解析），否则直接用 desc.service
    let serviceFn: DynamicService | null = null;
    if (desc.ipcServiceRef) {
      serviceFn = resolveService(desc.ipcServiceRef, services);
      if (!serviceFn) {
        log.warn(
          `Service not found for ${desc.id}: ${desc.ipcServiceRef.module}.${desc.ipcServiceRef.method}, skipping`,
        );
        continue;
      }
    } else {
      serviceFn = desc.service;
    }

    const isAsync = desc.async || false;

    ipcMain.handle(channel, async (_event: unknown, ...ipcArgs: unknown[]) => {
      const result = isAsync
        ? await Reflect.apply(serviceFn!, undefined, ipcArgs)
        : Reflect.apply(serviceFn!, undefined, ipcArgs);

      return wrapResult(result, desc.result ?? 'direct');
    });

    log.debug(`Registered IPC handler: ${channel}`);
  }

  log.info(`Registered ${descriptors.length} IPC handlers`);
}
