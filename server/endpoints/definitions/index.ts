import { endpointRegistry } from '../registry.js';
import { settingsEndpoints } from './settings.js';
import { memoriesEndpoints } from './memories.js';
import { bashSecurityEndpoints } from './bashSecurity.js';
import { skillsEndpoints } from './skills.js';
import { routingLogsEndpoints } from './routingLogs.js';
import { agentsEndpoints } from './agents.js';
import { modelEndpointsEndpoints } from './modelEndpoints.js';
import { mcpServersEndpoints } from './mcpServers.js';
import { conversationsEndpoints } from './conversations.js';
import { wikiEndpoints } from './wiki.js';
import { graphEndpoints } from './graph.js';

// ── 注册所有 endpoint 定义 ──

export function registerAllEndpoints(): void {
  endpointRegistry.registerAll(settingsEndpoints);
  endpointRegistry.registerAll(memoriesEndpoints);
  endpointRegistry.registerAll(bashSecurityEndpoints);
  endpointRegistry.registerAll(skillsEndpoints);
  endpointRegistry.registerAll(routingLogsEndpoints);
  endpointRegistry.registerAll(agentsEndpoints);
  endpointRegistry.registerAll(modelEndpointsEndpoints);
  endpointRegistry.registerAll(mcpServersEndpoints);
  endpointRegistry.registerAll(conversationsEndpoints);
  endpointRegistry.registerAll(wikiEndpoints);
  endpointRegistry.registerAll(graphEndpoints);
}
