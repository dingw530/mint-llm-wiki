import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectRoutingDependencies, routingBoundaryViolation } from '../routingBoundary.js';

describe('Routing domain boundary', () => {
  it('resolves production imports through domain ports and bootstrap', () => {
    const edges = collectRoutingDependencies(path.resolve(process.cwd()));
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.filter((edge) => routingBoundaryViolation(edge))).toEqual([]);
  });

  it.each([
    ['domains/routing/routingService.ts', 'services/api/settingsService.ts', false],
    ['domains/routing/routingService.ts', 'infrastructure/ai/llmRoutingClassifier.ts', false],
    ['services/messageService.ts', 'domains/routing/routingService.ts', false],
    ['infrastructure/ai/jevRoutingProvider.ts', 'domains/routing/index.ts', false],
    [
      'endpoints/definitions/routingLogs.ts',
      'infrastructure/persistence/routingLogRepository.ts',
      false,
    ],
    ['domains/routing/routingService.ts', 'unresolved:./missing.js', true],
  ])('rejects %s -> %s', (importer, target, typeOnly) => {
    expect(routingBoundaryViolation({ importer, target, typeOnly })).toBeTruthy();
  });

  it('allows infrastructure to reference public domain type contracts', () => {
    expect(
      routingBoundaryViolation({
        importer: 'infrastructure/ai/jevRoutingProvider.ts',
        target: 'domains/routing/index.ts',
        typeOnly: true,
      }),
    ).toBeNull();
  });
});
