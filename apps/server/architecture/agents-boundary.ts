import type { RoutingDependency } from './routingBoundary.js';

const AGENTS_DOMAIN = 'domains/agents/';
const AGENT_REPOSITORY = 'infrastructure/persistence/agent-repository.ts';

/**
 * Enforce the incremental Agents application and persistence boundary.
 * @param edge Resolved source dependency, including literal dynamic imports
 * @returns A violation reason, or null when the dependency is allowed
 */
export function agentsBoundaryViolation(edge: RoutingDependency): string | null {
  const { importer, target, typeOnly } = edge;
  if (importer.includes('/__tests__/') || importer.endsWith('.test.ts')) return null;
  if (importer.startsWith(AGENTS_DOMAIN)) {
    if (target.startsWith(AGENTS_DOMAIN) || target === AGENT_REPOSITORY) return null;
    if (target === 'types.ts' && typeOnly) return null;
    return 'Agents may depend only on its own modules, Agent persistence, and type-only server types';
  }
  if (target.startsWith(AGENTS_DOMAIN)) {
    if (target !== `${AGENTS_DOMAIN}index.ts`) return 'Consumers must use the Agents public index';
    if (importer.startsWith('infrastructure/') && !typeOnly)
      return 'Infrastructure may import only Agents type contracts';
  }
  if (target === AGENT_REPOSITORY && !importer.startsWith(AGENTS_DOMAIN))
    return 'Agent persistence may be accessed only through the Agents domain';
  return null;
}
