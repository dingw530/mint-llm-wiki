// ── 统一入口：re-export 所有模块 ──

export { callEndpoint } from './api/_base';

export {
  getConversations,
  createConversation,
  deleteConversation,
  clearAllConversations,
  renameConversation,
  lockAgent,
  unlockAgent,
  getMessages,
  generateTitle,
} from './api/conversations';
export { fetchAgents, createAgent, updateAgent, deleteAgent } from './api/agents';
export {
  getMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  restartMcpServer,
} from './api/mcpServers';
export { getMemories, createMemory, updateMemory, deleteMemory } from './api/memories';
export {
  getEndpoints,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  activateEndpoint,
  listEndpointModels,
  testEndpointConnection,
} from './api/endpoints';
export {
  getSettings,
  saveSettings,
  testEmbeddingConnection,
  testChromaConnection,
  testJevConnection,
} from './api/settings';
export { sendMessageStream } from './api/streaming';
export { resolveToolApproval } from './api/toolApprovals';
export { generateImage, sendImageMessage } from './api/images';
export { getSkills } from './api/skills';
export {
  listWiki,
  readWiki,
  getWikiHeat,
  getWikiVectorHealth,
  startWikiVectorBackfill,
  getWikiVectorBackfill,
  retryWikiVectorBackfill,
  openWikiInObsidian,
  uploadWiki,
  getJobStatus,
  listWikiJobs,
  getWikiJob,
  retryWikiJob,
  cancelWikiJob,
  removeWikiJob,
  getWikiSchema,
  addWikiCategory,
  removeWikiCategory,
  updateWikiSchema,
  getGraphData,
  getGraphNode,
  getGraphNodeNeighbors,
  searchGraphNodes,
  createGraphNode,
  createGraphEdge,
  listGraphCandidates,
  acceptGraphCandidate,
  rejectGraphCandidate,
} from './api/wiki';
