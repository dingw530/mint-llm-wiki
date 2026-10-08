import { BashTool } from '../infrastructure/tools/bash-tool.js';
import { HttpFetchTool } from '../infrastructure/tools/http-fetch-tool.js';
import { ReadArtifactTool } from '../infrastructure/tools/read-artifact-tool.js';
import { ReadFileTool } from '../application/tools/wiki/read-wiki-file-tool.js';
import { WriteFileTool } from '../application/tools/wiki/write-wiki-file-tool.js';
import { InvokeAgentTool } from '../application/tools/agents/invoke-agent-tool.js';
import { KnowledgeGraphTool } from '../application/tools/knowledge-graph/knowledge-graph-tool.js';
import { SkillTool } from '../application/tools/skills/skill-tool.js';
import { WikiIngestTool } from '../application/tools/wiki/wiki-ingest-tool.js';
import { WikiLintTool } from '../application/tools/wiki/wiki-lint-tool.js';
import { WikiSearchTool } from '../application/tools/wiki/wiki-search-tool.js';
import { DiscoverToolsTool, LoadToolTool } from '../application/tools/mcp/tool-catalog-tools.js';
import { mcpService } from './mcp-client.js';
import { toolRegistry } from '../application/agent-runtime/tooling/tool-registry.js';

const builtinTools = [
  new HttpFetchTool(),
  new SkillTool(),
  new BashTool(),
  new InvokeAgentTool(),
  new ReadFileTool(),
  new ReadArtifactTool(),
  new WriteFileTool(),
  new WikiIngestTool(),
  new WikiLintTool(),
  new WikiSearchTool(),
  new KnowledgeGraphTool(),
  new DiscoverToolsTool(mcpService),
  new LoadToolTool(mcpService),
];

let initialized = false;

/** Register all built-in handlers once at the process composition boundary. */
export function initializeToolRegistry(): void {
  if (initialized) return;
  toolRegistry.registerAll(builtinTools);
  initialized = true;
}
