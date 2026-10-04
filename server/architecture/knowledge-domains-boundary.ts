import type { RoutingDependency } from './routingBoundary.js';

const DOMAIN_INFRASTRUCTURE: Readonly<Record<string, readonly string[]>> = {
  skills: ['infrastructure/filesystem/skills-directory.ts'],
  'knowledge-graph': [
    'infrastructure/persistence/graph-repository.ts',
    'infrastructure/persistence/graph-candidate-repository.ts',
  ],
  wiki: [
    'infrastructure/persistence/wiki-lifecycle-repository.ts',
    'infrastructure/filesystem/wiki-files.ts',
    'infrastructure/config/wiki-settings.ts',
    'infrastructure/filesystem/wiki-ingestion-files.ts',
    'infrastructure/filesystem/wiki-graph-metadata.ts',
    'infrastructure/persistence/wiki-ingestion-commit-repository.ts',
    'infrastructure/jobs/job-queue.ts',
    'infrastructure/jobs/job-store.ts',
    'infrastructure/jobs/job-events.ts',
    'infrastructure/jobs/sqlite-job-store.ts',
    'infrastructure/persistence/wiki-search-repository.ts',
    'infrastructure/search/wiki-search-runtime.ts',
  ],
};

const TRANSITIONAL_INFRASTRUCTURE_ACCESS: Readonly<Record<string, readonly string[]>> = {
  'services/api/wikiIngestionJobService.ts': [
    'infrastructure/filesystem/wiki-ingestion-files.ts',
    'infrastructure/jobs/job-queue.ts',
    'infrastructure/jobs/job-store.ts',
    'infrastructure/jobs/job-events.ts',
    'infrastructure/jobs/sqlite-job-store.ts',
  ],
  'scripts/wiki-ingestion-crash-smoke.ts': [
    'infrastructure/jobs/job-store.ts',
    'infrastructure/jobs/sqlite-job-store.ts',
    'infrastructure/persistence/wiki-ingestion-commit-repository.ts',
  ],
};

/** Return the owner of a migrated domain source or its domain-specific infrastructure. */
function owner(target: string): string | undefined {
  return Object.keys(DOMAIN_INFRASTRUCTURE).find(
    (domain) =>
      target.startsWith(`domains/${domain}/`) || DOMAIN_INFRASTRUCTURE[domain].includes(target),
  );
}

/** Check public domain APIs and explicitly bounded transitional infrastructure access. */
export function knowledgeDomainsBoundaryViolation(edge: RoutingDependency): string | null {
  const { importer, target, typeOnly } = edge;
  if (importer.includes('/__tests__/') || importer.endsWith('.test.ts')) return null;
  const domain = owner(importer);
  if (domain && importer.startsWith(`domains/${domain}/`)) {
    if (target.startsWith(`domains/${domain}/`) || DOMAIN_INFRASTRUCTURE[domain].includes(target))
      return null;
    const targetOwner = owner(target);
    if (targetOwner && target.startsWith(`domains/${targetOwner}/`)) {
      return target === `domains/${targetOwner}/index.ts`
        ? null
        : 'Cross-domain consumers must use the public domain index';
    }
    if (
      typeOnly &&
      [
        'types.ts',
        'services/utils/wikiShared.ts',
        'services/utils/fileParseService.ts',
        'services/vector/types.ts',
        'services/rerank/types.ts',
      ].includes(target)
    )
      return null;
    if (
      domain === 'wiki' &&
      [
        'services/utils/wikiShared.ts',
        'services/adapters/apiAdapter.ts',
        'services/utils/fileParseService.ts',
        'services/utils/wikiPageCapture.ts',
      ].includes(target)
    )
      return null;
    if (
      domain === 'knowledge-graph' &&
      ['services/adapters/apiAdapter.ts', 'utils/typeGuards.ts'].includes(target)
    )
      return null;
    if (
      [
        'utils/logger.ts',
        'utils/graphOntology.ts',
        'utils/typeGuards.ts',
        'services/utils/wikiLinkProtocol.ts',
      ].includes(target)
    )
      return null;
    return 'Domain rules may access only their own infrastructure and approved shared contracts';
  }
  if (
    owner(importer) &&
    owner(importer) === owner(target) &&
    importer.startsWith('infrastructure/') &&
    target.startsWith('infrastructure/')
  )
    return null;
  const targetDomain = owner(target);
  if (!targetDomain) return null;
  if (target.startsWith(`domains/${targetDomain}/`)) {
    if (target !== `domains/${targetDomain}/index.ts`)
      return 'Consumers must use the domain public index';
    if (importer.startsWith('infrastructure/') && !typeOnly)
      return 'Infrastructure may import only domain type contracts';
    return null;
  }
  if (TRANSITIONAL_INFRASTRUCTURE_ACCESS[importer]?.includes(target)) return null;
  if (typeOnly || importer.startsWith('bootstrap/')) return null;
  return 'Domain-specific infrastructure access requires its domain or an explicit migration bridge';
}
