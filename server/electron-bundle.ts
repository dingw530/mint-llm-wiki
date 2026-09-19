/**
 * Electron bundle entry point
 * 将 server 所有模块打包为单一文件，供 Electron main.js 通过 import() 加载。
 * HTTP server（startServer）和 IPC 服务全部从这里导出。
 *
 * require() shim 由 scripts/bundle.cjs 在打包后注入到文件头部，
 * 确保动态 require()（如 better-sqlite3 wrapper）在 ESM 环境下可用。
 */
export { shutdownServer, startServer, startServerRuntime } from './index.js';
export { IpcSink } from './services/sink.js';
export { endpointRegistry, registerIpcHandlers } from './endpoints/index.js';
export { conversationsIpcOnlyEndpoints } from './endpoints/definitions/conversations.js';
export * as messageService from './services/messageService.js';
export * as conversationService from './services/api/conversationService.js';
export * as settingsService from './services/api/settingsService.js';
export * as agentService from './services/api/agentService.js';
export * as endpointService from './services/api/endpointService.js';
export * as memoryService from './services/api/memoryService.js';
export * as mcpServerRepository from './repositories/mcpServerRepository.js';
export { mcpService } from './services/api/mcpService.js';
export * as skillService from './services/api/skillService.js';
export * as bashSecurityService from './services/api/bashSecurityService.js';
export * as wikiService from './services/api/wikiService.js';
export * as graphService from './services/api/graphService.js';
export * as messageRepository from './repositories/messageRepository.js';
export { generateTitle } from './services/aiProxy.js';
export { parseFile } from './services/utils/fileParseService.js';
export { compileSource } from './services/utils/wikiCompiler.js';
export { ingestWikiSource, buildWikiSourceText } from './services/api/wikiIngestionService.js';
export * as ingestionA2ui from './services/api/ingestionA2ui.js';
export {
  createWikiIngestionJobService,
  wikiIngestionJobService,
} from './services/api/wikiIngestionJobService.js';
export { wikiVectorBackfillService } from './services/api/wikiVectorBackfillService.js';
export * as pageCaptureService from './services/utils/wikiPageCapture.js';
