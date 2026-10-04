import type { RoutingDependency } from './routingBoundary.js';

const TYPE_CONTRACT_IMPORTS = new Set([
  'types.ts',
  'agent-runtime/agent-run.ts',
  'services/adapters/apiAdapter.ts',
  'services/a2ui/composer.ts',
  'services/runtime/runtimeContext.ts',
  'services/a2ui/types.ts',
  'services/utils/contextWindow.ts',
  'services/toolRoundEngine.ts',
]);

/** Limit the Agent Runtime core to its own modules and type-only contracts. */
export function agentRuntimeBoundaryViolation(edge: RoutingDependency): string | null {
  const { importer, target, typeOnly } = edge;
  if (importer.includes('/__tests__/') || importer.endsWith('.test.ts')) return null;
  if (!importer.startsWith('agent-runtime/')) return null;
  if (target.startsWith('agent-runtime/')) return null;
  if (typeOnly && TYPE_CONTRACT_IMPORTS.has(target)) return null;
  if (
    target.startsWith('services/') ||
    target.startsWith('application/') ||
    target.startsWith('repositories/') ||
    target.startsWith('infrastructure/') ||
    target.startsWith('bootstrap/')
  ) {
    return 'Agent Runtime core may import only its contracts and explicitly registered transitional bridges';
  }
  return null;
}
