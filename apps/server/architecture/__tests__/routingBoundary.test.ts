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
    ['domains/routing/routing-service.ts', 'application/settings/settings-service.ts', false],
    ['domains/routing/routing-service.ts', 'infrastructure/ai/llm-routing-classifier.ts', false],
    ['application/conversations/message-service.ts', 'domains/routing/routing-service.ts', false],
    ['infrastructure/ai/jev-routing-provider.ts', 'domains/routing/index.ts', false],
    [
      'endpoints/definitions/routingLogs.ts',
      'infrastructure/persistence/routing-log-repository.ts',
      false,
    ],
    ['domains/routing/routing-service.ts', 'unresolved:./missing.js', true],
  ])('rejects %s -> %s', (importer, target, typeOnly) => {
    expect(routingBoundaryViolation({ importer, target, typeOnly })).toBeTruthy();
  });

  it('allows infrastructure to reference public domain type contracts', () => {
    expect(
      routingBoundaryViolation({
        importer: 'infrastructure/ai/jev-routing-provider.ts',
        target: 'domains/routing/index.ts',
        typeOnly: true,
      }),
    ).toBeNull();
  });
});
