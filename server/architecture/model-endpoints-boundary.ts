import type { RoutingDependency } from './routingBoundary.js';

const MODEL_ENDPOINTS_DOMAIN = 'domains/model-endpoints/';
const MODEL_ENDPOINT_REPOSITORY = 'infrastructure/persistence/model-endpoint-repository.ts';
const ENCRYPTION_HELPER = 'infrastructure/security/encryption.ts';

/**
 * Enforce model endpoint management and persistence ownership during incremental migration.
 * @param edge Resolved static import, re-export, or literal dynamic dependency
 * @returns A violation reason, or null when this boundary permits the dependency
 */
export function modelEndpointsBoundaryViolation(edge: RoutingDependency): string | null {
  const { importer, target, typeOnly } = edge;
  if (importer.includes('/__tests__/') || importer.endsWith('.test.ts')) return null;
  if (importer.startsWith(MODEL_ENDPOINTS_DOMAIN)) {
    if (target.startsWith(MODEL_ENDPOINTS_DOMAIN) || target === MODEL_ENDPOINT_REPOSITORY)
      return null;
    if (target === ENCRYPTION_HELPER || (target === 'types.ts' && typeOnly)) return null;
    return 'Model endpoints may depend only on their own modules, persistence, encryption helper, and type contracts';
  }
  if (target.startsWith(MODEL_ENDPOINTS_DOMAIN)) {
    if (target !== `${MODEL_ENDPOINTS_DOMAIN}index.ts`)
      return 'Consumers must use the Model endpoints public index';
    if (importer.startsWith('infrastructure/') && !typeOnly)
      return 'Infrastructure may import only Model endpoints type contracts';
  }
  if (target === MODEL_ENDPOINT_REPOSITORY)
    return 'Model endpoint persistence may be accessed only through the Model endpoints domain';
  return null;
}
