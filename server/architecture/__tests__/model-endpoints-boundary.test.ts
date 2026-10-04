import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectRoutingDependencies } from '../routingBoundary.js';
import { modelEndpointsBoundaryViolation } from '../model-endpoints-boundary.js';

describe('Model endpoints boundary', () => {
  it('resolves production consumers through the public index and owned persistence', () => {
    const edges = collectRoutingDependencies(path.resolve(process.cwd()));
    expect(edges.some((edge) => edge.importer.startsWith('domains/model-endpoints/'))).toBe(true);
    expect(edges.filter((edge) => modelEndpointsBoundaryViolation(edge))).toEqual([]);
  });

  it.each([
    [
      'application/settings/settings-service.ts',
      'infrastructure/persistence/model-endpoint-repository.ts',
      false,
    ],
    [
      'endpoints/definitions/modelEndpoints.ts',
      'domains/model-endpoints/model-endpoint-service.ts',
      false,
    ],
    [
      'domains/model-endpoints/model-endpoint-service.ts',
      'application/settings/settings-service.ts',
      false,
    ],
    ['domains/model-endpoints/model-endpoint-service.ts', 'unresolved:./missing.js', false],
    ['infrastructure/ai/client.ts', 'domains/model-endpoints/index.ts', false],
  ])('rejects %s -> %s', (importer, target, typeOnly) => {
    expect(modelEndpointsBoundaryViolation({ importer, target, typeOnly })).toBeTruthy();
  });

  it.each([
    [
      'domains/model-endpoints/model-endpoint-service.ts',
      'infrastructure/persistence/model-endpoint-repository.ts',
      false,
    ],
    ['domains/model-endpoints/model-endpoint-service.ts', 'services/utils/encryption.ts', false],
    ['domains/model-endpoints/model-endpoint-service.ts', 'types.ts', true],
    ['application/settings/settings-service.ts', 'domains/model-endpoints/index.ts', false],
    ['infrastructure/ai/client.ts', 'domains/model-endpoints/index.ts', true],
  ])('allows %s -> %s', (importer, target, typeOnly) => {
    expect(modelEndpointsBoundaryViolation({ importer, target, typeOnly })).toBeNull();
  });
});
