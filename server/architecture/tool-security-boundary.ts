import type { RoutingDependency } from './routingBoundary.js';

const DOMAIN = 'domains/tool-security/';
const CONFIGURATION = 'infrastructure/config/bash-security-settings.ts';

/**
 * Enforce ownership of Bash security policy and its persisted configuration.
 * @param edge Resolved static import, re-export, or literal dynamic import
 * @returns A violation reason, or null for an allowed dependency
 */
export function toolSecurityBoundaryViolation(edge: RoutingDependency): string | null {
  const { importer, target, typeOnly } = edge;
  if (importer.includes('/__tests__/') || importer.endsWith('.test.ts')) return null;
  if (importer.startsWith(DOMAIN)) {
    if (target.startsWith(DOMAIN) || target === CONFIGURATION) return null;
    return 'Tool security may depend only on its own policy and configuration adapter';
  }
  if (target.startsWith(DOMAIN)) {
    if (target !== `${DOMAIN}index.ts`) return 'Consumers must use the Tool security public index';
    if (importer.startsWith('infrastructure/') && !typeOnly)
      return 'Infrastructure may import only Tool security type contracts';
  }
  if (target === CONFIGURATION)
    return 'Bash security configuration may be accessed only through Tool security';
  return null;
}
