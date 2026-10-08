import type { RoutingDependency } from './routingBoundary.js';

const HTTP_STREAM = 'http/streams/ingestion-events.ts';
const PROJECTION = 'infrastructure/transports/ingestion-a2ui.ts';
const WORKER_FACADE = 'application/wiki/wiki-ingestion-job-service.ts';

/**
 * Keep ingestion presentation and HTTP subscriptions outside business and runtime policy.
 * @param edge Resolved static import, re-export, or literal dynamic import
 * @returns A violation reason, or null for an allowed dependency
 */
export function ingestionTransportBoundaryViolation(edge: RoutingDependency): string | null {
  const { importer, target, typeOnly } = edge;
  if (importer.includes('/__tests__/') || importer.endsWith('.test.ts')) return null;
  if (importer === PROJECTION) {
    if (target === 'domains/wiki/index.ts' && typeOnly) return null;
    return 'Ingestion A2UI projection may import only the public Wiki job type';
  }
  if (importer === HTTP_STREAM) {
    if (target === PROJECTION || target === WORKER_FACADE) return null;
    return 'HTTP ingestion events may use only the presentation adapter and current worker facade';
  }
  if (
    target === HTTP_STREAM &&
    (importer.startsWith('domains/') ||
      importer.startsWith('agent-runtime/') ||
      importer.startsWith('infrastructure/'))
  )
    return 'Business, runtime, and infrastructure modules may not depend on the HTTP stream';
  if (
    target === PROJECTION &&
    (importer.startsWith('domains/') || importer.startsWith('agent-runtime/'))
  )
    return 'Business and runtime policy may not depend on ingestion presentation';
  return null;
}
