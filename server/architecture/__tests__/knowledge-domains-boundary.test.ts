import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectRoutingDependencies as collectServerDependencies } from '../routingBoundary.js';
import { knowledgeDomainsBoundaryViolation } from '../knowledge-domains-boundary.js';

describe('Skills, knowledge graph and Wiki management boundaries', () => {
  it('checks resolved static, re-export and dynamic dependency paths', () => {
    const edges = collectServerDependencies(path.resolve(process.cwd()));
    for (const domain of ['skills', 'knowledge-graph', 'wiki'])
      expect(edges.some((edge) => edge.importer.startsWith(`domains/${domain}/`))).toBe(true);
    expect(edges.filter((edge) => knowledgeDomainsBoundaryViolation(edge))).toEqual([]);
  });

  it.each([
    ['domains/wiki/wiki-service.ts', 'services/api/settingsService.ts', false],
    ['domains/skills/skill-service.ts', 'domains/wiki/wiki-service.ts', false],
    ['endpoints/definitions/wiki.ts', 'domains/wiki/wiki-service.ts', false],
    ['services/tools/SkillTool.ts', 'infrastructure/filesystem/skills-directory.ts', false],
    ['services/messageService.ts', 'infrastructure/persistence/graph-repository.ts', false],
    ['infrastructure/filesystem/wiki-files.ts', 'domains/wiki/index.ts', false],
  ])('rejects %s -> %s', (importer, target, typeOnly) => {
    expect(knowledgeDomainsBoundaryViolation({ importer, target, typeOnly })).toBeTruthy();
  });

  it('keeps the existing ingestion/search bridges explicit', () => {
    expect(
      knowledgeDomainsBoundaryViolation({
        importer: 'services/api/crossBatchSemanticService.ts',
        target: 'infrastructure/persistence/graph-repository.ts',
        typeOnly: false,
      }),
    ).toBeNull();
    expect(
      knowledgeDomainsBoundaryViolation({
        importer: 'services/api/wikiSearchService.ts',
        target: 'infrastructure/persistence/wiki-lifecycle-repository.ts',
        typeOnly: false,
      }),
    ).toBeNull();
  });
});
