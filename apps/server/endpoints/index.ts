// ── 公共 API ──

export type { EndpointDescriptor, ArgMapping, ResultMapping, ServiceRef, ManifestEntry } from './types.js';
export { EndpointRegistry, endpointRegistry } from './registry.js';
export { extractArgs, wrapResult, httpError } from './helpers.js';
export { createResourceRouter } from './generate/expressRoutes.js';
export { registerIpcHandlers } from './generate/ipcHandlers.js';
export { generateManifest, writeManifest } from './generate/manifest.js';

// ── 定义文件汇总 ──
import { registerAllEndpoints } from './definitions/index.js';
registerAllEndpoints();
