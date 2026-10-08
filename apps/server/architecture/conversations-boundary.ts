import type { RoutingDependency } from './routingBoundary.js';

const DOMAIN = 'domains/conversations/';
const INFRASTRUCTURE = new Set([
  'infrastructure/persistence/conversation-repository.ts',
  'infrastructure/config/conversation-defaults.ts',
]);

/**
 * Enforce the conversation metadata and management application boundary.
 * @param edge Resolved source dependency, including literal dynamic imports
 * @returns A violation reason, or null when the dependency is allowed
 */
export function conversationsBoundaryViolation(edge: RoutingDependency): string | null {
  const { importer, target, typeOnly } = edge;
  if (importer.includes('/__tests__/') || importer.endsWith('.test.ts')) return null;
  if (importer.startsWith(DOMAIN)) {
    if (target.startsWith(DOMAIN) || INFRASTRUCTURE.has(target)) return null;
    if (target === 'types.ts' && typeOnly) return null;
    return 'Conversations must use its own infrastructure and type-only server contracts';
  }
  if (target.startsWith(DOMAIN)) {
    if (target !== `${DOMAIN}index.ts`) return 'Consumers must use the Conversations public index';
    if (importer.startsWith('infrastructure/') && !typeOnly)
      return 'Infrastructure may import only Conversations type contracts';
  }
  if (INFRASTRUCTURE.has(target) && !importer.startsWith(DOMAIN))
    return 'Conversation infrastructure may be accessed only through its domain';
  return null;
}
