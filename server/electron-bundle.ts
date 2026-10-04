/**
 * Electron bundle entry point
 * 将 server 所有模块打包为单一文件，供 Electron main.js 通过 import() 加载。
 * HTTP server（startServer）和 IPC 服务全部从这里导出。
 *
 * require() shim 由 scripts/bundle.cjs 在打包后注入到文件头部，
 * 确保动态 require()（如 better-sqlite3 wrapper）在 ESM 环境下可用。
 */
export { shutdownServer, startServer, startServerRuntime } from './index.js';
export { IpcSink } from './infrastructure/transports/sinks.js';
export { endpointRegistry, registerIpcHandlers } from './endpoints/index.js';
export { conversationsIpcOnlyEndpoints } from './endpoints/definitions/conversations.js';
export * as messageService from './services/messageService.js';
export * as conversationService from './domains/conversations/index.js';
export * as settingsService from './application/settings/settings-service.js';
export * as agentService from './domains/agents/index.js';
export * as endpointService from './domains/model-endpoints/index.js';
export { memoryService } from './bootstrap/memory.js';
export * as mcpServerRepository from './infrastructure/persistence/mcp-server-repository.js';
export { mcpService } from './bootstrap/mcp-client.js';
export * as skillService from './domains/skills/index.js';
export * as bashSecurityService from './domains/tool-security/index.js';
export * as wikiService from './domains/wiki/index.js';
export * as graphService from './domains/knowledge-graph/index.js';
export * as messageRepository from './repositories/messageRepository.js';
export { generateTitle } from './services/aiProxy.js';
export { parseFile } from './services/utils/fileParseService.js';
export { compileSource } from './domains/wiki/index.js';
export { ingestWikiSource, buildWikiSourceText } from './domains/wiki/index.js';
export * as ingestionA2ui from './infrastructure/transports/ingestion-a2ui.js';
export {
  createWikiIngestionJobService,
  wikiIngestionJobService,
} from './application/wiki/wiki-ingestion-job-service.js';
export { wikiVectorBackfillService } from './application/wiki/wiki-vector-backfill-service.js';
export * as pageCaptureService from './services/utils/wikiPageCapture.js';
