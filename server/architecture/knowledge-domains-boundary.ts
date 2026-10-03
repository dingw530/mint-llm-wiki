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
  ],
};

/** Explicit bridges retained until graph generation and Wiki search move in later batches. */
const LEGACY_BRIDGES: Readonly<Record<string, readonly string[]>> = {
  'infrastructure/persistence/graph-repository.ts': [
    'services/graphBuilder.ts',
    'services/api/crossBatchSemanticService.ts',
  ],
  'infrastructure/persistence/graph-candidate-repository.ts': [
    'services/api/crossBatchSemanticService.ts',
  ],
  'infrastructure/persistence/wiki-lifecycle-repository.ts': [
    'services/api/wikiSearchService.ts',
    'services/tools/WikiSearchTool.ts',
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
    if (
      typeOnly &&
      ['types.ts', 'services/utils/wikiShared.ts', 'services/utils/wikiCompiler.ts'].includes(
        target,
      )
    )
      return null;
    if (['utils/logger.ts', 'utils/graphOntology.ts'].includes(target)) return null;
    return 'Domain rules may access only their own infrastructure and approved shared contracts';
  }
  const targetDomain = owner(target);
  if (!targetDomain) return null;
  if (target.startsWith(`domains/${targetDomain}/`)) {
    if (target !== `domains/${targetDomain}/index.ts`)
      return 'Consumers must use the domain public index';
    if (importer.startsWith('infrastructure/') && !typeOnly)
      return 'Infrastructure may import only domain type contracts';
    return null;
  }
  if (typeOnly || importer.startsWith('bootstrap/')) return null;
  if (LEGACY_BRIDGES[target]?.includes(importer)) return null;
  return 'Domain-specific infrastructure access requires its domain or an explicit migration bridge';
}
