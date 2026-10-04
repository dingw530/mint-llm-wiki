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
    ['domains/wiki/wiki-service.ts', 'application/settings/settings-service.ts', false],
    ['domains/skills/skill-service.ts', 'domains/wiki/wiki-service.ts', false],
    ['endpoints/definitions/wiki.ts', 'domains/wiki/wiki-service.ts', false],
    ['services/tools/SkillTool.ts', 'infrastructure/filesystem/skills-directory.ts', false],
    ['services/messageService.ts', 'infrastructure/persistence/graph-repository.ts', false],
    [
      'services/tools/KnowledgeGraphTool.ts',
      'infrastructure/persistence/graph-repository.ts',
      false,
    ],
    ['infrastructure/filesystem/wiki-files.ts', 'domains/wiki/index.ts', false],
  ])('rejects %s -> %s', (importer, target, typeOnly) => {
    expect(knowledgeDomainsBoundaryViolation({ importer, target, typeOnly })).toBeTruthy();
  });

  it('routes Graph API clients through their public domain index', () => {
    expect(
      knowledgeDomainsBoundaryViolation({
        importer: 'services/tools/KnowledgeGraphTool.ts',
        target: 'domains/knowledge-graph/index.ts',
        typeOnly: false,
      }),
    ).toBeNull();
    expect(
      knowledgeDomainsBoundaryViolation({
        importer: 'domains/wiki/wiki-ingestion-service.ts',
        target: 'domains/knowledge-graph/index.ts',
        typeOnly: false,
      }),
    ).toBeNull();
    expect(
      knowledgeDomainsBoundaryViolation({
        importer: 'application/wiki/wiki-vector-backfill-service.ts',
        target: 'domains/wiki/index.ts',
        typeOnly: false,
      }),
    ).toBeNull();
    expect(
      knowledgeDomainsBoundaryViolation({
        importer: 'services/tools/WikiSearchTool.ts',
        target: 'domains/wiki/index.ts',
        typeOnly: false,
      }),
    ).toBeNull();
  });

  it.each([
    [
      'domains/wiki/wiki-ingestion-service.ts',
      'infrastructure/filesystem/wiki-ingestion-files.ts',
      false,
    ],
    [
      'domains/wiki/wiki-ingestion-service.ts',
      'infrastructure/persistence/wiki-ingestion-commit-repository.ts',
      false,
    ],
    ['domains/wiki/wiki-ingestion-job-service.ts', 'infrastructure/jobs/job-queue.ts', false],
    ['domains/wiki/wiki-ingestion-service.ts', 'domains/knowledge-graph/index.ts', false],
    ['domains/wiki/wiki-ingestion-service.ts', 'domains/wiki/wiki-compiler.ts', false],
    ['domains/wiki/wiki-compiler.ts', 'services/adapters/apiAdapter.ts', false],
    [
      'domains/knowledge-graph/cross-batch-semantic-service.ts',
      'services/adapters/apiAdapter.ts',
      false,
    ],
    [
      'application/wiki/wiki-ingestion-job-service.ts',
      'infrastructure/jobs/sqlite-job-store.ts',
      false,
    ],
    ['infrastructure/jobs/job-store.ts', 'infrastructure/jobs/sqlite-job-store.ts', false],
  ])('allows ingestion boundary %s -> %s', (importer, target, typeOnly) => {
    expect(knowledgeDomainsBoundaryViolation({ importer, target, typeOnly })).toBeNull();
  });

  it.each([
    ['services/graphBuilder.ts', 'infrastructure/persistence/graph-repository.ts', false],
    [
      'services/api/crossBatchSemanticService.ts',
      'infrastructure/persistence/graph-repository.ts',
      false,
    ],
    [
      'services/api/crossBatchSemanticService.ts',
      'infrastructure/persistence/graph-candidate-repository.ts',
      false,
    ],
    [
      'application/wiki/wiki-vector-backfill-service.ts',
      'infrastructure/persistence/wiki-search-repository.ts',
      false,
    ],
    [
      'services/tools/WikiSearchTool.ts',
      'infrastructure/persistence/wiki-lifecycle-repository.ts',
      false,
    ],
  ])('rejects retired bridge %s -> %s', (importer, target, typeOnly) => {
    expect(knowledgeDomainsBoundaryViolation({ importer, target, typeOnly })).toBeTruthy();
  });
});
