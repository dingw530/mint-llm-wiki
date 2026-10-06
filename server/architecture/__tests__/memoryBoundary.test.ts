import { describe, expect, test } from 'vitest';
import { findMemoryBoundaryViolations, type MemoryDependencyEdge } from '../memoryBoundary.js';

const SERVER_ROOT = '/workspace/server';

function edge(
  importer: string,
  specifier: string,
  target: string,
  typeOnly = false,
): MemoryDependencyEdge {
  return { importer, specifier, target, typeOnly };
}

describe('Memory domain dependency boundary', () => {
  test('allows internal, infrastructure, type-only shared contracts and public consumers', () => {
    const dependencies = [
      edge('domains/memory/memory-service.ts', './types.js', 'domains/memory/types.ts', true),
      edge(
        'domains/memory/memory-service.ts',
        '../../infrastructure/persistence/memory-repository.js',
        'infrastructure/persistence/memory-repository.ts',
      ),
      edge('domains/memory/memory-service.ts', '../../types.js', 'types.ts', true),
      edge(
        'domains/memory/memory-service.ts',
        '../../utils/token-estimator.js',
        'utils/token-estimator.ts',
      ),
      edge(
        'infrastructure/persistence/memory-repository.ts',
        '../../domains/memory/types.js',
        'domains/memory/types.ts',
        true,
      ),
      edge(
        'infrastructure/ai/jev-memory-gate-provider.ts',
        '../../domains/memory/index.js',
        'domains/memory/index.ts',
        true,
      ),
      edge('types.ts', './domains/memory/types.js', 'domains/memory/types.ts', true),
      edge(
        'bootstrap/memory.ts',
        '../infrastructure/ai/memory-extraction-client.js',
        'infrastructure/ai/memory-extraction-client.ts',
      ),
      edge(
        'application/conversations/message-service.ts',
        '../domains/memory/index.js',
        'domains/memory/index.ts',
      ),
    ];

    expect(findMemoryBoundaryViolations(dependencies, SERVER_ROOT)).toEqual([]);
  });

  test('rejects domain-to-domain internals, infrastructure runtime calls and deep consumer imports', () => {
    const dependencies = [
      edge(
        'domains/memory/memory-service.ts',
        '../../domains/routing/routing-service.js',
        'domains/routing/routing-service.ts',
      ),
      edge(
        'infrastructure/ai/memoryGateProvider.ts',
        '../../domains/memory/index.js',
        'domains/memory/index.ts',
      ),
      edge(
        'endpoints/definitions/memories.ts',
        '../../domains/memory/memory-service.js',
        'domains/memory/memory-service.ts',
      ),
      edge(
        'application/memory/memory-service.ts',
        '../../infrastructure/ai/memory-extraction-client.js',
        'infrastructure/ai/memory-extraction-client.ts',
      ),
      edge('domains/memory/memory-service.ts', './missing.js', 'unresolved:./missing.js'),
    ];

    expect(findMemoryBoundaryViolations(dependencies, SERVER_ROOT)).toEqual([
      expect.objectContaining({
        importer: 'domains/memory/memory-service.ts',
        target: 'domains/routing/routing-service.ts',
      }),
      expect.objectContaining({
        importer: 'infrastructure/ai/memoryGateProvider.ts',
        target: 'domains/memory/index.ts',
      }),
      expect.objectContaining({
        importer: 'endpoints/definitions/memories.ts',
        target: 'domains/memory/memory-service.ts',
      }),
      expect.objectContaining({
        importer: 'application/memory/memory-service.ts',
        target: 'infrastructure/ai/memory-extraction-client.ts',
      }),
      expect.objectContaining({
        importer: 'domains/memory/memory-service.ts',
        reason: 'Memory contains an unresolved relative import',
      }),
    ]);
  });
});
